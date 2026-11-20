// Gemini extraction: sends the PDF itself (works for digital and scanned PDFs) and asks for JSON.
// Only this file talks to Gemini. Every failure here ends in an EXTRACTION hold, never an approval.
import { config } from '../config.js';
import { EXTRACTION_PROMPT } from './prompt.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Gemini 3.x takes a thinking level; 2.x takes a thinking budget (0 = off). Extraction needs little thinking.
function thinkingFor(model) {
  return /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: config.gemini.thinkingLevel };
}

// One HTTP call. A timeout or network error is returned as a status, not thrown, so the caller can move on.
async function call(model, body, timeoutMs) {
  const t = Date.now();
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text(), ms: Date.now() - t };
  } catch (e) {
    const status = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'network';
    return { status, text: `${e.name}: ${e.message}`, ms: Date.now() - t };
  }
}

function parseJsonFromModel(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Model did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const models = () => [...new Set([config.gemini.model, ...config.gemini.fallbackModels])];
const transient = s => s === 429 || s === 'timeout' || s === 'network' || (typeof s === 'number' && s >= 500);

export async function extractWithGemini(pdfBuffer) {
  if (!config.gemini.apiKey) throw new Error('GEMINI_API_KEY is not set');
  const contents = [{ role: 'user', parts: [
    { inline_data: { mime_type: 'application/pdf', data: pdfBuffer.toString('base64') } },
    { text: EXTRACTION_PROMPT },
  ] }];
  const deadline = Date.now() + config.gemini.totalBudgetMs;
  const errors = [];

  for (const model of models()) {
    // JSON mode + low thinking first (the configuration verified with gemini-pick.mjs).
    // If a model rejects a setting (400), retry it with fewer settings; the prompt itself demands JSON.
    const configs = [
      { responseMimeType: 'application/json', thinkingConfig: thinkingFor(model) },
      { responseMimeType: 'application/json' },
      {},
    ];
    let c = 0;
    for (let attempt = 1; attempt <= config.gemini.attemptsPerModel && c < configs.length; attempt++) {
      const left = deadline - Date.now();
      if (left < 5000) throw new Error(`Gemini time budget (${config.gemini.totalBudgetMs / 1000}s) used up. Errors: ${errors.join(' | ') || 'none'}`);
      const { status, text, ms } = await call(model, { contents, generationConfig: configs[c] }, Math.min(config.gemini.timeoutMs, left));
      console.log(`[gemini] ${model} attempt ${attempt}: ${status} in ${(ms / 1000).toFixed(1)}s`);
      if (status === 200) {
        const data = JSON.parse(text);
        const out = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        if (!out) throw new Error(`${model} returned no text (finishReason: ${data?.candidates?.[0]?.finishReason || 'unknown'})`);
        return { raw: parseJsonFromModel(out), model };
      }
      errors.push(`${model} ${status}: ${text.slice(0, 160)}`);
      if (status === 400) { c++; attempt--; continue; }              // a setting was rejected: same model, fewer settings
      if (status === 401 || status === 403) throw new Error(errors.at(-1)); // key problem: no other model will help
      if (status === 404 || status === 'timeout') break;             // unavailable or hanging: next model
      if (transient(status)) { await sleep(config.gemini.retryBaseMs * attempt); continue; } // busy: short wait, retry
      break;                                                         // anything else: next model
    }
  }
  throw new Error(`All Gemini models failed. Last error: ${errors.at(-1) || 'unknown'}`);
}

// Connectivity check used by /api/health/llm: which configured model answers right now?
export async function pingGemini() {
  const tried = [];
  for (const model of models()) {
    const { status, text, ms } = await call(model, { contents: [{ role: 'user', parts: [{ text: 'Reply with the word OK.' }] }], generationConfig: { thinkingConfig: thinkingFor(model) } }, 20000);
    if (status === 200) return { ok: true, model, ms, tried };
    tried.push({ model, status, ms, detail: text.slice(0, 160) });
    if (status === 401 || status === 403) break;
  }
  return { ok: false, tried };
}
