import { logger } from '../config/logger.js';
import { HttpError } from '../utils/httpError.js';

// Translate PostgreSQL constraint violations into meaningful HTTP responses
const PG_ERRORS = {
  '23505': [409, 'That record already exists'],
  '23P01': [409, 'That time slot was just taken. Pick another slot.'],
  '23503': [400, 'A referenced record does not exist'],
  '23514': [400, 'A value is outside the allowed range'],
  '22P02': [400, 'Invalid identifier format'],
};

export function notFoundHandler(req, res) {
  res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }
  if (err.code && PG_ERRORS[err.code]) {
    const [status, message] = PG_ERRORS[err.code];
    return res.status(status).json({ message, constraint: err.constraint });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON body' });

  logger.error({ err, path: req.originalUrl }, 'Unhandled error');
  // Never leak stack traces or SQL to clients
  res.status(500).json({ message: 'Something went wrong on our side. Try again shortly.' });
}
