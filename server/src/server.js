import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectMongo } from './db/mongo.js';
import { pool } from './db/postgres.js';
import { redis } from './db/redis.js';
import { attachSockets } from './sockets/index.js';

async function start() {
  await pool.query('SELECT 1');
  logger.info('PostgreSQL connected');
  await connectMongo();
  await redis.ping();
  logger.info('Redis connected');

  const server = http.createServer(createApp());
  attachSockets(server);
  server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));

  // Graceful shutdown: finish in-flight requests, then close pools (Docker/K8s send SIGTERM)
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down`);
    server.close(async () => {
      await Promise.allSettled([pool.end(), mongoose.disconnect(), redis.quit()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  logger.error(err, 'Failed to start');
  process.exit(1);
});
