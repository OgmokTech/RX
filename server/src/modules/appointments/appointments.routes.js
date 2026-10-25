import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../middleware/audit.js';
import { validate } from '../../middleware/validate.js';
import { pageQuery, paged } from '../../utils/pagination.js';
import * as appointments from './appointments.service.js';

const router = Router();
const idParam = z.object({ id: z.string().uuid() });
const iso = z.string().datetime({ offset: true });

router.get(
  '/',
  validate({
    query: z.object({
      from: iso.optional(),
      to: iso.optional(),
      status: z.enum(['scheduled', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show']).optional(),
      ...pageQuery,
    }),
  }),
  async (req, res) => res.json(paged(await appointments.list(req.user, req.valid.query), req.valid.query))
);

router.post(
  '/',
  validate({
    body: z.object({
      doctorId: z.string().uuid(),
      startsAt: iso,
      type: z.enum(['in_person', 'telemedicine']).default('in_person'),
      reason: z.string().trim().max(500).optional(),
      patientId: z.string().uuid().optional(), // staff booking on behalf of a patient
    }),
  }),
  audit('create', 'appointment'),
  async (req, res) => {
    const appt = await appointments.book(req.user, req.valid.body);
    res.locals.resourceId = appt.id;
    res.status(201).json(appt);
  }
);

router.patch('/:id/reschedule', validate({ params: idParam, body: z.object({ startsAt: iso }) }), audit('update', 'appointment'), async (req, res) =>
  res.json(await appointments.reschedule(req.user, req.valid.params.id, req.valid.body.startsAt))
);

router.patch(
  '/:id/status',
  validate({
    params: idParam,
    body: z.object({
      status: z.enum(['confirmed', 'checked_in', 'completed', 'cancelled', 'no_show']),
      cancelReason: z.string().trim().max(300).optional(),
    }),
  }),
  audit('update', 'appointment'),
  async (req, res) => res.json(await appointments.changeStatus(req.user, req.valid.params.id, req.valid.body))
);

export default router;
