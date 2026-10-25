import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    type: { type: String, required: true },     // appointment.reminder, lab.resulted, inventory.low...
    title: String,
    body: String,
    link: String,
    channels: [String],                        // in_app, email, sms
    readAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
// TTL index: notifications expire automatically after 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const Notification = mongoose.model('Notification', notificationSchema);
