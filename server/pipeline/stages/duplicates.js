import { check } from '../checks.js';
import { formatINR } from '../../lib/money.js';

const daysBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

// Stage 9 · Duplicates: has this invoice been processed before?
// Matching on vendor + invoice number (not on the file) catches re-sent copies with a different layout or scan.
// REJECT only when certain (same vendor, same number, same amount as an approved invoice); anything less certain is a HOLD.
export async function duplicates(ctx) {
  const { inv, vendor, rules } = ctx;
  const S = 'duplicates';
  const sameVendor = h => (vendor ? h.vendorId === vendor.vendorId : h.vendorGstin && h.vendorGstin === inv.vendorGstin);
  const sameAmount = h => inv.totalPaise != null && h.totalPaise != null && Math.abs(h.totalPaise - inv.totalPaise) <= rules.arithmeticTolPaise;
  const out = [];

  if (inv.invoiceNumberNorm) {
    const prior = ctx.history.filter(h => sameVendor(h) && h.invoiceNumberNorm === inv.invoiceNumberNorm);
    const approvedSame = prior.find(h => h.decision === 'APPROVE' && sameAmount(h));
    const approvedOther = prior.find(h => h.decision === 'APPROVE');
    const when = h => `${h.processedAt?.slice(0, 10)}${h.runId ? ` in run ${h.runId.slice(0, 8)}` : ''}`;
    if (approvedSame) {
      out.push(check('DUPLICATE', S, 'Not already processed', 'reject',
        `Duplicate of invoice ${approvedSame.invoiceNumber} (${formatINR(approvedSame.totalPaise)}) already approved on ${when(approvedSame)}. Same vendor, number and amount: paying again would be a double payment.`,
        `Invoice ${inv.invoiceNumber} has already been received and approved for payment on ${approvedSame.processedAt?.slice(0, 10)}. This copy will not be processed again.`));
    } else if (approvedOther) {
      out.push(check('DUPLICATE', S, 'Not already processed', 'hold',
        `Invoice number ${inv.invoiceNumber} was already used on an invoice for ${formatINR(approvedOther.totalPaise)} approved on ${when(approvedOther)}; this one is for ${formatINR(inv.totalPaise)}. Same number, different amount: confirm with the vendor whether it is a new invoice.`,
        `Invoice number ${inv.invoiceNumber} was already used on an earlier invoice for ${formatINR(approvedOther.totalPaise)}. If this is a new invoice, please re-issue it with a unique invoice number.`));
    } else if (prior.length) {
      const p = prior[prior.length - 1];
      out.push(check('DUPLICATE', S, 'Not already processed', 'hold', `Invoice ${p.invoiceNumber} was submitted before (decision: ${p.decision}). Treat as a resubmission and compare with the earlier copy.`));
    } else {
      out.push(check('DUPLICATE', S, 'Not already processed', 'pass', `No earlier invoice ${inv.invoiceNumber} from this vendor`));
    }
  }

  // Possible duplicate: same vendor, same total, close dates, under a different (or no) number.
  // Runs even when the invoice number is missing, which is when it matters most.
  if (inv.totalPaise !== null && inv.invoiceDate) {
    const near = ctx.history.filter(h => sameVendor(h)
      && (!inv.invoiceNumberNorm || h.invoiceNumberNorm !== inv.invoiceNumberNorm)
      && h.totalPaise === inv.totalPaise && h.invoiceDate && daysBetween(h.invoiceDate, inv.invoiceDate) <= rules.possibleDuplicateWindowDays);
    out.push(near.length
      ? check('POSSIBLE_DUPLICATE', S, 'No near-identical invoice', 'hold', `Same vendor and same total (${formatINR(inv.totalPaise)}) as invoice ${near[0].invoiceNumber ?? '(no number)'} dated ${near[0].invoiceDate}${inv.invoiceNumberNorm ? ', under a different number' : ''}.`)
      : check('POSSIBLE_DUPLICATE', S, 'No near-identical invoice', 'pass', `No invoice from this vendor for ${formatINR(inv.totalPaise)} within ${rules.possibleDuplicateWindowDays} days`));
  }

  if (!out.length) return { status: 'skipped', summary: 'Skipped: no invoice number, total or date to compare', checks: [] };
  const worst = out.find(c => c.result === 'reject') ? 'Duplicate found' : out.find(c => c.result === 'hold') ? 'Possible duplicate' : 'No duplicates';
  return { summary: worst, checks: out };
}
