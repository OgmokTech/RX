import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/postgres.js';
import { cached, cacheKeys, invalidate, invalidatePattern } from '../../utils/cache.js';
import { generateSlots, weekdayOf } from './availability.js';

export const listDoctors = () =>
  cached(cacheKeys.doctors(), 300, async () => {
    const { rows } = await query(
      `SELECT d.id, d.user_id, d.first_name, d.last_name, d.specialization, d.consultation_fee, d.bio, d.is_accepting
         FROM doctors d JOIN users u ON u.id = d.user_id
        WHERE u.is_active ORDER BY d.last_name`
    );
    return rows;
  });

/** Clinic-local day boundaries as timestamptz values. */
const dayRange = (date) => {
  const start = new Date(`${date}T00:00:00${env.CLINIC_UTC_OFFSET}`);
  return [start, new Date(start.getTime() + 86_400_000)];
};

export async function getSlots(doctorId, date) {
  // Short TTL: slot grids are read constantly while patients browse; bookings invalidate the key
  return cached(cacheKeys.slots(doctorId, date), 60, async () => {
    const [from, to] = dayRange(date);
    const [schedules, booked, timeOff] = await Promise.all([
      query('SELECT start_time, end_time, slot_minutes FROM doctor_schedules WHERE doctor_id = $1 AND weekday = $2', [doctorId, weekdayOf(date)]),
      query(`SELECT starts_at, ends_at FROM appointments
              WHERE doctor_id = $1 AND status IN ('scheduled','confirmed','checked_in')
                AND starts_at < $3 AND ends_at > $2`, [doctorId, from, to]),
      query(`SELECT lower(period) AS start, upper(period) AS end FROM doctor_time_off
              WHERE doctor_id = $1 AND period && tstzrange($2, $3)`, [doctorId, from, to]),
    ]);
    return generateSlots({
      date, utcOffset: env.CLINIC_UTC_OFFSET,
      schedules: schedules.rows, booked: booked.rows, timeOff: timeOff.rows,
    });
  });
}

/** Clinic-local calendar date ('YYYY-MM-DD') of an instant. */
export const localDateOf = (isoDateTime) =>
  new Date(new Date(isoDateTime).getTime() + offsetMs()).toISOString().slice(0, 10);

export const invalidateSlots = (doctorId, isoDateTime) => invalidate(cacheKeys.slots(doctorId, localDateOf(isoDateTime)));

function offsetMs() {
  const [, sign, h, m] = env.CLINIC_UTC_OFFSET.match(/([+-])(\d{2}):(\d{2})/);
  return (sign === '-' ? -1 : 1) * (Number(h) * 60 + Number(m)) * 60_000;
}

export const getSchedule = async (doctorId) =>
  (await query('SELECT weekday, start_time, end_time, slot_minutes FROM doctor_schedules WHERE doctor_id = $1 ORDER BY weekday, start_time', [doctorId])).rows;

export async function replaceSchedule(doctorId, blocks) {
  await withTransaction(async (c) => {
    await c.query('DELETE FROM doctor_schedules WHERE doctor_id = $1', [doctorId]);
    for (const b of blocks) {
      await c.query(
        'INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes) VALUES ($1,$2,$3,$4,$5)',
        [doctorId, b.weekday, b.startTime, b.endTime, b.slotMinutes]
      );
    }
  });
  await invalidatePattern(`cache:slots:${doctorId}:*`);
}

export async function addTimeOff(doctorId, { start, end, reason }) {
  const { rows: [row] } = await query(
    `INSERT INTO doctor_time_off (doctor_id, period, reason) VALUES ($1, tstzrange($2, $3), $4) RETURNING id`,
    [doctorId, start, end, reason ?? null]
  );
  await invalidatePattern(`cache:slots:${doctorId}:*`);
  return row;
}

export async function dashboard(doctorId) {
  const [today, pendingLabs, stats] = await Promise.all([
    query(`SELECT a.id, a.starts_at, a.ends_at, a.status, a.type, a.reason, p.id AS patient_id,
                  p.first_name || ' ' || p.last_name AS patient_name, p.mrn
             FROM appointments a JOIN patients p ON p.id = a.patient_id
            WHERE a.doctor_id = $1
              AND a.starts_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila'
              AND a.starts_at <  (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') + interval '1 day') AT TIME ZONE 'Asia/Manila'
            ORDER BY a.starts_at`, [doctorId]),
    query(`SELECT o.id, o.status, o.priority, o.ordered_at, p.first_name || ' ' || p.last_name AS patient_name
             FROM lab_orders o JOIN patients p ON p.id = o.patient_id
            WHERE o.doctor_id = $1 AND o.status NOT IN ('resulted','cancelled')
            ORDER BY o.priority DESC, o.ordered_at LIMIT 10`, [doctorId]),
    query(`SELECT count(*) FILTER (WHERE status IN ('scheduled','confirmed') AND starts_at > now()) AS upcoming,
                  count(DISTINCT patient_id) AS patients
             FROM appointments WHERE doctor_id = $1`, [doctorId]),
  ]);
  return { today: today.rows, pendingLabs: pendingLabs.rows, stats: stats.rows[0] };
}
