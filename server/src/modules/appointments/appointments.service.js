import { query, withTransaction } from '../../db/postgres.js';
import { redis } from '../../db/redis.js';
import { cancelReminder, enqueue, scheduleReminder } from '../../jobs/queue.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { invalidatePattern } from '../../utils/cache.js';
import { getSlots, invalidateSlots, localDateOf } from '../doctors/doctors.service.js';

const ACTIVE = ['scheduled', 'confirmed', 'checked_in'];

// Allowed status transitions per role — a small state machine instead of scattered ifs
const TRANSITIONS = {
  patient: { scheduled: ['cancelled'], confirmed: ['cancelled'] },
  doctor: {
    scheduled: ['confirmed', 'checked_in', 'cancelled', 'no_show'],
    confirmed: ['checked_in', 'cancelled', 'no_show'],
    checked_in: ['completed', 'no_show'],
  },
  receptionist: {
    scheduled: ['confirmed', 'checked_in', 'cancelled', 'no_show'],
    confirmed: ['checked_in', 'cancelled', 'no_show'],
  },
};
TRANSITIONS.admin = TRANSITIONS.doctor;

export async function list(user, { from, to, status, page, pageSize }) {
  const { rows } = await query(
    `SELECT a.id, a.starts_at, a.ends_at, a.type, a.status, a.reason, a.cancel_reason,
            a.patient_id, p.first_name || ' ' || p.last_name AS patient_name, p.mrn,
            a.doctor_id, 'Dr. ' || d.first_name || ' ' || d.last_name AS doctor_name, d.specialization,
            count(*) OVER() AS total_count
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
      WHERE ($1::uuid IS NULL OR a.patient_id = $1)
        AND ($2::uuid IS NULL OR a.doctor_id = $2)
        AND ($3::timestamptz IS NULL OR a.starts_at >= $3)
        AND ($4::timestamptz IS NULL OR a.starts_at <  $4)
        AND ($5::appointment_status IS NULL OR a.status = $5)
      ORDER BY a.starts_at ${from ? 'ASC' : 'DESC'}
      LIMIT $6 OFFSET $7`,
    [
      user.role === 'patient' ? user.patientId : null,
      user.role === 'doctor' ? user.doctorId : null,
      from ?? null, to ?? null, status ?? null, pageSize, (page - 1) * pageSize,
    ]
  );
  return rows;
}

/** Validates that startsAt is an open slot in the doctor's published schedule. */
async function resolveSlot(doctorId, startsAt) {
  const slot = (await getSlots(doctorId, localDateOf(startsAt))).find((s) => s.start === new Date(startsAt).toISOString());
  if (!slot) throw badRequest('That time is outside the doctor\'s clinic hours');
  if (!slot.available) throw conflict('That time slot is no longer available');
  return slot;
}

/**
 * Booking uses two layers against double-booking:
 *  1. A short Redis lock (SET NX) gives a fast, friendly failure for simultaneous clicks.
 *  2. The PostgreSQL EXCLUDE constraint is the real guarantee — even if Redis is bypassed.
 */
export async function book(user, input) {
  const patientId = user.role === 'patient' ? user.patientId : input.patientId;
  if (!patientId) throw badRequest('Choose a patient');
  const slot = await resolveSlot(input.doctorId, input.startsAt);

  const lockKey = `lock:slot:${input.doctorId}:${slot.start}`;
  if (!(await redis.set(lockKey, user.id, 'PX', 5000, 'NX'))) throw conflict('Someone is booking this slot right now. Pick another.');
  try {
    const { rows: [appt] } = await query(
      `INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at, type, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [patientId, input.doctorId, slot.start, slot.end, input.type, input.reason ?? null, user.id]
    );
    await afterChange(appt);
    await enqueue('appointment.confirmed', { appointmentId: appt.id });
    await scheduleReminder(appt.id, appt.starts_at);
    return appt;
  } finally {
    await redis.del(lockKey);
  }
}

async function loadOwned(user, id, client = { query }) {
  const { rows: [a] } = await client.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [id]);
  if (!a) throw notFound('Appointment');
  if (user.role === 'patient' && a.patient_id !== user.patientId) throw forbidden();
  if (user.role === 'doctor' && a.doctor_id !== user.doctorId) throw forbidden();
  return a;
}

export async function reschedule(user, id, startsAt) {
  const current = await withTransaction((c) => loadOwned(user, id, c));
  if (!ACTIVE.includes(current.status)) throw badRequest('Only upcoming appointments can be rescheduled');
  const slot = await resolveSlot(current.doctor_id, startsAt);
  const { rows: [appt] } = await query(
    `UPDATE appointments SET starts_at = $2, ends_at = $3, status = 'scheduled' WHERE id = $1 RETURNING *`,
    [id, slot.start, slot.end]
  );
  await Promise.all([afterChange(current), afterChange(appt), scheduleReminder(id, appt.starts_at)]);
  return appt;
}

export async function changeStatus(user, id, { status, cancelReason }) {
  const appt = await withTransaction(async (c) => {
    const a = await loadOwned(user, id, c);
    const allowed = TRANSITIONS[user.role]?.[a.status] ?? [];
    if (!allowed.includes(status)) throw badRequest(`Cannot change a ${a.status.replace('_', ' ')} appointment to ${status.replace('_', ' ')}`);
    const { rows: [updated] } = await c.query(
      'UPDATE appointments SET status = $2, cancel_reason = coalesce($3, cancel_reason) WHERE id = $1 RETURNING *',
      [id, status, cancelReason ?? null]
    );
    return updated;
  });
  if (['cancelled', 'no_show'].includes(status)) await cancelReminder(id);
  await afterChange(appt);
  return appt;
}

async function afterChange(appt) {
  await invalidateSlots(appt.doctor_id, appt.starts_at);
  await invalidatePattern('cache:report:*');
}
