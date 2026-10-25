import { Router } from 'express';
import { z } from 'zod';
import { env, isProd } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as auth from './auth.service.js';

const router = Router();

// Refresh token lives in an httpOnly cookie scoped to /api/auth:
// unreadable by JavaScript (XSS) and never sent cross-site (SameSite=Strict → CSRF-safe).
const COOKIE = 'rx_rt';
const cookieOpts = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000,
};

const sendSession = (res, { refreshToken, ...session }) => {
  res.cookie(COOKIE, refreshToken, cookieOpts);
  res.json(session);
};

const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/\d/, 'Add a number');

const registerSchema = z.object({
  email: z.string().email().max(254),
  password,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthDate: z.string().date(),
  sex: z.enum(['male', 'female', 'intersex', 'unspecified']).default('unspecified'),
  phone: z.string().trim().regex(/^\+?\d{10,13}$/, 'Use a mobile number like 09171234567').optional(),
});

router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
  sendSession(res.status(201), await auth.registerPatient(req.valid.body));
});

router.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ email: z.string().email(), password: z.string().min(1) }) }),
  async (req, res) => {
    const result = await auth.login(req.valid.body);
    if (result.mfaRequired) return res.json(result);
    sendSession(res, result);
  }
);

router.post(
  '/mfa/verify',
  authLimiter,
  validate({ body: z.object({ mfaToken: z.string(), code: z.string().regex(/^\d{6}$/) }) }),
  async (req, res) => sendSession(res, await auth.verifyMfaLogin(req.valid.body))
);

router.post('/refresh', async (req, res) => {
  try {
    sendSession(res, await auth.refresh(req.cookies[COOKIE]));
  } catch (err) {
    res.clearCookie(COOKIE, { path: cookieOpts.path });
    throw err;
  }
});

router.post('/logout', async (req, res) => {
  await auth.logout(req.cookies[COOKIE]);
  res.clearCookie(COOKIE, { path: cookieOpts.path });
  res.status(204).end();
});

router.get('/me', authenticate, async (req, res) => res.json(await auth.getMe(req.user.id)));

router.post('/mfa/setup', authenticate, async (req, res) => res.json(await auth.startMfaSetup(req.user.id)));

router.post(
  '/mfa/enable',
  authenticate,
  validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }) }),
  async (req, res) => {
    await auth.enableMfa(req.user.id, req.valid.body.code);
    res.json({ mfaEnabled: true });
  }
);

export default router;
