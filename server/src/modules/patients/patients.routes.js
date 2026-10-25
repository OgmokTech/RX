import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/postgres.js';
import { audit } from '../../middleware/audit.js';
import { assertPatientAccess, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { notFound } from '../../utils/httpError.js';
import { pageQuery, paged, toOffset } from '../../utils/pagination.js';

const router = Router();
const idParam = z.object({ id: z.string().uuid() });

const profileFields = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthDate: z.string().date(),
  sex: z.enum(['male', 'female', 'intersex', 'unspecified']),
  phone: z.string().trim().max(20).nullable(),
  email: z.string().email().nullable(),
  bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable(),
  address: z.object({ street: z.string(), barangay: z.string(), city: z.string(), province: z.string() }).partial(),
  emergencyContact: z.object({ name: z.string(), relation: z.string(), phone: z.string() }).partial(),
});

const PROFILE_COLUMNS = `id, mrn, user_id, first_name, last_name, birth_date, sex, phone, email, blood_type,
  address, emergency_contact, date_part('year', age(birth_date))::int AS age, created_at`;

// Staff/doctor search. Doctors only see patients who have booked with them.
router.get(
  '/',
  authorize('doctor', 'admin', 'receptionist'),
  validate({ query: z.object({ search: z.string().trim().max(80).optional(), ...pageQuery }) }),
  async (req, res) => {
    const { search, ...pg } = req.valid.query;
    const { limit, offset } = toOffset(pg);
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : null;
    const { rows } = await query(
      `SELECT ${PROFILE_COLUMNS}, count(*) OVER() AS total_count
         FROM patients p
        WHERE ($1::text IS NULL OR (p.last_name || ' ' || p.first_name) ILIKE '%' || $1 || '%' OR p.mrn = upper($1) OR p.phone = $1)
          AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = $2))
        ORDER BY p.last_name, p.first_name
        LIMIT $3 OFFSET $4`,
      [search || null, doctorId, limit, offset]
    );
    res.json(paged(rows, pg));
  }
);

// Reception registers walk-in patients who have no online account
router.post('/', authorize('admin', 'receptionist'), validate({ body: profileFields.partial({ phone: true, email: true, bloodType: true, address: true, emergencyContact: true }) }), audit('create', 'patient'), async (req, res) => {
  const b = req.valid.body;
  const { rows: [p] } = await query(
    `INSERT INTO patients (first_name, last_name, birth_date, sex, phone, email, blood_type, address, emergency_contact)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${PROFILE_COLUMNS}`,
    [b.firstName, b.lastName, b.birthDate, b.sex, b.phone ?? null, b.email ?? null, b.bloodType ?? null, b.address ?? {}, b.emergencyContact ?? {}]
  );
  res.locals.resourceId = p.id;
  res.status(201).json(p);
});

router.get('/:id', validate({ params: idParam }), audit('view', 'patient_profile'), async (req, res) => {
  await assertPatientAccess(req.user, req.valid.params.id);
  const { rows: [p] } = await query(`SELECT ${PROFILE_COLUMNS} FROM patients WHERE id = $1`, [req.valid.params.id]);
  if (!p) throw notFound('Patient');
  res.json(p);
});

// Partial update: only provided fields change (COALESCE keeps the rest)
router.patch('/:id', validate({ params: idParam, body: profileFields.partial() }), audit('update', 'patient_profile'), async (req, res) => {
  const { id } = req.valid.params;
  if (req.user.role === 'doctor') await assertPatientAccess(req.user, id, { clinical: true });
  else await assertPatientAccess(req.user, id);
  const b = req.valid.body;
  const { rows: [p] } = await query(
    `UPDATE patients SET
        first_name = coalesce($2, first_name), last_name = coalesce($3, last_name),
        birth_date = coalesce($4, birth_date), sex = coalesce($5, sex),
        phone = coalesce($6, phone), email = coalesce($7, email), blood_type = coalesce($8, blood_type),
        address = address || coalesce($9, '{}'::jsonb),
        emergency_contact = emergency_contact || coalesce($10, '{}'::jsonb)
      WHERE id = $1 RETURNING ${PROFILE_COLUMNS}`,
    [id, b.firstName, b.lastName, b.birthDate, b.sex, b.phone, b.email, b.bloodType, b.address ?? null, b.emergencyContact ?? null]
  );
  if (!p) throw notFound('Patient');
  res.json(p);
});

export default router;
