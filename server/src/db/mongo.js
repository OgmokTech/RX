import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

mongoose.set('strictQuery', true);

export async function connectMongo() {
  await mongoose.connect(env.MONGO_URL, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });
  logger.info('MongoDB connected');
}
