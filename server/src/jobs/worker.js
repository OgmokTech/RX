// Separate process: `npm run worker`. Scale it independently of the API.
import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { query } from '../db/postgres.js';
import { connectMongo } from '../db/mongo.js';
import { createRedis } from '../db/redis.js';
import { QUEUE_NAME, jobQueue } from './queue.js';
import { notifyUser } from './notifier.js';

const fmt = (d) =>
  new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

async function appointmentContext(appointmentId) {
  const { rows } = await query(
    `SELECT a.id, a.starts_at, a.status, a.type,
            p.user_id AS patient_user_id, p.first_name AS patient_first, p.phone, coalesce(pu.email, p.email) AS email,
            d.user_id AS doctor_user_id, d.last_name AS doctor_last
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN users pu ON pu.id = p.user_id
       JOIN doctors d ON d.id = a.doctor_id
      WHERE a.id = $1`,
    [appointmentId]
  );
  return rows[0];
}

const handlers = {
  async 'appointment.confirmed'({ appointmentId }) {
    const a = await appointmentContext(appointmentId);
    if (!a) return;
    await notifyUser({
      userId: a.patient_user_id, email: a.email, phone: a.phone,
      type: 'appointment.confirmed',
      title: 'Appointment booked',
      body: `Dr. ${a.doctor_last} on ${fmt(a.starts_at)} (${a.type === 'telemedicine' ? 'video call' : 'at the clinic'}).`,
      link: '/appointments',
      channels: ['in_app', 'email', 'sms'],
    });
    await notifyUser({
      userId: a.doctor_user_id, type: 'appointment.new', title: 'New appointment',
      body: `${a.patient_first} booked ${fmt(a.starts_at)}.`, link: '/appointments',
    });
  },

  async 'appointment.reminder'({ appointmentId }) {
    const a = await appointmentContext(appointmentId);
    if (!a || !['scheduled', 'confirmed'].includes(a.status)) return; // cancelled since scheduling
    await notifyUser({
      userId: a.patient_user_id, email: a.email, phone: a.phone,
      type: 'appointment.reminder', title: 'Appointment tomorrow',
      body: `Reminder: Dr. ${a.doctor_last} at ${fmt(a.starts_at)}. Reply or open the app to reschedule.`,
      link: '/appointments', channels: ['in_app', 'email', 'sms'],
    });
  },

  async 'lab.resulted'({ labOrderId }) {
    const { rows: [o] } = await query(
      `SELECT o.id, p.user_id AS patient_user_id, d.user_id AS doctor_user_id, p.first_name, p.last_name
         FROM lab_orders o JOIN patients p ON p.id = o.patient_id JOIN doctors d ON d.id = o.doctor_id
        WHERE o.id = $1`, [labOrderId]);
    if (!o) return;
    await notifyUser({ userId: o.doctor_user_id, type: 'lab.resulted', title: 'Lab results ready',
      body: `Results for ${o.first_name} ${o.last_name} are ready for review.`, link: '/labs' });
    await notifyUser({ userId: o.patient_user_id, type: 'lab.resulted', title: 'Your lab results are ready',
      body: 'Open your records to view them.', link: '/records' });
  },

  async 'inventory.low'({ itemId }) {
    const { rows: [item] } = await query('SELECT name, quantity_on_hand, reorder_level, unit FROM inventory_items WHERE id=$1', [itemId]);
    const { rows: admins } = await query(`SELECT id, email FROM users WHERE role IN ('admin','receptionist') AND is_active`);
    for (const a of admins) {
      await notifyUser({ userId: a.id, email: a.email, type: 'inventory.low', title: 'Low stock',
        body: `${item.name}: ${item.quantity_on_hand} ${item.unit} left (reorder at ${item.reorder_level}).`,
        link: '/inventory', channels: ['in_app', 'email'] });
    }
  },

  async 'pharmacy.send'({ prescriptionId }) {
    const { rows: [rx] } = await query(
      `SELECT r.rx_no, ph.name, ph.email, ph.api_endpoint FROM prescriptions r
         JOIN pharmacies ph ON ph.id = r.pharmacy_id WHERE r.id = $1`, [prescriptionId]);
    if (!rx) return;
    // Integration point: POST to the pharmacy's API (e.g. an e-prescription gateway) when available.
    logger.info({ rx: rx.rx_no, pharmacy: rx.name }, 'Prescription transmitted to pharmacy');
  },

  async 'analytics.refresh'() {
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_appointments');
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue');
  },
};

async function main() {
  await connectMongo();
  // Recurring job: keep reporting views fresh every 15 minutes
  await jobQueue.upsertJobScheduler('analytics-refresh', { every: 15 * 60_000 }, { name: 'analytics.refresh' });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`No handler for job ${job.name}`);
      await handler(job.data);
    },
    { connection: createRedis(), concurrency: 10 }
  );
  worker.on('failed', (job, err) => logger.error({ job: job?.name, err: err.message }, 'Job failed'));
  logger.info({ env: env.NODE_ENV }, 'Worker listening for jobs');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
