import { check } from '../checks.js';
import { poUsage } from '../../data/reference.js';
import { descriptionSimilarity } from '../../lib/text.js';
import { formatINR } from '../../lib/money.js';
import { balanceTolerance } from './po.js';

// Stage 7 · Lines & balance: does each billed line correspond to a PO line, at the PO price,
// within the quantity still open, and does the invoice fit the PO's remaining balance?
export async function lines(ctx) {
  const { inv, rules, po } = ctx;
  const S = 'lines';
  if (!po) return { status: 'skipped', summary: 'Skipped: no PO', checks: [] };
  const usage = poUsage(po, ctx.balanceHistory);
  const out = [];
  const billedByPoLine = new Map();
  ctx.lineMatches = [];

  for (const il of inv.lines) {
    const scored = usage.lines.map(pl => {
      const sim = descriptionSimilarity(il.description, pl.description);
      // Price closeness only helps decide WHICH PO line this is; it never accepts a price.
      const priceClose = il.unitPricePaise != null && Math.abs(il.unitPricePaise - pl.unitPricePaise) <= pl.unitPricePaise * rules.priceMatchPct / 100;
      return { pl, sim, score: sim * 0.7 + (priceClose ? 0.3 : 0) };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    // The description must match; a matching price alone is not enough to pair a line with a PO line.
    if (!best || best.sim < rules.lineMatchMinSimilarity) {
      out.push(check('LINE_MATCH', S, `Line ${il.n} matches a PO line`, 'hold', `"${il.description}" does not correspond to any line of ${po.poNumber}.`, `Line "${il.description}" is not part of PO ${po.poNumber}. Please bill it against the correct PO.`));
      continue;
    }
    const pl = best.pl;
    out.push(check('LINE_MATCH', S, `Line ${il.n} matches a PO line`, 'pass', `"${il.description}" → PO line ${pl.lineNo} "${pl.description}" (similarity ${best.sim.toFixed(2)})`));
    // Never above the agreed price (beyond ₹1 rounding); below it is accepted.
    const over = il.unitPricePaise == null ? null : il.unitPricePaise - pl.unitPricePaise;
    out.push(over !== null && over <= rules.unitPriceUpTolPaise
      ? check('LINE_PRICE', S, `Line ${il.n} price within PO price`, 'pass', `${formatINR(il.unitPricePaise)} vs PO ${formatINR(pl.unitPricePaise)}${over < -rules.unitPriceUpTolPaise ? ' (below the PO price)' : ''}`)
      : check('LINE_PRICE', S, `Line ${il.n} price within PO price`, 'hold', `Billed at ${formatINR(il.unitPricePaise)}; PO line ${pl.lineNo} price is ${formatINR(pl.unitPricePaise)}. Prices above the PO are not accepted beyond ${formatINR(rules.unitPriceUpTolPaise)} rounding.`, `Line "${il.description}" is billed at ${formatINR(il.unitPricePaise)} but the agreed PO price is ${formatINR(pl.unitPricePaise)}. Please re-issue at the PO price, or share an approved PO amendment.`));
    billedByPoLine.set(pl.lineNo, (billedByPoLine.get(pl.lineNo) || 0) + (il.qty || 0));
    ctx.lineMatches.push({ poLineNo: pl.lineNo, qty: il.qty || 0, taxablePaise: il.amountPaise || 0 });
  }

  for (const [lineNo, qty] of billedByPoLine) {
    const pl = usage.lines.find(l => l.lineNo === lineNo);
    out.push(qty <= pl.remainingQty
      ? check('LINE_QTY', S, `PO line ${lineNo} quantity available`, 'pass', `Billing ${qty} ${pl.unit}; ${pl.remainingQty} open (ordered ${pl.qty}, already billed ${pl.billedQty})`)
      : check('LINE_QTY', S, `PO line ${lineNo} quantity available`, 'hold', `Billing ${qty} ${pl.unit} against PO line ${lineNo}, which has only ${pl.remainingQty} open (ordered ${pl.qty}, already billed ${pl.billedQty}). Over by ${qty - pl.remainingQty}.`, `You have billed ${qty} ${pl.unit} of "${pl.description}", but PO ${po.poNumber} has only ${pl.remainingQty} open. Please share an approved PO amendment for the extra ${qty - pl.remainingQty}, or re-issue for ${pl.remainingQty}.`));
  }

  const taxable = inv.taxablePaise ?? 0;
  const tol = balanceTolerance(usage.remainingPaise, rules);
  const over = taxable - usage.remainingPaise;
  out.push(taxable <= usage.remainingPaise + tol
    ? check('PO_BALANCE', S, 'Invoice fits remaining PO balance', 'pass', `${formatINR(taxable)} of ${formatINR(usage.remainingPaise)} remaining (PO ${formatINR(po.totalPaise)}, already billed ${formatINR(usage.billedPaise)})`)
    : check('PO_BALANCE', S, 'Invoice fits remaining PO balance', 'hold', usage.remainingPaise <= 0
      ? `${po.poNumber} is already fully billed (${formatINR(usage.billedPaise)} of ${formatINR(po.totalPaise)}); this invoice adds ${formatINR(taxable)}.`
      : `${formatINR(taxable)} exceeds the remaining ${formatINR(usage.remainingPaise)} on ${po.poNumber} by ${formatINR(over)} (+${Math.round(over / usage.remainingPaise * 100)}%). PO total ${formatINR(po.totalPaise)}, already billed ${formatINR(usage.billedPaise)}.`));

  ctx.run.poBalance = { poTotalPaise: po.totalPaise, billedBeforePaise: usage.billedPaise, remainingBeforePaise: usage.remainingPaise };
  const problems = out.filter(c => c.result === 'hold').length;
  return { summary: problems ? `${problems} problem(s) against ${po.poNumber}` : `All lines match ${po.poNumber}; within balance`, checks: out };
}
