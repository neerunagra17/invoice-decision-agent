import { check } from '../checks.js';
import { poUsage } from '../../data/reference.js';
import { descriptionSimilarity } from '../../lib/text.js';
import { formatINR } from '../../lib/money.js';

// How far an invoice may exceed the PO's remaining balance (rounding only).
export function balanceTolerance(remainingPaise, rules) {
  return rules.poBalanceTolPaise;
}

// An invoice cannot be for work ordered after it was issued.
function dateAfterPo(inv, p) {
  if (!inv.invoiceDate || !p.poDate) return [];
  return [inv.invoiceDate >= p.poDate
    ? check('DATE_AFTER_PO', 'po', 'Invoice dated on or after the PO', 'pass', `Invoice ${inv.invoiceDate}, PO ${p.poDate}`)
    : check('DATE_AFTER_PO', 'po', 'Invoice dated on or after the PO', 'hold', `Invoice is dated ${inv.invoiceDate}, before ${p.poNumber} was issued on ${p.poDate}.`,
      `Your invoice is dated ${inv.invoiceDateRaw}, which is before our purchase order ${p.poNumber} (${p.poDate}). Please confirm the invoice date.`)];
}

// Stage 6 · Purchase order: which PO does this bill against?
// Explicit reference -> look it up. No reference -> suggest one, but only if exactly one open PO of this vendor fits.
export async function po(ctx) {
  const { inv, ref, rules, vendor } = ctx;
  const S = 'po';
  if (!vendor) return { status: 'skipped', summary: 'Skipped: vendor unknown', checks: [] };
  const history = ctx.balanceHistory;

  // A PO reference was printed but is not in a format we recognise: never replace it with our own guess.
  if (!inv.poRef && inv.poRefRaw && String(inv.poRefRaw).trim()) {
    ctx.run.po = null;
    return {
      summary: `PO reference "${inv.poRefRaw}" not recognised`,
      checks: [check('PO_FOUND', S, 'PO reference recognised', 'hold', `Invoice quotes "${inv.poRefRaw}", which is not a PO number in our format (PO-YYYY-NNNN). It was not matched to any PO.`,
        `We could not match the PO reference "${inv.poRefRaw}" on your invoice to our records. Please confirm the purchase order number.`)],
    };
  }

  if (inv.poRef) {
    const p = ref.pos.find(x => x.poNumber === inv.poRef);
    const shown = inv.poRefRaw !== inv.poRef ? `"${inv.poRefRaw}" → ${inv.poRef}` : inv.poRef;
    if (!p) return { summary: `${shown} not found`, checks: [check('PO_FOUND', S, 'PO exists', 'hold', `Invoice quotes ${shown}, which does not exist in the PO register.`, `We could not find purchase order ${inv.poRefRaw} in our records. Please confirm the PO number.`)] };
    if (p.vendorId !== vendor.vendorId) return { summary: `${p.poNumber} belongs to another vendor`, checks: [check('PO_FOUND', S, 'PO belongs to this vendor', 'hold', `${p.poNumber} was issued to vendor ${p.vendorId}, not ${vendor.vendorId}.`, `PO ${inv.poRefRaw} was not issued to your company. Please confirm the PO number.`)] };
    ctx.po = p; ctx.poInferred = false;
    ctx.run.po = { poNumber: p.poNumber, inferred: false, quotedAs: inv.poRefRaw };
    const out = [check('PO_FOUND', S, 'PO identified', 'pass', `${shown} (quoted on invoice)`)];
    out.push(p.status === 'OPEN' ? check('PO_OPEN', S, 'PO is open', 'pass', 'OPEN') : check('PO_OPEN', S, 'PO is open', 'hold', `${p.poNumber} is ${p.status}.`, `PO ${p.poNumber} is closed. Please contact our procurement team.`));
    out.push(...dateAfterPo(inv, p));
    return { summary: `${p.poNumber} · quoted on invoice${inv.poRefRaw !== inv.poRef ? ` as "${inv.poRefRaw}"` : ''}`, checks: out };
  }

  // No PO quoted: try to infer from this vendor's open POs.
  const taxable = inv.taxablePaise ?? 0;
  const candidates = ref.pos.filter(p => p.vendorId === vendor.vendorId && p.status === 'OPEN').map(p => {
    const u = poUsage(p, history);
    const sim = Math.max(0, ...inv.lines.flatMap(il => p.lines.map(pl => descriptionSimilarity(il.description, pl.description))));
    const fitsAmount = taxable <= u.remainingPaise + balanceTolerance(u.remainingPaise, rules);
    return { p, remainingPaise: u.remainingPaise, sim, fitsAmount, ok: fitsAmount && sim >= rules.inferredPoMinSimilarity };
  });
  const fits = candidates.filter(c => c.ok);
  const describe = c => `${c.p.poNumber} (remaining ${formatINR(c.remainingPaise)}, description similarity ${c.sim.toFixed(2)}${c.fitsAmount ? '' : ', amount does not fit'})`;

  if (fits.length === 1) {
    const c = fits[0];
    ctx.po = c.p; ctx.poInferred = true;
    ctx.run.po = { poNumber: c.p.poNumber, inferred: true, evidence: describe(c), rejected: candidates.filter(x => x !== c).map(describe) };
    const result = rules.inferredPoPolicy === 'approve' ? 'info' : 'hold';
    return {
      summary: `No PO quoted · inferred ${c.p.poNumber} (1 of ${candidates.length} open POs fits)${result === 'hold' ? ' · needs confirmation' : ''}`,
      checks: [check('PO_FOUND', S, 'PO identified', result,
        `${result === 'hold' ? `No PO quoted; suggested ${c.p.poNumber}, which a person must confirm before payment.` : 'No PO quoted.'} Inferred ${describe(c)}. Other open POs: ${candidates.filter(x => x !== c).map(describe).join('; ') || 'none'}.`,
        result === 'hold' ? 'Your invoice does not quote a purchase order number. Please confirm the PO number it is billed against, and quote it on future invoices.' : null),
      ...dateAfterPo(inv, c.p)],
    };
  }
  ctx.run.po = null;
  const why = fits.length === 0 ? `none of the vendor's ${candidates.length} open PO(s) fits` : `${fits.length} open POs fit equally`;
  return {
    summary: `No PO quoted · could not infer (${why})`,
    checks: [check('PO_FOUND', S, 'PO identified', 'hold', `No PO quoted and ${why}: ${candidates.map(describe).join('; ') || 'no open POs'}.`, 'Your invoice does not quote a purchase order number. Please share the PO number this invoice is against.')],
  };
}
