// Real-time channel. Each user joins a private room `user:<id>`.
// Events are published to Redis by any process (API or worker) and fanned out here,
// so this also works with several API instances behind a load balancer.
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createRedis, REALTIME_CHANNEL } from '../db/redis.js';

export function attachSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: env.CLIENT_ORIGIN, credentials: true }, path: '/socket.io' });

  io.use((socket, next) => {
    try {
      const p = jwt.verify(socket.handshake.auth?.token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
      if (p.purpose) throw new Error('bad token');
      socket.data.userId = p.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => socket.join(`user:${socket.data.userId}`));

  const sub = createRedis();
  sub.subscribe(REALTIME_CHANNEL);
  sub.on('message', (_channel, raw) => {
    try {
      const { userId, event, data } = JSON.parse(raw);
      io.to(`user:${userId}`).emit(event, data);
    } catch (err) {
      logger.error({ err }, 'Bad realtime payload');
    }
  });

  return io;
}
