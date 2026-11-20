// End-to-end pipeline on the six sample invoices, in order, with the TEST-ONLY mock extractor
// (the extraction step is replaced by fixtures; every check and decision after it is the real code).
process.env.EXTRACTOR = 'mock';
process.env.MONGODB_URI = '';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const { config } = await import('../server/config.js');
const { loadReference } = await import('../server/data/reference.js');
const { createMemoryStore } = await import('../server/store/memory.js');
const { createOrchestrator } = await import('../server/pipeline/orchestrator.js');

async function setup() {
  const ref = loadReference();
  const store = createMemoryStore();
  await store.init(ref.seedHistory);
  const orch = createOrchestrator({ store, ref });
  const run = async (file, name = file) => {
    const { run, done } = await orch.submit({ buffer: fs.readFileSync(path.join(config.samplesDir, file)), name, source: 'sample' });
    await done;
    return store.getRun(run.id);
  };
  return { run, store };
}
const failed = r => r.checks.filter(c => c.result === 'hold' || c.result === 'reject').map(c => c.id).sort();

test('the six samples, processed in order, get the expected decisions', async () => {
  const { run, store } = await setup();

  const r1 = await run('01_happy_nimbus_laptops.pdf');
  assert.equal(r1.decision, 'APPROVE');
  assert.equal(r1.status, 'completed');
  assert.ok(r1.stages.every(s => s.status === 'done'));

  const r2 = await run('02_duplicate_nimbus_resend.pdf');
  assert.equal(r2.decision, 'REJECT');
  assert.deepEqual(failed(r2), ['DUPLICATE'], 'only the duplicate should be reported, not knock-on over-billing');
  assert.match(r2.vendorMessage, /already been received/);

  const r3 = await run('03_split_overbilling_apex.pdf');
  assert.equal(r3.decision, 'HOLD');
  assert.deepEqual(failed(r3), ['LINE_QTY', 'PO_BALANCE']);
  assert.equal(r3.poBalance.remainingBeforePaise, 20000000);

  const r4 = await run('04_scanned_missing_invoice_no_shakti.pdf');
  assert.equal(r4.decision, 'HOLD');
  assert.equal(r4.scanned, true);
  assert.deepEqual(failed(r4), ['APPROVAL_LIMIT', 'GROUNDING', 'REQ_INVOICE_NUMBER'], 'scan needs a person, number missing, and ₹14.4 lakh is above the ₹10 lakh limit');
  assert.match(r4.vendorMessage, /invoice number/i);
  assert.doesNotMatch(r4.vendorMessage, /limit|scanned/i, 'internal reasons are not sent to the vendor');
  assert.equal(r4.po.poNumber, 'PO-2026-0412');
  assert.ok(r4.checks.some(c => c.id === 'POSSIBLE_DUPLICATE'), 'same-total check still runs without an invoice number');

  const r5 = await run('05_no_po_reference_ganges.pdf');
  assert.equal(r5.decision, 'HOLD', 'an inferred PO is suggested, not paid against');
  assert.deepEqual(failed(r5), ['PO_FOUND']);
  assert.equal(r5.po.poNumber, 'PO-2026-0421');
  assert.equal(r5.po.inferred, true);
  assert.ok(r5.reasons.some(n => /Inferred PO-2026-0421/.test(n)));

  const r6 = await run('06_wrong_tax_type_shakti.pdf');
  assert.equal(r6.decision, 'HOLD');
  assert.deepEqual(failed(r6), ['TAX_TYPE']);
  assert.match(r6.vendorMessage, /credit note/);

  // History: seed + one entry per run. Only approved runs use up PO balance.
  const h = await store.getHistory();
  assert.equal(h.length, 7);
  assert.deepEqual(h.filter(x => x.source === 'run').map(x => x.decision), ['APPROVE', 'REJECT', 'HOLD', 'HOLD', 'HOLD', 'HOLD']);
});

test('the same invoice uploaded twice is rejected the second time', async () => {
  const { run } = await setup();
  assert.equal((await run('01_happy_nimbus_laptops.pdf')).decision, 'APPROVE');
  assert.equal((await run('01_happy_nimbus_laptops.pdf')).decision, 'REJECT');
});

test('a held invoice does not use up the PO, and a resubmission of it is held for a person', async () => {
  const { run } = await setup();
  assert.equal((await run('06_wrong_tax_type_shakti.pdf')).decision, 'HOLD');
  const again = await run('06_wrong_tax_type_shakti.pdf');
  assert.equal(again.decision, 'HOLD');
  assert.ok(failed(again).includes('DUPLICATE'));
  assert.ok(!failed(again).includes('PO_BALANCE'));
});

test('with INFERRED_PO_POLICY=approve, a uniquely fitting PO is used and noted', async () => {
  const before = config.rules.inferredPoPolicy;
  config.rules.inferredPoPolicy = 'approve';
  try {
    const { run } = await setup();
    const r = await run('05_no_po_reference_ganges.pdf');
    assert.equal(r.decision, 'APPROVE');
    assert.ok(r.notes.some(n => /Inferred PO-2026-0421/.test(n)));
  } finally { config.rules.inferredPoPolicy = before; }
});

