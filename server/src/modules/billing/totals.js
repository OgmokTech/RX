// Pure invoice math in integer centavos — floating point never touches money.

/**
 * Senior citizens (RA 9994) and PWDs (RA 10754) get a 20% discount and VAT exemption
 * on medical services. Other invoices may carry a manual peso discount.
 * @param {{quantity:number, unitPrice:number}[]} items
 * @param {{discountType?:'none'|'senior'|'pwd'|'manual', manualDiscount?:number, taxRate?:number}} opts
 */
export function computeInvoiceTotals(items, { discountType = 'none', manualDiscount = 0, taxRate = 0 } = {}) {
  const c = (n) => Math.round(Number(n) * 100);
  const subtotal = items.reduce((sum, i) => sum + Math.round(c(i.unitPrice) * Number(i.quantity)), 0);

  let discount = 0;
  let tax = 0;
  if (discountType === 'senior' || discountType === 'pwd') {
    discount = Math.round(subtotal * 0.2);
  } else {
    discount = Math.min(c(discountType === 'manual' ? manualDiscount : 0), subtotal);
    tax = Math.round((subtotal - discount) * taxRate);
  }
  const total = subtotal - discount + tax;
  const peso = (n) => n / 100;
  return { subtotal: peso(subtotal), discount: peso(discount), tax: peso(tax), total: peso(total) };
}
