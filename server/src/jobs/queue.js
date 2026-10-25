// BullMQ job queue on Redis: slow or retryable work (SMS, email, pharmacy hand-off,
// report refresh) leaves the request path, so API latency stays low.
import { Queue } from 'bullmq';
import { createRedis } from '../db/redis.js';

export const QUEUE_NAME = 'clinic-jobs';

export const jobQueue = new Queue(QUEUE_NAME, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});

export const enqueue = (name, data, opts = {}) => jobQueue.add(name, data, opts);

/** Schedules (or re-schedules) the 24-hour reminder for an appointment. Idempotent via jobId. */
export async function scheduleReminder(appointmentId, startsAt) {
  const jobId = `reminder-${appointmentId}`;
  await (await jobQueue.getJob(jobId))?.remove();
  const delay = new Date(startsAt).getTime() - Date.now() - 24 * 3600_000;
  if (delay > 0) await enqueue('appointment.reminder', { appointmentId }, { jobId, delay });
}

export async function cancelReminder(appointmentId) {
  await (await jobQueue.getJob(`reminder-${appointmentId}`))?.remove();
}