test('a blocked vendor is rejected', async () => {
  const { run } = await setup();
  const r = await run('04_scanned_missing_invoice_no_shakti.pdf', 'test_blocked_vendor.pdf'); // scanned file + fixture for vendor V005
  assert.equal(r.decision, 'REJECT');
  assert.ok(failed(r).includes('VENDOR_STATUS'));
});

test('a file that is not a PDF is held without calling the model', async () => {
  const ref = loadReference();
  const store = createMemoryStore();
  await store.init(ref.seedHistory);
  const orch = createOrchestrator({ store, ref });
  const { run, done } = await orch.submit({ buffer: Buffer.from('hello'), name: 'note.txt' });
  await done;
  const r = await store.getRun(run.id);
  assert.equal(r.decision, 'HOLD');
  assert.equal(r.stages.find(s => s.key === 'extract').status, 'skipped');
});

// ---- Regression tests: each probe from the decision audit must not be approved for the wrong reason ----
// The mock extractor returns the fixture named like the uploaded file; the PDF supplies the text layer for grounding.
const asRun = (setupRun, sample, fixture) => setupRun(sample, `${fixture}.pdf`);
const result = (r, id) => r.checks.filter(c => c.id === id).map(c => c.result);

test('P1: no line items and no taxable value is held, not approved', async () => {
  const { run } = await setup();
  const r = await asRun(run, '01_happy_nimbus_laptops.pdf', 'reg_p1_no_amounts');
  assert.equal(r.decision, 'HOLD');
  assert.deepEqual(failed(r), ['REQ_AMOUNTS']);
});

test('P6: a line with an unreadable quantity is held', async () => {
  const { run } = await setup();
  const r = await asRun(run, '01_happy_nimbus_laptops.pdf', 'reg_p6_null_quantity');
  assert.equal(r.decision, 'HOLD');
  assert.deepEqual(failed(r), ['LINE_FIELDS']);
});

test('P10: an unrelated item at the PO price is not matched to a one-line PO', async () => {
  const { run } = await setup();
  const r = await asRun(run, '06_wrong_tax_type_shakti.pdf', 'reg_p10_wrong_item_same_price');
  assert.equal(r.decision, 'HOLD');
  assert.deepEqual(result(r, 'LINE_MATCH'), ['hold']);
});

test('P11: a PO reference in an unknown format is held, never replaced by a guess', async () => {
  const { run } = await setup();
  const r = await asRun(run, '05_no_po_reference_ganges.pdf', 'reg_p11_unrecognised_po');
  assert.equal(r.decision, 'HOLD');
  assert.equal(r.po, null);
  assert.ok(r.reasons.some(x => /WO\/7781/.test(x) && /not a PO number in our format/.test(x)));
});

test('Decision 1 (P2): a price above the PO is held; a price below it passes', async () => {
  const { run } = await setup();
  const over = await asRun(run, '01_happy_nimbus_laptops.pdf', 'reg_p2_overpriced');
  assert.deepEqual(result(over, 'LINE_PRICE'), ['hold']);
  const under = await asRun(run, '01_happy_nimbus_laptops.pdf', 'reg_underpriced');
  assert.deepEqual(result(under, 'LINE_PRICE'), ['pass']);
});

test('Decision 4 (P3): same number, different amount is a HOLD, not a REJECT', async () => {
  const { run } = await setup();
  assert.equal((await run('01_happy_nimbus_laptops.pdf')).decision, 'APPROVE');
  const r = await asRun(run, '01_happy_nimbus_laptops.pdf', 'reg_p3_reused_number');
  assert.equal(r.decision, 'HOLD');
  assert.deepEqual(result(r, 'DUPLICATE'), ['hold']);
  assert.match(r.vendorMessage, /unique invoice number/);
  assert.deepEqual(result(r, 'PO_BALANCE'), ['hold'], 'a different bill still counts against the fully billed PO');
});

test('P4: a copy with the invoice number missing is flagged by the same-total check', async () => {
  const { run } = await setup();
  await run('01_happy_nimbus_laptops.pdf');
  const r = await asRun(run, '01_happy_nimbus_laptops.pdf', 'reg_p4_copy_without_number');
  assert.equal(r.decision, 'HOLD');
  assert.deepEqual(result(r, 'POSSIBLE_DUPLICATE'), ['hold']);
});

test('P9: an invoice dated before its PO is held', async () => {
  const { run } = await setup();
  const r = await asRun(run, '06_wrong_tax_type_shakti.pdf', 'reg_p9_before_po');
  assert.equal(r.decision, 'HOLD');
  assert.deepEqual(failed(r), ['DATE_AFTER_PO']);
});

test('Decision 5: an invoice above the auto-approval limit is held even if every other check passes', async () => {
  const before = config.rules.autoApproveLimitPaise;
  config.rules.autoApproveLimitPaise = 500000; // ₹5,000 for this test; default is ₹10 lakh
  try {
    const { run } = await setup();
    const r = await run('01_happy_nimbus_laptops.pdf');
    assert.equal(r.decision, 'HOLD');
    assert.deepEqual(failed(r), ['APPROVAL_LIMIT']);
  } finally { config.rules.autoApproveLimitPaise = before; }
});
