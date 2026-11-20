import { check } from '../checks.js';
import { formatINR, within } from '../../lib/money.js';
import { gstinStateCode } from '../../lib/normalise.js';

const STATES = { '09': 'Uttar Pradesh', '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka', '07': 'Delhi', '19': 'West Bengal', '33': 'Tamil Nadu', '36': 'Telangana' };

// Stage 8 · GST: right tax type for where the supply is from/to, right rate, right amount.
// Same state as the buyer -> CGST + SGST; different state -> IGST.
export async function tax(ctx) {
  const { inv, ref, vendor, po, rules } = ctx;
  const S = 'tax';
  const supplierState = vendor?.stateCode || gstinStateCode(inv.vendorGstin);
  if (!supplierState) return { status: 'skipped', summary: 'Skipped: supplier state unknown', checks: [] };
  const buyerState = ref.buyer.state_code;
  const interState = supplierState !== buyerState;
  const types = [...new Set(inv.taxes.map(t => t.type))];
  const name = c => `${STATES[c] || 'state'} (${c})`;
  const out = [];

  const expected = interState ? 'IGST' : 'CGST + SGST';
  const typeOk = interState ? types.length === 1 && types[0] === 'IGST' : types.includes('CGST') && types.includes('SGST') && !types.includes('IGST');
  out.push(typeOk
    ? check('TAX_TYPE', S, 'Correct GST type', 'pass', `${interState ? 'Inter-state' : 'Intra-state'} supply (${name(supplierState)} → ${name(buyerState)}): ${expected}`)
    : check('TAX_TYPE', S, 'Correct GST type', 'hold',
      `Supplier is in ${name(supplierState)} and the buyer in ${name(buyerState)}, so this is ${interState ? 'an inter-state' : 'an intra-state'} supply requiring ${expected}, but the invoice charges ${types.join(' + ') || 'no GST'}. We could not claim input tax credit on it.`,
      `Your invoice charges ${types.join(' + ') || 'no GST'}, but this is ${interState ? 'an inter-state' : 'an intra-state'} supply (${name(supplierState)} → ${name(buyerState)}) that requires ${expected}. Please cancel it with a credit note and re-issue with ${expected}.`));

  const totalRate = inv.taxes.reduce((s, t) => s + (t.ratePct || 0), 0);
  const poRate = po?.lines?.[0]?.taxRatePct ?? 18;
  out.push(Math.abs(totalRate - poRate) < 0.01
    ? check('TAX_RATE', S, 'GST rate matches PO', 'pass', `${totalRate}%`)
    : check('TAX_RATE', S, 'GST rate matches PO', 'hold', `Invoice charges ${totalRate}% in total; the PO specifies ${poRate}%.`, `The GST rate on your invoice (${totalRate}%) differs from the agreed rate (${poRate}%). Please re-issue.`));

  const taxSum = inv.taxes.reduce((s, t) => s + (t.amountPaise || 0), 0);
  if (inv.taxablePaise !== null) {
    const expectedTax = Math.round(inv.taxablePaise * totalRate / 100);
    out.push(within(taxSum, expectedTax, rules.arithmeticTolPaise * Math.max(1, inv.taxes.length))
      ? check('TAX_AMOUNT', S, 'Tax amount = taxable × rate', 'pass', `${formatINR(taxSum)}`)
      : check('TAX_AMOUNT', S, 'Tax amount = taxable × rate', 'hold', `Tax charged ${formatINR(taxSum)}; ${totalRate}% of ${formatINR(inv.taxablePaise)} is ${formatINR(expectedTax)}.`, 'The tax amount on the invoice is not consistent with the rate. Please re-check.'));
  }
  const problems = out.filter(c => c.result === 'hold').length;
  return { summary: problems ? `${problems} GST problem(s)` : `${expected} at ${totalRate}%: correct`, checks: out };
}
