import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  // Never let tokens, passwords or clinical notes reach the log files
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.notes', '*.token'],
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
