// Audit trail: who touched which record, when, from where. Written to MongoDB
// after a successful response, off the request's critical path.
import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

export const audit = (action, resource) => (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    AuditLog.create({
      actor: { id: req.user?.id, role: req.user?.role, name: req.user?.name },
      action,
      resource,
      resourceId: res.locals.resourceId ?? req.params.id ?? req.params.patientId ?? null,
      patientId: res.locals.patientId ?? req.params.patientId ?? null,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch((err) => logger.error({ err }, 'Failed to write audit log'));
  });
  next();
};
