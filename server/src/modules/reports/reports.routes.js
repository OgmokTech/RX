// Analytics reads pre-aggregated materialized views + Redis cache: dashboards stay fast
// no matter how large the transactional tables grow.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/postgres.js';
import { authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { cached, cacheKeys, invalidatePattern } from '../../utils/cache.js';

const router = Router();
router.use(authorize('admin', 'doctor'));

router.get(
  '/summary',
  validate({ query: z.object({ from: z.string().date(), to: z.string().date() }) }),
  async (req, res) => {
    const { from, to } = req.valid.query;
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : null; // doctors see only their numbers
    const scope = doctorId ?? 'clinic';
    const data = await cached(cacheKeys.report(scope, from, to), 300, async () => {
      const [appts, revenue, byMethod, diagnoses, outstanding, lowStock] = await Promise.all([
        query(`SELECT day, sum(total)::int AS total, sum(completed)::int AS completed, sum(cancelled)::int AS cancelled,
                      sum(no_shows)::int AS no_shows, sum(telemedicine)::int AS telemedicine
                 FROM mv_daily_appointments WHERE day BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR doctor_id = $3)
                GROUP BY day ORDER BY day`, [from, to, doctorId]),
        query(`SELECT day, sum(amount) AS amount FROM mv_daily_revenue WHERE day BETWEEN $1 AND $2 GROUP BY day ORDER BY day`, [from, to]),
        query(`SELECT method, sum(amount) AS amount, sum(payments)::int AS payments FROM mv_daily_revenue
                WHERE day BETWEEN $1 AND $2 GROUP BY method ORDER BY amount DESC`, [from, to]),
        query(`SELECT dx AS code, count(*)::int AS count FROM encounters e, unnest(e.diagnoses) dx
                WHERE (e.created_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR e.doctor_id = $3)
                GROUP BY dx ORDER BY count DESC LIMIT 10`, [from, to, doctorId]),
        query(`SELECT coalesce(sum(balance),0) AS amount, count(*)::int AS invoices FROM invoices WHERE status IN ('issued','partially_paid')`),
        query(`SELECT count(*)::int AS count FROM inventory_items WHERE is_active AND quantity_on_hand <= reorder_level`),
      ]);
      const totals = appts.rows.reduce(
        (t, r) => ({ total: t.total + r.total, completed: t.completed + r.completed, noShows: t.noShows + r.no_shows, telemedicine: t.telemedicine + r.telemedicine }),
        { total: 0, completed: 0, noShows: 0, telemedicine: 0 }
      );
      return {
        totals: {
          ...totals,
          noShowRate: totals.total ? +(totals.noShows / totals.total).toFixed(3) : 0,
          revenue: doctorId ? null : revenue.rows.reduce((s, r) => s + r.amount, 0),
          outstanding: doctorId ? null : outstanding.rows[0],
          lowStockItems: lowStock.rows[0].count,
        },
        appointmentsByDay: appts.rows,
        revenueByDay: doctorId ? [] : revenue.rows,
        revenueByMethod: doctorId ? [] : byMethod.rows,
        topDiagnoses: diagnoses.rows,
      };
    });
    res.json(data);
  }
);

router.post('/refresh', authorize('admin'), async (_req, res) => {
  await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_appointments');
  await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue');
  await invalidatePattern('cache:report:*');
  res.json({ refreshedAt: new Date().toISOString() });
});

export default router;
