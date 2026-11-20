// Reads the text layer of a PDF with Mozilla's pdf.js (the same engine Firefox uses to display PDFs).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function pdfText(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, useSystemFonts: false }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { text, pages };
}

export const looksLikePdf = buf => buf.length > 4 && buf.subarray(0, 1024).includes('%PDF-');
