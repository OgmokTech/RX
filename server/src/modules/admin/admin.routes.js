import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/postgres.js';
import { audit } from '../../middleware/audit.js';
import { authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/AuditLog.js';
import { invalidate, cacheKeys } from '../../utils/cache.js';
import { badRequest } from '../../utils/httpError.js';
import { pageQuery, paged } from '../../utils/pagination.js';
import { revokeAllSessions } from '../auth/auth.service.js';

const router = Router();
router.use(authorize('admin'));

router.get(
  '/users',
  validate({ query: z.object({ role: z.enum(['patient', 'doctor', 'admin', 'receptionist']).optional(), search: z.string().trim().max(80).optional(), ...pageQuery }) }),
  async (req, res) => {
    const { role, search, page, pageSize } = req.valid.query;
    const { rows } = await query(
      `SELECT u.id, u.email, u.role, u.is_active, u.mfa_enabled, u.last_login_at, u.created_at,
              coalesce(p.first_name, d.first_name, s.first_name) || ' ' || coalesce(p.last_name, d.last_name, s.last_name) AS name,
              d.specialization, d.license_no, s.position, count(*) OVER() AS total_count
         FROM users u
         LEFT JOIN patients p ON p.user_id = u.id LEFT JOIN doctors d ON d.user_id = u.id LEFT JOIN staff s ON s.user_id = u.id
        WHERE ($1::user_role IS NULL OR u.role = $1)
          AND ($2::text IS NULL OR u.email ILIKE '%' || $2 || '%'
               OR coalesce(p.last_name, d.last_name, s.last_name) ILIKE '%' || $2 || '%')
        ORDER BY u.created_at DESC LIMIT $3 OFFSET $4`,
      [role ?? null, search || null, pageSize, (page - 1) * pageSize]
    );
    res.json(paged(rows, { page, pageSize }));
  }
);

router.post(
  '/users',
  validate({
    body: z.discriminatedUnion('role', [
      z.object({
        role: z.literal('doctor'), email: z.string().email(), password: z.string().min(10),
        firstName: z.string().min(1), lastName: z.string().min(1), specialization: z.string().min(2),
        licenseNo: z.string().min(4), ptrNo: z.string().optional(), consultationFee: z.number().nonnegative().default(500),
      }),
      z.object({
        role: z.enum(['admin', 'receptionist']), email: z.string().email(), password: z.string().min(10),
        firstName: z.string().min(1), lastName: z.string().min(1), position: z.string().min(2),
      }),
    ]),
  }),
  audit('create', 'user'),
  async (req, res) => {
    const b = req.valid.body;
    const hash = await bcrypt.hash(b.password, 12);
    const user = await withTransaction(async (c) => {
      const { rows: [u] } = await c.query('INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role', [b.email, hash, b.role]);
      if (b.role === 'doctor') {
        await c.query(
          `INSERT INTO doctors (user_id, first_name, last_name, specialization, license_no, ptr_no, consultation_fee) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [u.id, b.firstName, b.lastName, b.specialization, b.licenseNo, b.ptrNo ?? null, b.consultationFee]
        );
      } else {
        await c.query('INSERT INTO staff (user_id, first_name, last_name, position) VALUES ($1,$2,$3,$4)', [u.id, b.firstName, b.lastName, b.position]);
      }
      return u;
    });
    await invalidate(cacheKeys.doctors());
    res.status(201).json(user);
  }
);

router.patch(
  '/users/:id/status',
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ isActive: z.boolean() }) }),
  audit('update', 'user_status'),
  async (req, res) => {
    if (req.valid.params.id === req.user.id) throw badRequest('You cannot deactivate your own account');
    const { rows: [u] } = await query('UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id, is_active', [req.valid.params.id, req.valid.body.isActive]);
    if (!req.valid.body.isActive) await revokeAllSessions(req.valid.params.id); // immediate lockout
    await invalidate(cacheKeys.doctors());
    res.json(u);
  }
);

router.get(
  '/audit-logs',
  validate({ query: z.object({ patientId: z.string().optional(), actorId: z.string().optional(), resource: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) }),
  async (req, res) => {
    const { patientId, actorId, resource, limit } = req.valid.query;
    const filter = { ...(patientId && { patientId }), ...(actorId && { 'actor.id': actorId }), ...(resource && { resource }) };
    res.json(await AuditLog.find(filter).sort({ at: -1 }).limit(limit).lean());
  }
);

export default router;
