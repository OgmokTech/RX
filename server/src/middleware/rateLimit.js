import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../db/redis.js';

// Redis-backed so limits hold across multiple API instances behind a load balancer
const store = (prefix) => new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix });

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: store('rl:api:'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Wait 15 minutes and try again.' },
  store: store('rl:auth:'),
});
