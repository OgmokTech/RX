-- =====================================================================
-- Reporting layer: pre-aggregated materialized views.
-- Dashboards read tiny aggregates instead of scanning transactional tables.
-- Refreshed CONCURRENTLY by the background worker (no read locks).
-- =====================================================================
CREATE MATERIALIZED VIEW mv_daily_appointments AS
SELECT (a.starts_at AT TIME ZONE 'Asia/Manila')::date AS day,
       a.doctor_id,
       count(*)                                          AS total,
       count(*) FILTER (WHERE a.status = 'completed')    AS completed,
       count(*) FILTER (WHERE a.status = 'cancelled')    AS cancelled,
       count(*) FILTER (WHERE a.status = 'no_show')      AS no_shows,
       count(*) FILTER (WHERE a.type = 'telemedicine')   AS telemedicine
  FROM appointments a
 GROUP BY 1, 2;
CREATE UNIQUE INDEX uq_mv_daily_appt ON mv_daily_appointments (day, doctor_id);

CREATE MATERIALIZED VIEW mv_daily_revenue AS
SELECT (p.paid_at AT TIME ZONE 'Asia/Manila')::date AS day,
       p.method,
       sum(p.amount)  AS amount,
       count(*)       AS payments
  FROM payments p
 WHERE p.status = 'succeeded'
 GROUP BY 1, 2;
CREATE UNIQUE INDEX uq_mv_daily_rev ON mv_daily_revenue (day, method);
