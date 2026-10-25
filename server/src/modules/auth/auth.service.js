import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/postgres.js';
import { redis } from '../../db/redis.js';
import { decrypt, encrypt } from '../../utils/crypto.js';
import { badRequest, HttpError, unauthorized } from '../../utils/httpError.js';

const BCRYPT_ROUNDS = 12;
const MAX_FAILED = 5;
const LOCK_SECONDS = 15 * 60;
const refreshKey = (userId, jti) => `rt:${userId}:${jti}`;

/** Loads a user together with whichever profile (patient/doctor/staff) belongs to them. */
export async function loadPrincipal(where, value) {
  const { rows } = await query(
    `SELECT u.id, u.email, u.role, u.is_active, u.password_hash, u.mfa_enabled, u.mfa_secret_enc,
            p.id AS patient_id, d.id AS doctor_id,
            coalesce(p.first_name, d.first_name, s.first_name) AS first_name,
            coalesce(p.last_name,  d.last_name,  s.last_name)  AS last_name
       FROM users u
       LEFT JOIN patients p ON p.user_id = u.id
       LEFT JOIN doctors  d ON d.user_id = u.id
       LEFT JOIN staff    s ON s.user_id = u.id
      WHERE ${where === 'email' ? 'u.email' : 'u.id'} = $1`,
    [value]
  );
  return rows[0];
}

const publicUser = (u) => ({
  id: u.id, email: u.email, role: u.role, firstName: u.first_name, lastName: u.last_name,
  patientId: u.patient_id, doctorId: u.doctor_id, mfaEnabled: u.mfa_enabled,
});

async function issueTokens(u) {
  const name = `${u.first_name} ${u.last_name}`;
  const accessToken = jwt.sign(
    { sub: u.id, role: u.role, pid: u.patient_id, did: u.doctor_id, name },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL, algorithm: 'HS256' }
  );
  const jti = crypto.randomUUID();
  const ttl = env.REFRESH_TOKEN_TTL_DAYS * 86400;
  const refreshToken = jwt.sign({ sub: u.id, jti }, env.JWT_REFRESH_SECRET, { expiresIn: ttl, algorithm: 'HS256' });
  await redis.set(refreshKey(u.id, jti), '1', 'EX', ttl); // server-side allow-list → instant revocation
  return { accessToken, refreshToken, user: publicUser(u) };
}

export async function revokeAllSessions(userId) {
  const stream = redis.scanStream({ match: `rt:${userId}:*`, count: 100 });
  for await (const keys of stream) if (keys.length) await redis.del(...keys);
}

export async function registerPatient(input) {
  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const userId = await withTransaction(async (c) => {
    const { rows: [u] } = await c.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'patient') RETURNING id`,
      [input.email, hash]
    );
    await c.query(
      `INSERT INTO patients (user_id, first_name, last_name, birth_date, sex, phone, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [u.id, input.firstName, input.lastName, input.birthDate, input.sex, input.phone, input.email]
    );
    return u.id;
  });
  return issueTokens(await loadPrincipal('id', userId));
}

export async function login({ email, password }) {
  const lockKey = `login:fail:${email.toLowerCase()}`;
  const failures = Number(await redis.get(lockKey)) || 0;
  if (failures >= MAX_FAILED) throw new HttpError(429, 'Account temporarily locked after failed attempts. Try again in 15 minutes.');

  const user = await loadPrincipal('email', email);
  // Always run bcrypt, even for unknown emails, so response time doesn't reveal which emails exist
  const ok = await bcrypt.compare(password, user?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !ok || !user.is_active) {
    await redis.multi().incr(lockKey).expire(lockKey, LOCK_SECONDS).exec();
    throw unauthorized('Email or password is incorrect');
  }
  await redis.del(lockKey);

  if (user.mfa_enabled) {
    const mfaToken = jwt.sign({ sub: user.id, purpose: 'mfa' }, env.JWT_ACCESS_SECRET, { expiresIn: '5m' });
    return { mfaRequired: true, mfaToken };
  }
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return issueTokens(user);
}

export async function verifyMfaLogin({ mfaToken, code }) {
  let payload;
  try {
    payload = jwt.verify(mfaToken, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Verification expired. Sign in again.');
  }
  if (payload.purpose !== 'mfa') throw unauthorized();
  const user = await loadPrincipal('id', payload.sub);
  if (!user?.is_active || !authenticator.verify({ token: code, secret: decrypt(user.mfa_secret_enc) })) {
    throw unauthorized('That code is incorrect or expired');
  }
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return issueTokens(user);
}

/** Refresh-token rotation with reuse detection. */
export async function refresh(token) {
  if (!token) throw unauthorized();
  let p;
  try {
    p = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized();
  }
  const deleted = await redis.del(refreshKey(p.sub, p.jti));
  if (!deleted) {
    // A rotated-out token was presented again → likely stolen. Kill every session for this user.
    await revokeAllSessions(p.sub);
    throw unauthorized('Session ended for your security. Sign in again.');
  }
  const user = await loadPrincipal('id', p.sub);
  if (!user?.is_active) throw unauthorized();
  return issueTokens(user);
}

export async function logout(token) {
  try {
    const p = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    await redis.del(refreshKey(p.sub, p.jti));
  } catch {
    /* already invalid — nothing to revoke */
  }
}

export async function getMe(userId) {
  return publicUser(await loadPrincipal('id', userId));
}

export async function startMfaSetup(userId) {
  const user = await loadPrincipal('id', userId);
  if (user.mfa_enabled) throw badRequest('Two-factor authentication is already on');
  const secret = authenticator.generateSecret();
  await redis.set(`mfa:pending:${userId}`, secret, 'EX', 600);
  return { secret, otpauthUrl: authenticator.keyuri(user.email, env.CLINIC_NAME, secret) };
}

export async function enableMfa(userId, code) {
  const secret = await redis.get(`mfa:pending:${userId}`);
  if (!secret) throw badRequest('Setup expired. Start again.');
  if (!authenticator.verify({ token: code, secret })) throw badRequest('That code is incorrect');
  await query('UPDATE users SET mfa_enabled = true, mfa_secret_enc = $2 WHERE id = $1', [userId, encrypt(secret)]);
  await redis.del(`mfa:pending:${userId}`);
}
