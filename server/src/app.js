import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { pool } from './db/postgres.js';
import { redis } from './db/redis.js';
import mongoose from 'mongoose';

import adminRoutes from './modules/admin/admin.routes.js';
import appointmentRoutes from './modules/appointments/appointments.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import billingRoutes from './modules/billing/billing.routes.js';
import doctorRoutes from './modules/doctors/doctors.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import labRoutes from './modules/labs/labs.routes.js';
import messageRoutes from './modules/messages/messages.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import patientRoutes from './modules/patients/patients.routes.js';
import prescriptionRoutes from './modules/prescriptions/prescriptions.routes.js';
import recordRoutes from './modules/records/records.routes.js';
import reportRoutes from './modules/reports/reports.routes.js';
import telemedicineRoutes from './modules/telemedicine/telemedicine.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // correct client IPs behind Nginx / load balancer (rate limits, audit)

  app.use(helmet());                                                     // secure headers (CSP, HSTS, nosniff...)
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));       // only our web client
  app.use(express.json({ limit: '200kb' }));                             // bounded bodies
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', async (_req, res) => {
    const checks = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()]);
    const ok = checks.every((c) => c.status === 'fulfilled') && mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', time: new Date().toISOString() });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);

  // Everything below requires a valid access token
  const secured = express.Router();
  secured.use(authenticate);
  secured.use('/patients', patientRoutes);
  secured.use('/doctors', doctorRoutes);
  secured.use('/appointments', appointmentRoutes);
  secured.use('/inventory', inventoryRoutes);
  secured.use('/reports', reportRoutes);
  secured.use('/admin', adminRoutes);
  secured.use('/messages', messageRoutes);
  secured.use('/notifications', notificationRoutes);
  secured.use('/telemedicine', telemedicineRoutes);
  secured.use('/', recordRoutes);        // /patients/:id/chart, /encounters ...
  secured.use('/', prescriptionRoutes);  // /prescriptions, /drugs, /pharmacies
  secured.use('/', labRoutes);           // /lab-orders, /lab-tests
  secured.use('/', billingRoutes);       // /invoices, /claims, /patients/:id/policies
  app.use('/api', secured);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
