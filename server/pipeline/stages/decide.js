import { SEVERITY, check } from '../checks.js';
import { formatINR } from '../../lib/money.js';

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Stage 10 · Decide: precedence REJECT > HOLD > APPROVE. Every hold/reject check becomes a reason.
export async function decide(ctx) {
  const { run, inv, vendor, po, rules } = ctx;
  // Approval limit: above it, a person always approves, whatever the other checks say.
  const limit = rules.autoApproveLimitPaise;
  if (limit > 0 && inv?.totalPaise != null) {
    run.checks.push(inv.totalPaise > limit
      ? check('APPROVAL_LIMIT', 'decide', 'Within auto-approval limit', 'hold', `Total ${formatINR(inv.totalPaise)} is above the auto-approval limit of ${formatINR(limit)}; a person must approve it.`)
      : check('APPROVAL_LIMIT', 'decide', 'Within auto-approval limit', 'pass', `${formatINR(inv.totalPaise)} ≤ ${formatINR(limit)}`));
  }
  const worst = run.checks.reduce((m, c) => Math.max(m, SEVERITY[c.result]), 0);
  const decision = worst === SEVERITY.reject ? 'REJECT' : worst === SEVERITY.hold ? 'HOLD' : 'APPROVE';
  const blocking = run.checks.filter(c => c.result === (decision === 'REJECT' ? 'reject' : 'hold'));
  const others = decision === 'REJECT' ? run.checks.filter(c => c.result === 'hold') : [];
  run.decision = decision;
  run.reasons = [...blocking, ...others].map(c => c.detail);
  run.notes = run.checks.filter(c => c.result === 'info').map(c => c.detail);

  if (decision === 'APPROVE') {
    const due = inv?.invoiceDate && vendor ? addDays(inv.invoiceDate, vendor.paymentTermsDays) : null;
    run.headline = `Approve ${formatINR(inv.totalPaise)} to ${vendor.legalName} against ${po.poNumber}${ctx.poInferred ? ' (inferred)' : ''}${due ? `; due ${due} (${vendor.paymentTermsDays}-day terms)` : ''}.`;
  } else {
    const first = (blocking[0]?.detail || '').split(/(?<=\.)\s/)[0];
    run.headline = decision === 'REJECT' ? `Reject: ${first}` : `Hold for review${blocking.length > 1 ? ` (${blocking.length} issues)` : ''}: ${first}`;
  }

  // Message back to the vendor for anything not approved (only the asks that apply to this decision).
  const asks = [...new Set([...blocking, ...others].map(c => c.vendorAsk).filter(Boolean))];
  run.vendorMessage = decision !== 'APPROVE' && asks.length
    ? `Subject: Invoice ${inv?.invoiceNumber ?? '(no number)'}: ${decision === 'REJECT' ? 'not processed' : 'action needed'}\n\nDear ${vendor?.legalName ?? inv?.vendorName ?? 'Vendor'},\n\nWe received your invoice${inv?.invoiceNumber ? ` ${inv.invoiceNumber}` : ''} dated ${inv?.invoiceDateRaw ?? '(no date)'} for ${formatINR(inv?.totalPaise)}.\n\n${asks.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nRegards,\nAccounts Payable, ${ctx.ref.buyer.legal_name}`
    : null;

  // Record in history (only APPROVE consumes PO balance; all decisions are kept for duplicate checks).
  await ctx.store.addHistory({
    vendorId: vendor?.vendorId ?? null, vendorGstin: inv?.vendorGstin ?? null,
    invoiceNumber: inv?.invoiceNumber ?? null, invoiceNumberNorm: inv?.invoiceNumberNorm ?? null,
    invoiceDate: inv?.invoiceDate ?? null, poNumber: po?.poNumber ?? null, decision,
    taxablePaise: inv?.taxablePaise ?? 0, totalPaise: inv?.totalPaise ?? 0,
    lines: decision === 'APPROVE' ? (ctx.lineMatches || []) : [],
    processedAt: new Date().toISOString(), source: 'run', runId: run.id,
  });
  return { summary: `${decision}${run.reasons.length ? ` · ${run.reasons.length} reason(s)` : ''}`, checks: [] };
}
