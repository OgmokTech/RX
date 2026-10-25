import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/postgres.js';
import { audit } from '../../middleware/audit.js';
import { assertPatientAccess, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { invalidatePattern } from '../../utils/cache.js';
import { encrypt } from '../../utils/crypto.js';
import { badRequest, forbidden, notFound } from '../../utils/httpError.js';
import { pageQuery, paged } from '../../utils/pagination.js';
import { paymentGateway } from './paymentGateway.js';
import { computeInvoiceTotals } from './totals.js';

const router = Router();
const idParam = z.object({ id: z.string().uuid() });
const STAFF = ['admin', 'receptionist', 'doctor'];
const money = z.number().nonnegative().max(10_000_000).multipleOf(0.01);

async function loadInvoice(user, id) {
  const { rows: [inv] } = await query(
    `SELECT i.*, p.first_name || ' ' || p.last_name AS patient_name, p.mrn,
            (SELECT json_agg(ii ORDER BY ii.item_type) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items,
            (SELECT coalesce(json_agg(py ORDER BY py.paid_at), '[]') FROM payments py WHERE py.invoice_id = i.id) AS payments
       FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = $1`,
    [id]
  );
  if (!inv) throw notFound('Invoice');
  if (user.role === 'patient' && inv.patient_id !== user.patientId) throw forbidden();
  return inv;
}

router.get(
  '/invoices',
  validate({ query: z.object({ status: z.enum(['open', 'paid', 'all']).default('all'), patientId: z.string().uuid().optional(), ...pageQuery }) }),
  async (req, res) => {
    const { status, patientId, page, pageSize } = req.valid.query;
    const { rows } = await query(
      `SELECT i.id, i.invoice_no, i.status, i.total, i.amount_paid, i.balance, i.due_date, i.issued_at, i.discount_type,
              p.first_name || ' ' || p.last_name AS patient_name, p.mrn, count(*) OVER() AS total_count
         FROM invoices i JOIN patients p ON p.id = i.patient_id
        WHERE ($1::uuid IS NULL OR i.patient_id = $1)
          AND ($2 = 'all' OR ($2 = 'open' AND i.status IN ('issued','partially_paid')) OR ($2 = 'paid' AND i.status = 'paid'))
        ORDER BY i.issued_at DESC LIMIT $3 OFFSET $4`,
      [req.user.role === 'patient' ? req.user.patientId : patientId ?? null, status, pageSize, (page - 1) * pageSize]
    );
    res.json(paged(rows, { page, pageSize }));
  }
);

router.get('/invoices/:id', validate({ params: idParam }), audit('view', 'invoice'), async (req, res) =>
  res.json(await loadInvoice(req.user, req.valid.params.id))
);

router.post(
  '/invoices',
  authorize(...STAFF),
  validate({
    body: z.object({
      patientId: z.string().uuid(),
      appointmentId: z.string().uuid().optional(),
      discountType: z.enum(['none', 'senior', 'pwd', 'manual']).default('none'),
      manualDiscount: money.optional(),
      dueDate: z.string().date().optional(),
      items: z
        .array(z.object({
          itemType: z.enum(['consultation', 'procedure', 'lab', 'medication', 'supply', 'other']),
          description: z.string().trim().min(2).max(200),
          quantity: z.number().positive().max(1000),
          unitPrice: money,
        }))
        .min(1).max(50),
    }),
  }),
  audit('create', 'invoice'),
  async (req, res) => {
    const b = req.valid.body;
    const t = computeInvoiceTotals(b.items, { discountType: b.discountType, manualDiscount: b.manualDiscount, taxRate: env.TAX_RATE });
    const invoice = await withTransaction(async (c) => {
      const { rows: [inv] } = await c.query(
        `INSERT INTO invoices (patient_id, appointment_id, discount_type, subtotal, discount, tax, total, due_date, issued_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8, current_date + 30),$9) RETURNING id`,
        [b.patientId, b.appointmentId ?? null, b.discountType, t.subtotal, t.discount, t.tax, t.total, b.dueDate ?? null, req.user.id]
      );
      await c.query(
        `INSERT INTO invoice_items (invoice_id, item_type, description, quantity, unit_price)
         SELECT $1, x.item_type, x.description, x.quantity, x.unit_price
           FROM jsonb_to_recordset($2::jsonb) AS x(item_type text, description text, quantity numeric, unit_price numeric)`,
        [inv.id, JSON.stringify(b.items.map((i) => ({ item_type: i.itemType, description: i.description, quantity: i.quantity, unit_price: i.unitPrice })))]
      );
      return inv;
    });
    res.locals.resourceId = invoice.id;
    res.status(201).json(await loadInvoice(req.user, invoice.id));
  }
);

// Patients pay online through the gateway; staff record over-the-counter payments.
// Idempotency-Key header makes retries (double clicks, flaky mobile data) safe.
router.post(
  '/invoices/:id/payments',
  validate({
    params: idParam,
    body: z.object({
      amount: money.positive(),
      method: z.enum(['cash', 'card', 'gcash', 'maya', 'bank_transfer']),
      reference: z.string().trim().max(80).optional(),
    }),
  }),
  audit('create', 'payment'),
  async (req, res) => {
    const inv = await loadInvoice(req.user, req.valid.params.id);
    const { amount, method, reference } = req.valid.body;

    // Replayed request → return the original result before any state-dependent checks
    const idemKey = req.get('Idempotency-Key') ?? null;
    if (idemKey) {
      const { rows: [prior] } = await query('SELECT * FROM payments WHERE idempotency_key = $1 AND invoice_id = $2', [idemKey, inv.id]);
      if (prior) return res.json(prior);
    }

    if (['paid', 'void'].includes(inv.status)) throw badRequest(`This invoice is already ${inv.status}`);
    if (amount > inv.balance) throw badRequest(`Amount exceeds the balance of ₱${inv.balance.toFixed(2)}`);
    if (req.user.role === 'patient' && method === 'cash') throw badRequest('Pay cash at the clinic cashier');

    const online = req.user.role === 'patient';
    const charge = online ? await paymentGateway.charge({ amount, method, description: inv.invoice_no }) : { status: 'succeeded', reference };
    const { rows: [payment] } = await query(
      `INSERT INTO payments (invoice_id, amount, method, status, reference, gateway, idempotency_key, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [inv.id, amount, method, charge.status, charge.reference ?? null, online ? process.env.PAYMENT_PROVIDER || 'mock' : null, idemKey, online ? null : req.user.id]
    );
    await invalidatePattern('cache:report:*');
    res.status(201).json(payment);
  }
);

router.post('/invoices/:id/void', authorize('admin'), validate({ params: idParam }), audit('void', 'invoice'), async (req, res) => {
  const { rows: [inv] } = await query(
    `UPDATE invoices SET status = 'void' WHERE id = $1 AND amount_paid = 0 AND status <> 'void' RETURNING id, status`, [req.valid.params.id]);
  if (!inv) throw badRequest('Only unpaid invoices can be voided');
  res.json(inv);
});

// --- Insurance / HMO ---
router.get('/patients/:patientId/policies', validate({ params: z.object({ patientId: z.string().uuid() }) }), async (req, res) => {
  await assertPatientAccess(req.user, req.valid.params.patientId);
  // Data minimization: list views only need the last 4 digits; the full number stays encrypted
  // is decrypted only by the claims integration when a claim is submitted to the insurer.
  const { rows } = await query(
    'SELECT id, provider, member_no_last4, coverage, valid_until, is_primary FROM insurance_policies WHERE patient_id = $1 ORDER BY is_primary DESC, provider',
    [req.valid.params.patientId]
  );
  res.json(rows);
});

router.post(
  '/patients/:patientId/policies',
  validate({
    params: z.object({ patientId: z.string().uuid() }),
    body: z.object({ provider: z.string().trim().min(2).max(80), memberNo: z.string().trim().min(4).max(40), validUntil: z.string().date().optional(), isPrimary: z.boolean().default(false) }),
  }),
  audit('create', 'insurance_policy'),
  async (req, res) => {
    await assertPatientAccess(req.user, req.valid.params.patientId);
    const b = req.valid.body;
    const { rows: [p] } = await query(
      `INSERT INTO insurance_policies (patient_id, provider, member_no_enc, member_no_last4, valid_until, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, provider, member_no_last4, valid_until, is_primary`,
      [req.valid.params.patientId, b.provider, encrypt(b.memberNo), b.memberNo.slice(-4), b.validUntil ?? null, b.isPrimary]
    );
    res.status(201).json(p);
  }
);

router.post(
  '/invoices/:id/claims',
  authorize('admin', 'receptionist'),
  validate({ params: idParam, body: z.object({ policyId: z.string().uuid(), amountClaimed: money.positive() }) }),
  audit('create', 'insurance_claim'),
  async (req, res) => {
    const { rows: [claim] } = await query(
      `INSERT INTO insurance_claims (invoice_id, policy_id, amount_claimed)
       SELECT i.id, $2, $3 FROM invoices i JOIN insurance_policies p ON p.id = $2 AND p.patient_id = i.patient_id
        WHERE i.id = $1 AND $3 <= i.balance RETURNING *`,
      [req.valid.params.id, req.valid.body.policyId, req.valid.body.amountClaimed]
    );
    if (!claim) throw badRequest('Policy does not belong to this patient, or the claim exceeds the balance');
    res.status(201).json(claim);
  }
);

// Approving a claim posts an 'insurance' payment → the trigger updates the invoice balance
router.patch(
  '/claims/:id',
  authorize('admin', 'receptionist'),
  validate({ params: idParam, body: z.object({ status: z.enum(['approved', 'partially_approved', 'denied']), amountApproved: money.optional(), externalRef: z.string().max(80).optional() }) }),
  audit('update', 'insurance_claim'),
  async (req, res) => {
    const b = req.valid.body;
    const claim = await withTransaction(async (c) => {
      const { rows: [cl] } = await c.query(
        `UPDATE insurance_claims SET status = $2, amount_approved = $3, external_ref = coalesce($4, external_ref), decided_at = now()
          WHERE id = $1 AND status = 'submitted' RETURNING *`,
        [req.valid.params.id, b.status, b.status === 'denied' ? 0 : b.amountApproved ?? null, b.externalRef ?? null]
      );
      if (!cl) throw badRequest('Only submitted claims can be decided');
      if (cl.amount_approved > 0) {
        await c.query(
          `INSERT INTO payments (invoice_id, amount, method, reference, received_by) VALUES ($1,$2,'insurance',$3,$4)`,
          [cl.invoice_id, cl.amount_approved, cl.external_ref ?? `CLAIM-${cl.id.slice(0, 8)}`, req.user.id]
        );
      }
      return cl;
    });
    res.json(claim);
  }
);

export default router;
