import mongoose from 'mongoose';

// Append-only, write-heavy, flexible shape → MongoDB is a better fit than Postgres.
const auditSchema = new mongoose.Schema(
  {
    actor: { id: String, role: String, name: String },
    action: { type: String, required: true },   // e.g. 'view', 'create', 'update'
    resource: { type: String, required: true }, // e.g. 'patient_chart', 'prescription'
    resourceId: String,
    patientId: String,                          // "who accessed my record?" (Data Privacy Act access requests)
    method: String,
    path: String,
    ip: String,
    userAgent: String,
    at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

auditSchema.index({ patientId: 1, at: -1 });
auditSchema.index({ 'actor.id': 1, at: -1 });
auditSchema.index({ resource: 1, at: -1 });

export const AuditLog = mongoose.model('AuditLog', auditSchema);
