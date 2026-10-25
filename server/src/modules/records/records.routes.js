import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../middleware/audit.js';
import { assertPatientAccess, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as records from './records.service.js';

const router = Router();
const patientParam = z.object({ patientId: z.string().uuid() });
const itemParam = patientParam.extend({ id: z.string().uuid() });

// Patients and their doctors may read and maintain allergy/medication lists
const clinicalAccess = (req) => assertPatientAccess(req.user, req.valid.params.patientId, { clinical: true });

router.get('/patients/:patientId/chart', validate({ params: patientParam }), audit('view', 'patient_chart'), async (req, res) => {
  await clinicalAccess(req);
  res.json(await records.getChart(req.valid.params.patientId));
});

router.post(
  '/patients/:patientId/allergies',
  validate({
    params: patientParam,
    body: z.object({
      substance: z.string().trim().min(2).max(120),
      reaction: z.string().trim().max(200).optional(),
      severity: z.enum(['mild', 'moderate', 'severe']).default('moderate'),
    }),
  }),
  audit('create', 'allergy'),
  async (req, res) => {
    await clinicalAccess(req);
    res.status(201).json(await records.addAllergy(req.valid.params.patientId, req.user.id, req.valid.body));
  }
);

router.delete('/patients/:patientId/allergies/:id', authorize('doctor'), validate({ params: itemParam }), audit('delete', 'allergy'), async (req, res) => {
  await clinicalAccess(req);
  await records.removeAllergy(req.valid.params.patientId, req.valid.params.id);
  res.status(204).end();
});

router.post(
  '/patients/:patientId/medications',
  validate({
    params: patientParam,
    body: z.object({
      name: z.string().trim().min(2).max(160),
      drugId: z.string().uuid().optional(),
      dosage: z.string().trim().max(120).optional(),
      startedOn: z.string().date().optional(),
    }),
  }),
  audit('create', 'medication'),
  async (req, res) => {
    await clinicalAccess(req);
    res.status(201).json(await records.addMedication(req.valid.params.patientId, req.valid.body));
  }
);

router.patch('/patients/:patientId/medications/:id/stop', validate({ params: itemParam }), audit('update', 'medication'), async (req, res) => {
  await clinicalAccess(req);
  await records.stopMedication(req.valid.params.patientId, req.valid.params.id);
  res.status(204).end();
});

router.post(
  '/patients/:patientId/conditions',
  validate({
    params: patientParam,
    body: z.object({
      description: z.string().trim().min(2).max(200),
      icd10Code: z.string().trim().max(10).optional(),
      onsetDate: z.string().date().optional(),
      isChronic: z.boolean().optional(),
    }),
  }),
  audit('create', 'condition'),
  async (req, res) => {
    await clinicalAccess(req);
    res.status(201).json(await records.addCondition(req.valid.params.patientId, req.valid.body));
  }
);

// Consultation notes — doctors only
router.post(
  '/encounters',
  authorize('doctor'),
  validate({
    body: z.object({
      patientId: z.string().uuid(),
      appointmentId: z.string().uuid().optional(),
      chiefComplaint: z.string().trim().max(300).optional(),
      notes: z.string().trim().max(20_000).optional(),
      vitals: z
        .object({
          bp: z.string().regex(/^\d{2,3}\/\d{2,3}$/).optional(),
          hr: z.number().int().min(20).max(250).optional(),
          rr: z.number().int().min(4).max(80).optional(),
          temp: z.number().min(30).max(45).optional(),
          spo2: z.number().int().min(50).max(100).optional(),
          weightKg: z.number().min(0.5).max(400).optional(),
          heightCm: z.number().min(30).max(250).optional(),
        })
        .optional(),
      diagnoses: z.array(z.string().trim().regex(/^[A-Z]\d{2}(\.\d{1,4})?$/, 'Use ICD-10 codes like J06.9')).max(10).optional(),
      followUpOn: z.string().date().optional(),
    }),
  }),
  audit('create', 'encounter'),
  async (req, res) => {
    await assertPatientAccess(req.user, req.valid.body.patientId, { clinical: true });
    res.locals.patientId = req.valid.body.patientId;
    res.status(201).json(await records.createEncounter(req.user.doctorId, req.valid.body));
  }
);

export default router;
