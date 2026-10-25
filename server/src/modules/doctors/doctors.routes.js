import { Router } from 'express';
import { z } from 'zod';
import { authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as doctors from './doctors.service.js';

const router = Router();
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');

router.get('/', async (_req, res) => res.json(await doctors.listDoctors()));

router.get('/me/dashboard', authorize('doctor'), async (req, res) => res.json(await doctors.dashboard(req.user.doctorId)));

router.get('/me/schedule', authorize('doctor'), async (req, res) => res.json(await doctors.getSchedule(req.user.doctorId)));

router.put(
  '/me/schedule',
  authorize('doctor'),
  validate({
    body: z.object({
      blocks: z
        .array(
          z.object({ weekday: z.number().int().min(0).max(6), startTime: time, endTime: time, slotMinutes: z.number().int().min(5).max(240) })
            .refine((b) => b.endTime > b.startTime, 'End time must be after start time')
        )
        .max(28),
    }),
  }),
  async (req, res) => {
    await doctors.replaceSchedule(req.user.doctorId, req.valid.body.blocks);
    res.json(await doctors.getSchedule(req.user.doctorId));
  }
);

router.post(
  '/me/time-off',
  authorize('doctor'),
  validate({ body: z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), reason: z.string().max(200).optional() }) }),
  async (req, res) => res.status(201).json(await doctors.addTimeOff(req.user.doctorId, req.valid.body))
);

router.get(
  '/:id/slots',
  validate({ params: z.object({ id: z.string().uuid() }), query: z.object({ date: z.string().date() }) }),
  async (req, res) => res.json(await doctors.getSlots(req.valid.params.id, req.valid.query.date))
);

export default router;
