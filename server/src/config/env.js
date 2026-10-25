// Validates configuration once at startup: fail fast instead of failing at 2 AM.
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  MONGO_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters (32 bytes)'),
  CLINIC_NAME: z.string().default('RX Family Clinic'),
  CLINIC_UTC_OFFSET: z.string().regex(/^[+-]\d{2}:\d{2}$/).default('+08:00'),
  TAX_RATE: z.coerce.number().min(0).max(1).default(0),
  JITSI_DOMAIN: z.string().default('meet.jit.si'),
  SMTP_URL: z.string().optional().default(''),
  MAIL_FROM: z.string().default('RX Clinic <no-reply@rxclinic.local>'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
