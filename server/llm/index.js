import { config } from '../config.js';
import { extractWithGemini } from './gemini.js';
import { extractWithMock } from './mock.js';
import { ExtractionSchema } from './schema.js';

export async function extractInvoice(pdfBuffer, fileName) {
  const { raw, model } = config.extractor === 'mock' ? await extractWithMock(pdfBuffer, fileName) : await extractWithGemini(pdfBuffer);
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Extraction did not match the expected shape (${msg})`);
  }
  return { data: parsed.data, model };
}

export function extractorLabel() {
  return config.extractor === 'mock' ? 'mock (test fixtures)' : `gemini · ${config.gemini.model}`;
}
