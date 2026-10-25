import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/** maxRetriesPerRequest:null is required by BullMQ for blocking connections. */
export const createRedis = () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const redis = createRedis();
redis.on('error', (err) => logger.error({ err }, 'Redis error'));

export const REALTIME_CHANNEL = 'realtime:events';

/** Push an event to a user's open browser tabs, from the API or the worker process. */
export const publishRealtime = (userId, event, data) =>
  redis.publish(REALTIME_CHANNEL, JSON.stringify({ userId, event, data }));
