import { z } from 'zod';

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const toOffset = ({ page, pageSize }) => ({ limit: pageSize, offset: (page - 1) * pageSize });

/** Uses count(*) OVER() so one query returns the page and the total. */
export const paged = (rows, { page, pageSize }) => ({
  data: rows.map(({ total_count, ...r }) => r),
  meta: { page, pageSize, total: rows[0]?.total_count ?? 0 },
});
