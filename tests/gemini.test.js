// The Gemini client must survive busy (503), hanging (timeout) and unknown (404) models by moving on,
// and must fail with an error (which becomes an EXTRACTION hold) when nothing answers. Uses a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { extractWithGemini } from '../server/llm/gemini.js';

const ok = text => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const err = status => new Response(JSON.stringify({ error: { code: status } }), { status });
const hang = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

async function withFakeGemini(handler, fn) {
  const saved = { fetch: globalThis.fetch, gemini: { ...config.gemini } };
  Object.assign(config.gemini, { apiKey: 'test', model: 'model-a', fallbackModels: ['model-b', 'model-c'], timeoutMs: 50, totalBudgetMs: 20000, attemptsPerModel: 2, retryBaseMs: 1 });
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const model = url.match(/models\/([^:]+):/)[1];
    const body = JSON.parse(opts.body);
    calls.push({ model, generationConfig: body.generationConfig });
    return handler(model, opts, calls.length);
  };
  const log = console.log; console.log = () => {};
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout timers don't keep a test process alive on their own
  try { return await fn(calls); } finally { clearInterval(keepAlive); globalThis.fetch = saved.fetch; Object.assign(config.gemini, saved.gemini); console.log = log; }
}

test('busy model, then a hanging model, then a working one: the third answers', async () => {
  await withFakeGemini(
    (model, opts) => model === 'model-a' ? err(503) : model === 'model-b' ? hang(opts.signal) : ok('{"invoice_number":{"value":"X1"}}'),
    async calls => {
      const { raw, model } = await extractWithGemini(Buffer.from('%PDF-1.4'));
      assert.equal(model, 'model-c');
      assert.equal(raw.invoice_number.value, 'X1');
      assert.deepEqual(calls.map(c => c.model), ['model-a', 'model-a', 'model-b', 'model-c'], '503 retried once, timeout moves on at once');
      assert.deepEqual(calls[0].generationConfig, { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } });
    });
});

test('a rejected setting (400) retries the same model with fewer settings', async () => {
  await withFakeGemini(
    (model, opts, n) => n === 1 ? err(400) : ok('{"a":1}'),
    async calls => {
      const { model } = await extractWithGemini(Buffer.from('%PDF-1.4'));
      assert.equal(model, 'model-a');
      assert.deepEqual(calls[1].generationConfig, { responseMimeType: 'application/json' });
    });
});

test('nothing answers: an error is thrown (the run is held), never a result', async () => {
  await withFakeGemini(
    () => err(503),
    async () => { await assert.rejects(extractWithGemini(Buffer.from('%PDF-1.4')), /All Gemini models failed/); });
});

test('a bad key stops at once instead of trying every model', async () => {
  await withFakeGemini(
    () => err(403),
    async calls => {
      await assert.rejects(extractWithGemini(Buffer.from('%PDF-1.4')), /403/);
      assert.equal(calls.length, 1);
    });
});
