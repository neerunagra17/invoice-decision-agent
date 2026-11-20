import { check } from '../checks.js';
import { dice } from '../../lib/text.js';

// Stage 5 · Vendor: who sent this, and are we allowed to pay them?
// Exact GSTIN match first (an identifier); fuzzy name match only as a fallback, and that always needs review.
export async function vendor(ctx) {
  const { inv, ref, rules } = ctx;
  const S = 'vendor';
  const out = [];
  if (inv.vendorGstin && inv.vendorGstin === ref.buyer.gstin) {
    // The model picked up our own GSTIN from the "Bill To" block. Don't trust it; fall back to the name.
    out.push(check('VENDOR_GSTIN_IS_BUYER', S, 'Supplier GSTIN is not our own', 'info', `Extracted supplier GSTIN ${inv.vendorGstin} is the buyer's own GSTIN; ignored, matching by name instead.`));
    inv.vendorGstin = null;
  }
  let v = inv.vendorGstin ? ref.vendors.find(x => x.gstin === inv.vendorGstin) : null;
  let how = 'GSTIN';

  if (!v && inv.vendorName) {
    const scored = ref.vendors.map(x => ({ x, s: dice(inv.vendorName, x.legalName) })).sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= rules.vendorNameMinSimilarity) {
      v = scored[0].x; how = 'name';
      out.push(check('VENDOR_MATCH', S, 'Vendor identified', 'hold',
        `No GSTIN match${inv.vendorGstin ? ` for ${inv.vendorGstin}` : ''}; matched "${inv.vendorName}" to ${v.legalName} by name only (similarity ${scored[0].s.toFixed(2)}). Confirm identity before paying.`,
        `The GSTIN on your invoice${inv.vendorGstin ? ` (${inv.vendorGstin})` : ''} does not match our vendor records. Please confirm your registered GSTIN.`));
    }
  }
  if (!v) {
    out.push(check('VENDOR_MATCH', S, 'Vendor identified', 'hold', `"${inv.vendorName ?? 'Unknown'}" (${inv.vendorGstin ?? 'no GSTIN'}) is not in the approved-vendor list.`, 'You are not yet registered as an approved vendor. Please complete vendor onboarding.'));
    ctx.run.vendor = null;
    return { summary: 'Vendor not found in the approved-vendor list', checks: out };
  }
  ctx.vendor = v;
  ctx.run.vendor = { vendorId: v.vendorId, legalName: v.legalName, gstin: v.gstin, matchedBy: how };
  if (how === 'GSTIN') out.push(check('VENDOR_MATCH', S, 'Vendor identified', 'pass', `${v.legalName} (${v.vendorId}) by GSTIN`));
  out.push(v.status === 'ACTIVE'
    ? check('VENDOR_STATUS', S, 'Vendor is active', 'pass', 'ACTIVE')
    : check('VENDOR_STATUS', S, 'Vendor is active', 'reject', `${v.legalName} is ${v.status} in the vendor master. Payments are not allowed.`, 'Your vendor account is currently not active with us, so we cannot process this invoice. Please contact our procurement team.'));
  return { summary: `${v.legalName} · ${v.vendorId} · matched by ${how}`, checks: out };
}
