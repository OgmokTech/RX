import { Router } from 'express';
import { Notification } from '../../models/Notification.js';

const router = Router();

router.get('/', async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(30).lean(),
    Notification.countDocuments({ userId: req.user.id, readAt: null }),
  ]);
  res.json({ items, unread });
});

router.patch('/read-all', async (req, res) => {
  await Notification.updateMany({ userId: req.user.id, readAt: null }, { $set: { readAt: new Date() } });
  res.status(204).end();
});

export default router;
