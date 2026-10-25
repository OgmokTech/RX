import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// numeric(12,2) → JS number for JSON responses; money math is done in centavos (see billing/totals.js)
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
// Keep DATE columns as 'YYYY-MM-DD' strings — avoids timezone shifts on birthdays
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000, // kill runaway queries
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

/** Parameterized query only — never interpolate user input into SQL. */
export const query = (text, params) => pool.query(text, params);

/** Runs fn(client) inside BEGIN/COMMIT, rolling back on any error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
