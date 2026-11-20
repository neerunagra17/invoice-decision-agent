import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || '',            // empty -> in-memory store (local dev only)
  extractor: (process.env.EXTRACTOR || 'gemini').toLowerCase(), // 'gemini' | 'mock' (mock = automated tests only)
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    // Pinned model, verified on sample 01 (10/10 fields). Aliases like gemini-flash-latest can be repointed by Google.
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    // Tried in order if the main model is busy (503/429), unavailable (404) or hangs.
    fallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-flash-lite-latest,gemini-3.8-flash,gemini-3.5-flash').split(',').map(s => s.trim()).filter(Boolean),
    thinkingLevel: (process.env.GEMINI_THINKING_LEVEL || 'low').toLowerCase(), // Gemini 3.x: low | medium | high
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 60000),           // one call
    totalBudgetMs: Number(process.env.GEMINI_TOTAL_BUDGET_MS || 150000), // all models and retries together
    attemptsPerModel: Number(process.env.GEMINI_ATTEMPTS_PER_MODEL || 2),
    retryBaseMs: Number(process.env.GEMINI_RETRY_BASE_MS || 1500),
  },
  dataDir: path.join(root, 'data'),
  samplesDir: path.join(root, 'samples'),
  maxUploadBytes: 10 * 1024 * 1024,

  // Business rules (see PROCESS.md, assumption A5). All money in paise.
  rules: {
    arithmeticTolPaise: 100,          // ±₹1 rounding
    // Never pay above the agreed PO price: a unit price may exceed the PO price by at most ₹1 (rounding).
    // Billing below the PO price is accepted.
    unitPriceUpTolPaise: 100,
    // The invoice may exceed the PO's remaining balance by at most ₹1 (rounding).
    poBalanceTolPaise: 100,
    // Used ONLY to rank which PO line an invoice line refers to; never to accept a price.
    priceMatchPct: 1,
    possibleDuplicateWindowDays: 7,
    lineMatchMinSimilarity: 0.35,     // description similarity needed to pair an invoice line with a PO line
    inferredPoMinSimilarity: 0.45,    // description similarity needed to suggest a PO when none is quoted
    // No PO quoted and exactly one open PO fits: 'hold' (suggest it, a person confirms) or 'approve'.
    inferredPoPolicy: (process.env.INFERRED_PO_POLICY || 'hold').toLowerCase(),
    vendorNameMinSimilarity: 0.85,
    // Invoices above this total (incl. GST) always need a person. AUTO_APPROVE_LIMIT is in rupees; 0 = no limit.
    autoApproveLimitPaise: Math.round(Number(process.env.AUTO_APPROVE_LIMIT ?? 1000000) * 100),
  },
};
