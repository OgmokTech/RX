// Channel adapters. With no credentials configured they log to the console,
// so the whole flow works on a developer laptop.
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { publishRealtime } from '../db/redis.js';
import { Notification } from '../models/Notification.js';

const mailer = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

export async function sendEmail(to, subject, text) {
  if (!to) return;
  if (!mailer) return logger.info({ to, subject }, '[email:console] %s', text);
  await mailer.sendMail({ from: env.MAIL_FROM, to, subject, text });
}

export async function sendSms(to, body) {
  if (!to) return;
  if (!env.TWILIO_ACCOUNT_SID) return logger.info({ to }, '[sms:console] %s', body);
  // Twilio REST API directly — no SDK dependency needed
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio responded ${res.status}`); // BullMQ retries with backoff
}

/** In-app notification + live push + optional email/SMS. */
export async function notifyUser({ userId, email, phone, type, title, body, link, channels = ['in_app'] }) {
  if (userId) {
    const doc = await Notification.create({ userId, type, title, body, link, channels });
    await publishRealtime(userId, 'notification', doc.toObject());
  }
  if (channels.includes('email')) await sendEmail(email, title, body);
  if (channels.includes('sms')) await sendSms(phone, `${title}: ${body}`);
}
