// Secure patient ↔ doctor messaging. Stored in MongoDB (document-shaped, append-heavy),
// bodies encrypted, delivered live over Socket.IO via Redis pub/sub.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { query } from '../../db/postgres.js';
import { publishRealtime } from '../../db/redis.js';
import { validate } from '../../middleware/validate.js';
import { Conversation } from '../../models/Conversation.js';
import { Message } from '../../models/Message.js';
import { decrypt, encrypt } from '../../utils/crypto.js';
import { forbidden, notFound } from '../../utils/httpError.js';

const router = Router();
const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

/** People this user may message: patients ↔ their doctors (care relationship via appointments). */
router.get('/contacts', async (req, res) => {
  const u = req.user;
  if (!['patient', 'doctor'].includes(u.role)) return res.json([]);
  const { rows } = await query(
    u.role === 'patient'
      ? `SELECT DISTINCT d.user_id, 'Dr. ' || d.first_name || ' ' || d.last_name AS name, 'doctor' AS role, d.specialization AS detail
           FROM appointments a JOIN doctors d ON d.id = a.doctor_id WHERE a.patient_id = $1`
      : `SELECT DISTINCT p.user_id, p.first_name || ' ' || p.last_name AS name, 'patient' AS role, p.mrn AS detail
           FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.doctor_id = $1 AND p.user_id IS NOT NULL`,
    [u.role === 'patient' ? u.patientId : u.doctorId]
  );
  res.json(rows);
});

router.get('/conversations', async (req, res) => {
  const list = await Conversation.find({ 'participants.userId': req.user.id }).sort({ 'lastMessage.at': -1 }).limit(50).lean();
  res.json(list.map((c) => ({ ...c, unread: c.unread?.[req.user.id] ?? 0 })));
});

router.post('/conversations', validate({ body: z.object({ userId: z.string().uuid() }) }), async (req, res) => {
  const other = req.valid.body.userId;
  const { rows } = await query(
    `SELECT u.id, u.role, coalesce(p.first_name || ' ' || p.last_name, 'Dr. ' || d.first_name || ' ' || d.last_name) AS name
       FROM users u LEFT JOIN patients p ON p.user_id = u.id LEFT JOIN doctors d ON d.user_id = u.id
      WHERE u.id = $1 AND u.is_active`, [other]);
  const target = rows[0];
  if (!target) throw notFound('User');
  const roles = new Set([req.user.role, target.role]);
  if (!(roles.has('patient') && roles.has('doctor'))) throw forbidden('Messaging is between patients and their doctors');
  // Verify care relationship before opening a thread
  const [patientUser, doctorUser] = req.user.role === 'patient' ? [req.user.id, other] : [other, req.user.id];
  const { rowCount } = await query(
    `SELECT 1 FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN doctors d ON d.id = a.doctor_id
      WHERE p.user_id = $1 AND d.user_id = $2 LIMIT 1`, [patientUser, doctorUser]);
  if (!rowCount) throw forbidden('Book an appointment first to message this doctor');

  const key = [req.user.id, other].sort().join(':');
  const conversation = await Conversation.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, participants: [{ userId: req.user.id, name: req.user.name, role: req.user.role }, { userId: target.id, name: target.name, role: target.role }] } },
    { upsert: true, new: true }
  ).lean();
  res.status(201).json(conversation);
});

async function loadConversation(user, id) {
  const c = await Conversation.findById(id);
  if (!c) throw notFound('Conversation');
  if (!c.participants.some((p) => p.userId === user.id)) throw forbidden();
  return c;
}

// Cursor pagination on createdAt: stable and index-friendly, unlike skip/offset on a growing thread
router.get(
  '/conversations/:id/messages',
  validate({ params: z.object({ id: objectId }), query: z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }) }),
  async (req, res) => {
    await loadConversation(req.user, req.valid.params.id);
    const { before, limit } = req.valid.query;
    const filter = { conversationId: req.valid.params.id, ...(before && { createdAt: { $lt: new Date(before) } }) };
    const docs = await Message.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(docs.reverse().map(({ bodyEnc, ...m }) => ({ ...m, body: decrypt(bodyEnc) })));
  }
);

router.post(
  '/conversations/:id/messages',
  validate({ params: z.object({ id: objectId }), body: z.object({ body: z.string().trim().min(1).max(4000) }) }),
  async (req, res) => {
    const conv = await loadConversation(req.user, req.valid.params.id);
    const { body } = req.valid.body;
    const msg = await Message.create({ conversationId: conv._id, from: req.user.id, bodyEnc: encrypt(body) });
    const recipients = conv.participants.filter((p) => p.userId !== req.user.id);
    await Conversation.updateOne(
      { _id: conv._id },
      {
        $set: { lastMessage: { preview: body.slice(0, 80), at: msg.createdAt, from: req.user.id } },
        $inc: Object.fromEntries(recipients.map((r) => [`unread.${r.userId}`, 1])),
      }
    );
    const payload = { _id: msg._id, conversationId: conv._id, from: req.user.id, body, createdAt: msg.createdAt };
    await Promise.all(recipients.map((r) => publishRealtime(r.userId, 'message', payload)));
    res.status(201).json(payload);
  }
);

router.patch('/conversations/:id/read', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const conv = await loadConversation(req.user, req.valid.params.id);
  await Promise.all([
    Conversation.updateOne({ _id: conv._id }, { $set: { [`unread.${req.user.id}`]: 0 } }),
    Message.updateMany({ conversationId: conv._id, from: { $ne: req.user.id }, readAt: null }, { $set: { readAt: new Date() } }),
  ]);
  res.status(204).end();
});

export default router;
