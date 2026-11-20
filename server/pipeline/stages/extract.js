import { extractInvoice } from '../../llm/index.js';
import { toPaise } from '../../lib/money.js';
import { normaliseGstin, normaliseInvoiceNumber, normalisePoRef, parseInvoiceDate } from '../../lib/normalise.js';
import { check } from '../checks.js';

// Stage 3 · Extract: the ONLY step that uses an LLM. It reads the document into a strict JSON shape.
// Everything after this is deterministic code.
export async function extract(ctx) {
  let data, model;
  try {
    ({ data, model } = await extractInvoice(ctx.file.buffer, ctx.file.name));
  } catch (e) {
    return { status: 'failed', summary: 'Could not extract fields', checks: [check('EXTRACTION', 'extract', 'Invoice could be read', 'hold', `Extraction failed: ${e.message}`)] };
  }
  const v = f => data[f]?.value ?? null;
  const inv = {
    vendorName: v('vendor_name'),
    vendorGstin: normaliseGstin(v('vendor_gstin')),
    invoiceNumber: v('invoice_number') ? String(v('invoice_number')).trim() : null,
    invoiceNumberNorm: normaliseInvoiceNumber(v('invoice_number')),
    invoiceDateRaw: v('invoice_date'),
    invoiceDate: parseInvoiceDate(v('invoice_date')),
    poRefRaw: v('po_reference'),
    poRef: normalisePoRef(v('po_reference')),
    placeOfSupply: v('place_of_supply'),
    lines: data.line_items.map((l, i) => ({
      n: i + 1, description: l.description || '', hsn: l.hsn_sac, qty: l.quantity, unit: l.unit,
      unitPricePaise: toPaise(l.unit_price), amountPaise: toPaise(l.amount), source: l.source,
    })),
    taxablePaise: toPaise(v('taxable_value')),
    taxes: data.taxes.map(t => ({ type: t.type, ratePct: t.rate_percent, amountPaise: toPaise(t.amount), source: t.source })),
    totalPaise: toPaise(v('total_amount')),
    notes: data.notes,
  };
  ctx.inv = inv;

  // What the UI shows: each field with the text it came from.
  const fields = ['vendor_name', 'vendor_gstin', 'invoice_number', 'invoice_date', 'po_reference', 'place_of_supply', 'taxable_value', 'total_amount'];
  ctx.run.extracted = {
    fields: Object.fromEntries(fields.map(f => [f, { value: data[f]?.value ?? null, source: data[f]?.source ?? null }])),
    lines: inv.lines, taxes: inv.taxes, notes: inv.notes,
    normalised: { invoiceDate: inv.invoiceDate, poRef: inv.poRef, vendorGstin: inv.vendorGstin },
  };
  ctx.run.invoiceNumber = inv.invoiceNumber;
  ctx.run.amounts = { taxablePaise: inv.taxablePaise, totalPaise: inv.totalPaise };
  ctx.run.model = model;

  const found = fields.filter(f => data[f]?.value !== null && data[f]?.value !== undefined).length;
  return { summary: `${found}/${fields.length} header fields, ${inv.lines.length} line item(s), ${inv.taxes.length} tax line(s) · ${model}`, checks: [] };
}
