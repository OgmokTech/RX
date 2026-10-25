// Video consultations via Jitsi Meet (WebRTC). The room name is unguessable and only
// handed to the appointment's participants inside the allowed time window.
// Production: self-host Jitsi with JWT auth, or swap in Zoom Video SDK / Daily behind this route.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { query } from '../../db/postgres.js';
import { audit } from '../../middleware/audit.js';
import { validate } from '../../middleware/validate.js';
import { TelemedicineSession } from '../../models/TelemedicineSession.js';
import { badRequest, forbidden, notFound } from '../../utils/httpError.js';

const router = Router();
const EARLY_MINUTES = 15;
const LATE_MINUTES = 30;

router.post(
  '/:appointmentId/join',
  validate({ params: z.object({ appointmentId: z.string().uuid() }) }),
  audit('join', 'telemedicine'),
  async (req, res) => {
    const { rows: [a] } = await query(
      `SELECT a.*, p.user_id AS patient_user_id, d.user_id AS doctor_user_id,
              p.first_name || ' ' || p.last_name AS patient_name, 'Dr. ' || d.last_name AS doctor_name
         FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id
        WHERE a.id = $1`, [req.valid.params.appointmentId]);
    if (!a) throw notFound('Appointment');
    if (![a.patient_user_id, a.doctor_user_id].includes(req.user.id)) throw forbidden();
    if (a.type !== 'telemedicine') throw badRequest('This is an in-person appointment');
    if (!['scheduled', 'confirmed', 'checked_in'].includes(a.status)) throw badRequest(`This appointment is ${a.status}`);
    const now = Date.now();
    if (now < new Date(a.starts_at).getTime() - EARLY_MINUTES * 60_000) throw badRequest(`The room opens ${EARLY_MINUTES} minutes before the appointment`);
    if (now > new Date(a.ends_at).getTime() + LATE_MINUTES * 60_000) throw badRequest('This video visit has ended');

    const session = await TelemedicineSession.findOneAndUpdate(
      { appointmentId: a.id },
      {
        $setOnInsert: { appointmentId: a.id, roomName: `rx-${crypto.randomBytes(12).toString('hex')}`, startedAt: new Date() },
        $push: { events: { userId: req.user.id, role: req.user.role, type: 'join' } },
      },
      { upsert: true, new: true }
    );
    if (req.user.role === 'patient' && a.status !== 'checked_in') {
      await query(`UPDATE appointments SET status = 'checked_in' WHERE id = $1 AND status IN ('scheduled','confirmed')`, [a.id]);
    }
    res.json({
      domain: env.JITSI_DOMAIN,
      roomName: session.roomName,
      displayName: req.user.role === 'doctor' ? a.doctor_name : a.patient_name,
      counterpart: req.user.role === 'doctor' ? a.patient_name : a.doctor_name,
      endsAt: a.ends_at,
    });
  }
);

router.post('/:appointmentId/leave', validate({ params: z.object({ appointmentId: z.string().uuid() }) }), async (req, res) => {
  await TelemedicineSession.updateOne(
    { appointmentId: req.valid.params.appointmentId, 'events.userId': req.user.id },
    { $push: { events: { userId: req.user.id, role: req.user.role, type: 'leave' } }, $set: { endedAt: new Date() } }
  );
  res.status(204).end();
});

export default router;
