// TEST-ONLY extractor: returns hand-written expected extractions for the bundled sample invoices.
// Enabled only with EXTRACTOR=mock (automated tests / offline development). The UI shows a red banner in this mode.
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export async function extractWithMock(pdfBuffer, fileName) {
  const base = path.basename(fileName || '', '.pdf');
  const p = path.join(config.root, 'tests', 'fixtures', 'extractions', `${base}.json`);
  if (!fs.existsSync(p)) throw new Error(`Mock extractor has no fixture for "${fileName}" (test mode only)`);
  const delay = Number(process.env.MOCK_DELAY_MS || 0); // lets the live view be tested without an API key
  if (delay) await new Promise(r => setTimeout(r, delay));
  return { raw: JSON.parse(fs.readFileSync(p, 'utf8')), model: 'mock (test fixtures)' };
}
