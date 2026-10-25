// Cache-aside helper over Redis. Keys are namespaced and always carry a TTL,
// so a missed invalidation can never serve stale data for long.
import { redis } from '../db/redis.js';

export async function cached(key, ttlSeconds, loader) {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);
  const value = await loader();
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  return value;
}

export const invalidate = (...keys) => (keys.length ? redis.del(...keys) : 0);

/** Delete keys matching a pattern using SCAN (non-blocking, unlike KEYS). */
export async function invalidatePattern(pattern) {
  const stream = redis.scanStream({ match: pattern, count: 200 });
  for await (const keys of stream) if (keys.length) await redis.del(...keys);
}

export const cacheKeys = {
  doctors: () => 'cache:doctors',
  slots: (doctorId, date) => `cache:slots:${doctorId}:${date}`,
  drugs: (q) => `cache:drugs:${(q || '').toLowerCase()}`,
  labTests: () => 'cache:lab-tests',
  report: (scope, from, to) => `cache:report:${scope}:${from}:${to}`,
  care: (doctorId, patientId) => `cache:care:${doctorId}:${patientId}`,
};
