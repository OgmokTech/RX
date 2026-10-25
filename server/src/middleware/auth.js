import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../db/postgres.js';
import { redis } from '../db/redis.js';
import { cacheKeys } from '../utils/cache.js';
import { forbidden, unauthorized } from '../utils/httpError.js';

/** Verifies the short-lived access token (Authorization: Bearer ...). */
export function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    const p = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (p.purpose) return next(unauthorized()); // reject MFA-challenge tokens here
    req.user = { id: p.sub, role: p.role, patientId: p.pid ?? null, doctorId: p.did ?? null, name: p.name };
    next();
  } catch {
    next(unauthorized('Your session has expired. Sign in again.'));
  }
}

/** Role-based access control: authorize('doctor', 'admin') */
export const authorize = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());

/**
 * Row-level access to a patient's data.
 *  - patient: only their own record
 *  - doctor: demographics always; clinical data only with a care relationship (an appointment)
 *  - admin/receptionist: demographics and billing, never clinical notes (least privilege)
 */
export async function assertPatientAccess(user, patientId, { clinical = false } = {}) {
  if (user.role === 'patient') {
    if (user.patientId !== patientId) throw forbidden();
    return;
  }
  if (user.role === 'doctor') {
    if (!clinical) return;
    const key = cacheKeys.care(user.doctorId, patientId);
    if (await redis.get(key)) return;
    const { rowCount } = await query(
      'SELECT 1 FROM appointments WHERE doctor_id = $1 AND patient_id = $2 LIMIT 1',
      [user.doctorId, patientId]
    );
    if (!rowCount) throw forbidden('You can open a patient chart once the patient has an appointment with you');
    await redis.set(key, '1', 'EX', 300);
    return;
  }
  if (clinical) throw forbidden('Clinical records are limited to the patient and their doctors');
}
