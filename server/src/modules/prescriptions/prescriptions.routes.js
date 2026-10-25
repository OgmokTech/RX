import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../middleware/audit.js';
import { assertPatientAccess, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { pageQuery, paged } from '../../utils/pagination.js';
import * as rx from './prescriptions.service.js';

const router = Router();

const item = z.object({
  drugId: z.string().uuid(),
  dose: z.string().trim().min(1).max(60),
  frequency: z.string().trim().min(1).max(60),
  route: z.string().trim().max(30).default('oral'),
  durationDays: z.number().int().min(1).max(365).optional(),
  quantity: z.number().int().min(1).max(1000),
  instructions: z.string().trim().max(300).optional(),
});

router.get('/drugs', validate({ query: z.object({ q: z.string().trim().max(60).optional() }) }), async (req, res) =>
  res.json(await rx.searchDrugs(req.valid.query.q))
);

router.get('/pharmacies', async (_req, res) => res.json(await rx.listPharmacies()));

// Dry-run so the UI can warn while the doctor is still composing
router.post(
  '/prescriptions/check',
  authorize('doctor'),
  validate({ body: z.object({ patientId: z.string().uuid(), drugIds: z.array(z.string().uuid()).min(1).max(20) }) }),
  async (req, res) => {
    await assertPatientAccess(req.user, req.valid.body.patientId, { clinical: true });
    res.json(await rx.runSafetyCheck(req.valid.body.patientId, req.valid.body.drugIds));
  }
);

router.post(
  '/prescriptions',
  authorize('doctor'),
  validate({
    body: z.object({
      patientId: z.string().uuid(),
      encounterId: z.string().uuid().optional(),
      pharmacyId: z.string().uuid().optional(),
      notes: z.string().trim().max(1000).optional(),
      overrideReason: z.string().trim().min(10, 'Explain the clinical reason (10+ characters)').max(500).optional(),
      items: z.array(item).min(1).max(20),
    }),
  }),
  audit('create', 'prescription'),
  async (req, res) => {
    await assertPatientAccess(req.user, req.valid.body.patientId, { clinical: true });
    const created = await rx.create(req.user.doctorId, req.valid.body);
    res.locals.resourceId = created.id;
    res.locals.patientId = created.patient_id;
    res.status(201).json(created);
  }
);

router.get(
  '/prescriptions',
  authorize('patient', 'doctor'),
  validate({ query: z.object({ patientId: z.string().uuid().optional(), ...pageQuery }) }),
  async (req, res) => res.json(paged(await rx.list(req.user, req.valid.query), req.valid.query))
);

router.get('/prescriptions/:id', authorize('patient', 'doctor'), validate({ params: z.object({ id: z.string().uuid() }) }), audit('view', 'prescription'), async (req, res) =>
  res.json(await rx.getOne(req.user, req.valid.params.id))
);

router.patch(
  '/prescriptions/:id/status',
  authorize('doctor', 'admin'),
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['dispensed', 'cancelled']) }) }),
  audit('update', 'prescription'),
  async (req, res) => res.json(await rx.setStatus(req.user, req.valid.params.id, req.valid.body.status))
);

export default router;
