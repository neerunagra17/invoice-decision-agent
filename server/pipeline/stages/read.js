import { pdfText, looksLikePdf } from '../../lib/pdftext.js';
import { check } from '../checks.js';

// Stage 2 · Read: is it a PDF, and does it have a text layer? If not, it is a scanned image.
// The text layer is later used to cross-check what the LLM extracted (grounding).
export async function read(ctx) {
  if (!looksLikePdf(ctx.file.buffer)) {
    return { status: 'failed', summary: 'Not a PDF', checks: [check('PDF_READABLE', 'read', 'File is a PDF', 'hold', 'The file is not a PDF.', 'Please re-send the invoice as a PDF.')] };
  }
  let text = '', pages = 0, parseError = null;
  try {
    ({ text, pages } = await pdfText(ctx.file.buffer));
  } catch (e) {
    parseError = e.message; // damaged/unusual PDF: the LLM may still be able to read it, so carry on without a text layer
  }
  const chars = text.replace(/\s/g, '').length;
  ctx.textLayer = text;
  ctx.scanned = chars < 30;
  ctx.run.scanned = ctx.scanned;
  ctx.run.pages = pages || null;
  if (parseError) {
    return { summary: 'Could not read the text layer; sending the file to the model as-is', checks: [check('PDF_TEXT', 'read', 'PDF text layer readable', 'info', `Text layer could not be read (${parseError}); values cannot be cross-checked.`)] };
  }
  return {
    summary: ctx.scanned ? `${pages} page(s), no text layer: scanned image, the model will read the image` : `${pages} page(s), text layer found (${chars} characters)`,
    checks: [],
  };
}
