import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/postgres.js';
import { redis } from '../../db/redis.js';
import { enqueue } from '../../jobs/queue.js';
import { audit } from '../../middleware/audit.js';
import { authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, notFound } from '../../utils/httpError.js';
import { pageQuery, paged } from '../../utils/pagination.js';

const router = Router();
router.use(authorize('admin', 'receptionist', 'doctor'));
const idParam = z.object({ id: z.string().uuid() });
const canManage = authorize('admin', 'receptionist');

const itemBody = z.object({
  sku: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  category: z.enum(['medicine', 'supply', 'equipment', 'reagent']),
  unit: z.string().trim().max(20).default('pc'),
  reorderLevel: z.number().int().min(0).default(10),
  unitCost: z.number().nonnegative().default(0),
  expiryDate: z.string().date().nullable().optional(),
});

router.get(
  '/',
  validate({ query: z.object({ search: z.string().trim().max(80).optional(), lowStock: z.enum(['true', 'false']).optional(), ...pageQuery }) }),
  async (req, res) => {
    const { search, lowStock, page, pageSize } = req.valid.query;
    const { rows } = await query(
      `SELECT id, sku, name, category, unit, reorder_level, quantity_on_hand, unit_cost, expiry_date, updated_at,
              (quantity_on_hand <= reorder_level) AS is_low,
              (expiry_date IS NOT NULL AND expiry_date <= current_date + 60) AS expiring_soon,
              count(*) OVER() AS total_count
         FROM inventory_items
        WHERE is_active
          AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR sku = upper($1))
          AND ($2::boolean IS NOT TRUE OR quantity_on_hand <= reorder_level)
        ORDER BY (quantity_on_hand <= reorder_level) DESC, name
        LIMIT $3 OFFSET $4`,
      [search || null, lowStock === 'true', pageSize, (page - 1) * pageSize]
    );
    res.json(paged(rows, { page, pageSize }));
  }
);

router.post('/', canManage, validate({ body: itemBody.extend({ initialQuantity: z.number().int().min(0).default(0) }) }), audit('create', 'inventory_item'), async (req, res) => {
  const b = req.valid.body;
  const item = await withTransaction(async (c) => {
    const { rows: [it] } = await c.query(
      `INSERT INTO inventory_items (sku, name, category, unit, reorder_level, unit_cost, expiry_date)
       VALUES (upper($1),$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.sku, b.name, b.category, b.unit, b.reorderLevel, b.unitCost, b.expiryDate ?? null]
    );
    if (b.initialQuantity > 0) {
      await c.query(`INSERT INTO inventory_transactions (item_id, change, reason, reference, created_by) VALUES ($1,$2,'restock','Opening stock',$3)`, [it.id, b.initialQuantity, req.user.id]);
    }
    return it;
  });
  res.status(201).json(item);
});

router.patch('/:id', canManage, validate({ params: idParam, body: itemBody.partial() }), audit('update', 'inventory_item'), async (req, res) => {
  const b = req.valid.body;
  const { rows: [it] } = await query(
    `UPDATE inventory_items SET name = coalesce($2, name), category = coalesce($3, category), unit = coalesce($4, unit),
            reorder_level = coalesce($5, reorder_level), unit_cost = coalesce($6, unit_cost), expiry_date = coalesce($7, expiry_date), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [req.valid.params.id, b.name, b.category, b.unit, b.reorderLevel, b.unitCost, b.expiryDate]
  );
  if (!it) throw notFound('Item');
  res.json(it);
});

// Stock movements go through the ledger; the DB trigger updates quantity_on_hand atomically
router.post(
  '/:id/transactions',
  validate({
    params: idParam,
    body: z.object({ change: z.number().int().refine((n) => n !== 0, 'Change cannot be zero'), reason: z.enum(['restock', 'dispense', 'adjustment', 'expired', 'return']), reference: z.string().trim().max(120).optional() }),
  }),
  audit('create', 'inventory_transaction'),
  async (req, res) => {
    const { change, reason, reference } = req.valid.body;
    if (['restock', 'return'].includes(reason) && change < 0) throw badRequest('Restock and return must add stock');
    if (['dispense', 'expired'].includes(reason) && change > 0) throw badRequest('Dispense and expired must remove stock');
    try {
      await query('INSERT INTO inventory_transactions (item_id, change, reason, reference, created_by) VALUES ($1,$2,$3,$4,$5)',
        [req.valid.params.id, change, reason, reference ?? null, req.user.id]);
    } catch (err) {
      if (err.code === '23514') throw badRequest('Not enough stock for that quantity');
      throw err;
    }
    const { rows: [it] } = await query('SELECT id, quantity_on_hand, reorder_level FROM inventory_items WHERE id = $1', [req.valid.params.id]);
    // Alert once per day per item (Redis NX key) instead of on every dispense
    if (it.quantity_on_hand <= it.reorder_level && (await redis.set(`alert:lowstock:${it.id}`, '1', 'EX', 86400, 'NX'))) {
      await enqueue('inventory.low', { itemId: it.id });
    }
    res.status(201).json(it);
  }
);

router.get('/:id/transactions', validate({ params: idParam }), async (req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.change, t.reason, t.reference, t.created_at, u.email AS created_by
       FROM inventory_transactions t LEFT JOIN users u ON u.id = t.created_by
      WHERE t.item_id = $1 ORDER BY t.created_at DESC LIMIT 100`, [req.valid.params.id]);
  res.json(rows);
});

export default router;
