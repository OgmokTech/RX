import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/postgres.js';
import { enqueue } from '../../jobs/queue.js';
import { audit } from '../../middleware/audit.js';
import { assertPatientAccess, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { cached, cacheKeys } from '../../utils/cache.js';
import { badRequest, notFound } from '../../utils/httpError.js';
import { pageQuery, paged } from '../../utils/pagination.js';

const router = Router();

router.get('/lab-tests', async (_req, res) =>
  res.json(await cached(cacheKeys.labTests(), 3600, async () =>
    (await query('SELECT id, code, name, specimen, unit, reference_range, price, turnaround_hours FROM lab_tests ORDER BY name')).rows))
);

router.post(
  '/lab-orders',
  authorize('doctor'),
  validate({
    body: z.object({
      patientId: z.string().uuid(),
      encounterId: z.string().uuid().optional(),
      priority: z.enum(['routine', 'urgent', 'stat']).default('routine'),
      clinicalNotes: z.string().trim().max(500).optional(),
      testIds: z.array(z.string().uuid()).min(1).max(30),
    }),
  }),
  audit('create', 'lab_order'),
  async (req, res) => {
    const b = req.valid.body;
    await assertPatientAccess(req.user, b.patientId, { clinical: true });
    const order = await withTransaction(async (c) => {
      const { rows: [o] } = await c.query(
        `INSERT INTO lab_orders (patient_id, doctor_id, encounter_id, priority, clinical_notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [b.patientId, req.user.doctorId, b.encounterId ?? null, b.priority, b.clinicalNotes ?? null]
      );
      // One multi-row insert via unnest instead of N round trips
      await c.query(
        `INSERT INTO lab_order_items (lab_order_id, lab_test_id, reference_range)
         SELECT $1, t.id, t.reference_range FROM lab_tests t WHERE t.id = ANY($2::uuid[])`,
        [o.id, b.testIds]
      );
      return o;
    });
    res.locals.resourceId = order.id;
    res.status(201).json(order);
  }
);

router.get(
  '/lab-orders',
  validate({ query: z.object({ status: z.enum(['open', 'resulted', 'all']).default('all'), patientId: z.string().uuid().optional(), ...pageQuery }) }),
  async (req, res) => {
    const { status, patientId, page, pageSize } = req.valid.query;
    const u = req.user;
    const { rows } = await query(
      `SELECT o.id, o.status, o.priority, o.ordered_at, o.completed_at, o.clinical_notes, o.patient_id,
              p.first_name || ' ' || p.last_name AS patient_name, p.mrn,
              'Dr. ' || d.last_name AS doctor_name,
              json_agg(json_build_object('id', i.id, 'test', t.name, 'code', t.code, 'status', i.status,
                       'value', i.result_value, 'unit', coalesce(i.result_unit, t.unit),
                       'range', i.reference_range, 'flag', i.abnormal_flag, 'notes', i.result_notes) ORDER BY t.name) AS items,
              count(*) OVER() AS total_count
         FROM lab_orders o
         JOIN patients p ON p.id = o.patient_id
         JOIN doctors d ON d.id = o.doctor_id
         JOIN lab_order_items i ON i.lab_order_id = o.id
         JOIN lab_tests t ON t.id = i.lab_test_id
        WHERE ($1::uuid IS NULL OR o.patient_id = $1)
          AND ($2::uuid IS NULL OR o.doctor_id = $2)
          AND ($3 = 'all' OR ($3 = 'open' AND o.status NOT IN ('resulted','cancelled')) OR ($3 = 'resulted' AND o.status = 'resulted'))
        GROUP BY o.id, p.id, d.id
        ORDER BY (o.priority = 'stat') DESC, o.ordered_at DESC
        LIMIT $4 OFFSET $5`,
      [u.role === 'patient' ? u.patientId : patientId ?? null, u.role === 'doctor' ? u.doctorId : null, status, pageSize, (page - 1) * pageSize]
    );
    // Patients only see values once the whole order is released
    const data = u.role === 'patient'
      ? rows.map((r) => (r.status === 'resulted' ? r : { ...r, items: r.items.map((i) => ({ ...i, value: null, flag: null })) }))
      : rows;
    res.json(paged(data, { page, pageSize }));
  }
);

// Lab staff (admin role) or the ordering doctor record results per test
router.patch(
  '/lab-orders/:orderId/items/:itemId/result',
  authorize('admin', 'doctor'),
  validate({
    params: z.object({ orderId: z.string().uuid(), itemId: z.string().uuid() }),
    body: z.object({
      value: z.string().trim().min(1).max(100),
      unit: z.string().trim().max(30).optional(),
      abnormalFlag: z.enum(['L', 'H', 'LL', 'HH', 'A']).nullable().optional(),
      notes: z.string().trim().max(500).optional(),
    }),
  }),
  audit('update', 'lab_result'),
  async (req, res) => {
    const { orderId, itemId } = req.valid.params;
    const b = req.valid.body;
    const completed = await withTransaction(async (c) => {
      const { rows: [order] } = await c.query('SELECT status, doctor_id FROM lab_orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!order) throw notFound('Lab order');
      if (order.status === 'cancelled') throw badRequest('This order was cancelled');
      if (req.user.role === 'doctor' && order.doctor_id !== req.user.doctorId) throw badRequest('Only the ordering doctor can enter results');
      const { rowCount } = await c.query(
        `UPDATE lab_order_items SET result_value = $3, result_unit = $4, abnormal_flag = $5, result_notes = $6,
                status = 'resulted', resulted_by = $7, resulted_at = now()
          WHERE id = $2 AND lab_order_id = $1`,
        [orderId, itemId, b.value, b.unit ?? null, b.abnormalFlag ?? null, b.notes ?? null, req.user.id]
      );
      if (!rowCount) throw notFound('Lab test in this order');
      // Order status follows its items: all resulted → resulted, otherwise in progress
      const { rows: [s] } = await c.query(
        `UPDATE lab_orders o SET
            status = CASE WHEN bool_and_status THEN 'resulted' ELSE 'in_progress' END::lab_status,
            completed_at = CASE WHEN bool_and_status THEN now() END
           FROM (SELECT bool_and(status = 'resulted') AS bool_and_status FROM lab_order_items WHERE lab_order_id = $1) x
          WHERE o.id = $1 RETURNING o.status`,
        [orderId]
      );
      return s.status === 'resulted';
    });
    if (completed) await enqueue('lab.resulted', { labOrderId: orderId });
    res.json({ completed });
  }
);

export default router;
