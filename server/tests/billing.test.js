import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeInvoiceTotals } from '../src/modules/billing/totals.js';

const items = [{ quantity: 1, unitPrice: 600 }, { quantity: 3, unitPrice: 0.1 }];

test('sums without floating-point drift', () => {
  assert.deepEqual(computeInvoiceTotals(items), { subtotal: 600.3, discount: 0, tax: 0, total: 600.3 });
});

test('senior citizen: 20% discount and VAT-exempt', () => {
  const t = computeInvoiceTotals([{ quantity: 1, unitPrice: 1000 }], { discountType: 'senior', taxRate: 0.12 });
  assert.deepEqual(t, { subtotal: 1000, discount: 200, tax: 0, total: 800 });
});

test('manual discount is capped at subtotal and tax applies after discount', () => {
  const t = computeInvoiceTotals([{ quantity: 2, unitPrice: 500 }], { discountType: 'manual', manualDiscount: 100, taxRate: 0.12 });
  assert.deepEqual(t, { subtotal: 1000, discount: 100, tax: 108, total: 1008 });
  assert.equal(computeInvoiceTotals(items, { discountType: 'manual', manualDiscount: 9999 }).total, 0);
});
