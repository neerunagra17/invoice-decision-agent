// gemini-pick.mjs — which Gemini model answers right now, and does it read sample 01 correctly?
// Run from the invoice-agent folder:  node --env-file=.env tools/gemini-pick.mjs
import fs from 'fs';
import { EXTRACTION_PROMPT } from '../server/llm/prompt.js';
import { ExtractionSchema } from '../server/llm/schema.js';

const key = process.env.GEMINI_API_KEY;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
const secs = t => ((Date.now() - t) / 1000).toFixed(1) + 's';
const MODELS = (process.env.MODELS || 'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.8-flash,gemini-3.5-flash').split(',').map(s => s.trim()).filter(Boolean);
// Gemini 3.x uses thinkingLevel; 2.5 uses thinkingBudget (0 = off).
const thinking = m => m.startsWith('gemini-2.5') ? { thinkingBudget: 0 } : { thinkingLevel: 'low' };

async function post(model, parts, generationConfig, ms) {
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST', headers, signal: AbortSignal.timeout(ms),
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
    const j = await r.json();
    return { status: r.status, j, time: secs(t) };
  } catch (e) { return { status: e.name, j: null, time: secs(t) }; }
}

// What sample 01 really says (from tests/fixtures/extractions/01_happy_nimbus_laptops.json)
const expected = JSON.parse(fs.readFileSync('tests/fixtures/extractions/01_happy_nimbus_laptops.json', 'utf8'));
const v = f => (f && typeof f === 'object' && 'value' in f) ? f.value : f;
const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
const fields = x => ({
  invoice_number: v(x.invoice_number), invoice_date: v(x.invoice_date), vendor_gstin: v(x.vendor_gstin),
  po_reference: v(x.po_reference), lines: x.line_items?.length,
  quantities: x.line_items?.map(l => Number(l.quantity)).join('/'), unit_prices: x.line_items?.map(l => Number(l.unit_price)).join('/'),
  taxable_value: Number(v(x.taxable_value)), tax: (x.taxes || []).map(t => `${t.type} ${Number(t.rate_percent)}% ${Number(t.amount)}`).join(' + '),
  total_amount: Number(v(x.total_amount)),
});

const pdf = fs.readFileSync('samples/01_happy_nimbus_laptops.pdf').toString('base64');
for (const model of MODELS) {
  const ping = await post(model, [{ text: 'Reply with the word OK.' }], { thinkingConfig: thinking(model) }, 30000);
  if (ping.status !== 200) { console.log(`${model}: ping ${ping.status} in ${ping.time} → skip${ping.j?.error?.message ? ' · ' + ping.j.error.message.slice(0, 120) : ''}`); continue; }
  const ex = await post(model, [{ inline_data: { mime_type: 'application/pdf', data: pdf } }, { text: EXTRACTION_PROMPT }],
    { responseMimeType: 'application/json', thinkingConfig: thinking(model) }, 90000);
  if (ex.status !== 200) { console.log(`${model}: ping OK in ${ping.time}, extraction ${ex.status} in ${ex.time}${ex.j ? ' · ' + JSON.stringify(ex.j).slice(0, 160) : ''}`); continue; }
  const text = (ex.j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  let raw; try { raw = JSON.parse(text.replace(/^```(?:json)?\s*|```\s*$/g, '')); } catch { console.log(`${model}: extraction in ${ex.time} but not valid JSON`); continue; }
  const parsed = ExtractionSchema.safeParse(raw);
  const got = fields(raw), want = fields(expected);
  const diffs = Object.keys(want).filter(k => norm(got[k]) !== norm(want[k]));
  console.log(`${model}: ping OK in ${ping.time} · extraction HTTP 200 in ${ex.time} · schema ${parsed.success ? 'OK' : 'FAILED'} · ${Object.keys(want).length - diffs.length}/${Object.keys(want).length} fields match`);
  for (const k of diffs) console.log(`   ${k}: got ${JSON.stringify(got[k])}, expected ${JSON.stringify(want[k])}`);
}
