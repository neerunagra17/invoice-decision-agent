// Runs the 10 stages in order, records each one's status/timing/result on the run, and pushes every change to the UI.
import crypto from 'crypto';
import { config } from '../config.js';
import { extractorLabel } from '../llm/index.js';
import { check } from './checks.js';
import { intake } from './stages/intake.js';
import { read } from './stages/read.js';
import { extract } from './stages/extract.js';
import { validate } from './stages/validate.js';
import { vendor } from './stages/vendor.js';
import { po } from './stages/po.js';
import { lines } from './stages/lines.js';
import { tax } from './stages/tax.js';
import { duplicates } from './stages/duplicates.js';
import { decide } from './stages/decide.js';

export const STAGES = [
  { key: 'intake', label: 'Receive file', fn: intake },
  { key: 'read', label: 'Read PDF', fn: read },
  { key: 'extract', label: 'Extract fields (LLM)', fn: extract },
  { key: 'validate', label: 'Validate invoice', fn: validate },
  { key: 'vendor', label: 'Match vendor', fn: vendor },
  { key: 'po', label: 'Find purchase order', fn: po },
  { key: 'lines', label: 'Match lines & PO balance', fn: lines },
  { key: 'tax', label: 'Check GST', fn: tax },
  { key: 'duplicates', label: 'Check duplicates', fn: duplicates },
  { key: 'decide', label: 'Decide', fn: decide },
];

export function newRun({ fileName, fileSize, source }) {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    fileName, fileSize, source,
    status: 'queued',
    extractor: extractorLabel(),
    stages: STAGES.map(s => ({ key: s.key, label: s.label, status: 'pending', startedAt: null, endedAt: null, ms: null, summary: null })),
    checks: [],
    decision: null, headline: null, reasons: [], notes: [], vendorMessage: null,
    extracted: null, vendor: null, po: null, amounts: null, invoiceNumber: null, scanned: null, pages: null, model: null,
    durationMs: null,
  };
}

export function createOrchestrator({ store, ref, emit = () => {} }) {
  // Runs are processed one at a time: the duplicate check and PO balance must see the previous run's decision.
  let chain = Promise.resolve();
  const queued = [];

  async function save(run) {
    await store.updateRun(run.id, run);
    emit(run);
  }

  async function process(run, file) {
    const ctx = { run, file, ref, rules: config.rules, store, history: await store.getHistory() };
    ctx.balanceHistory = ctx.history; // narrowed after extraction, see below
    const t0 = Date.now();
    run.status = 'running';
    await save(run);
    let stopped = false; // after a failed read/extract there is nothing to check; jump to Decide

    for (const s of STAGES) {
      const st = run.stages.find(x => x.key === s.key);
      if (stopped && s.key !== 'decide') {
        Object.assign(st, { status: 'skipped', summary: 'Skipped: invoice could not be read' });
        continue;
      }
      st.status = 'running'; st.startedAt = new Date().toISOString();
      await save(run);
      const t = Date.now();
      let res;
      try {
        res = await s.fn(ctx);
      } catch (e) {
        console.error(`[run ${run.id.slice(0, 8)}] stage ${s.key} crashed:`, e);
        res = { status: 'failed', summary: `Error: ${e.message}`, checks: [check('INTERNAL', s.key, `${s.label} completed`, 'hold', `Processing error in "${s.label}": ${e.message}`)] };
      }
      run.checks.push(...(res.checks || []));
      Object.assign(st, { status: res.status || 'done', summary: res.summary, endedAt: new Date().toISOString(), ms: Date.now() - t });
      if (st.status === 'failed' && s.key !== 'decide') stopped = true;
      if (s.key === 'extract' && ctx.inv?.invoiceNumberNorm) {
        // PO balance ignores earlier copies of this same invoice; otherwise a re-sent duplicate would also be
        // reported as over-billing its own PO. The duplicate check (stage 9) deals with those copies.
        const vendorId = ref.vendors.find(v => v.gstin === ctx.inv.vendorGstin)?.vendorId;
        // Same number but a different amount is a different bill, so its billing still counts against the PO.
        const sameAmount = h => ctx.inv.totalPaise == null || h.totalPaise == null || Math.abs(h.totalPaise - ctx.inv.totalPaise) <= config.rules.arithmeticTolPaise;
        const sameInvoice = h => h.invoiceNumberNorm === ctx.inv.invoiceNumberNorm && sameAmount(h) && ((vendorId && h.vendorId === vendorId) || (h.vendorGstin && h.vendorGstin === ctx.inv.vendorGstin));
        ctx.balanceHistory = ctx.history.filter(h => !sameInvoice(h));
      }
      await save(run);
    }
    run.status = run.decision ? 'completed' : 'failed';
    run.durationMs = Date.now() - t0;
    await save(run);
  }

  return {
    // Creates the run immediately (so the UI can open it) and processes it in the background.
    async submit({ buffer, name, mime = 'application/pdf', source = 'upload' }) {
      const run = newRun({ fileName: name, fileSize: buffer.length, source });
      await store.createRun(run);
      await store.saveFile(run.id, { name, mime, buffer });
      emit(run);
      queued.push(run.id);
      const done = chain.then(async () => {
        queued.splice(queued.indexOf(run.id), 1);
        try { await process(run, { buffer, name }); } catch (e) {
          console.error(`[run ${run.id.slice(0, 8)}] failed:`, e);
          run.status = 'failed'; run.error = e.message;
          await save(run).catch(() => {});
        }
      });
      chain = done.catch(() => {});
      return { run, done };
    },
    queueLength: () => queued.length,
  };
}
