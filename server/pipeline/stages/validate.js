import { check } from '../checks.js';
import { formatINR, within } from '../../lib/money.js';
import { appearsIn } from '../../lib/text.js';
import { gstinChecksumValid } from '../../lib/normalise.js';

// Stage 4 · Validate: is the invoice complete and internally consistent, before looking at any PO?
export async function validate(ctx) {
  const { inv, rules } = ctx;
  const tol = rules.arithmeticTolPaise;
  const out = [];
  const S = 'validate';

  // Required fields
  out.push(inv.invoiceNumberNorm
    ? check('REQ_INVOICE_NUMBER', S, 'Invoice number present', 'pass', inv.invoiceNumber)
    : check('REQ_INVOICE_NUMBER', S, 'Invoice number present', 'hold', 'Invoice number is missing, so a duplicate check is impossible. Paying it risks paying the same bill twice.',
      'The invoice number is blank on the copy we received. Please share the invoice number (or re-send the invoice with it).'));
  if (!inv.invoiceDateRaw) out.push(check('REQ_INVOICE_DATE', S, 'Invoice date present', 'hold', 'Invoice date is missing.', 'Please confirm the invoice date.'));
  else if (!inv.invoiceDate) out.push(check('REQ_INVOICE_DATE', S, 'Invoice date readable', 'hold', `Could not interpret the date "${inv.invoiceDateRaw}".`, 'Please confirm the invoice date.'));
  else {
    const today = new Date().toISOString().slice(0, 10);
    out.push(inv.invoiceDate > today
      ? check('DATE_NOT_FUTURE', S, 'Invoice date not in the future', 'hold', `Invoice is dated ${inv.invoiceDate}, which is after today (${today}).`, 'The invoice date appears to be in the future. Please confirm or correct it.')
      : check('DATE_NOT_FUTURE', S, 'Invoice date valid', 'pass', inv.invoiceDate));
  }
  if (inv.totalPaise === null) out.push(check('REQ_TOTAL', S, 'Invoice total present', 'hold', 'No clear invoice total was found.', 'Please confirm the total amount payable.'));

  // Missing beats guessed: a value that could not be read must hold the invoice, never skip a check.
  if (!inv.lines.length && inv.taxablePaise === null) {
    out.push(check('REQ_AMOUNTS', S, 'Line items or taxable value present', 'hold', 'No line items and no taxable value could be read, so the amounts cannot be checked against the PO.',
      'We could not read the line items or the taxable value on your invoice. Please re-send a clear copy.'));
  }
  const unreadable = inv.lines.filter(l => l.qty == null || l.unitPricePaise == null || l.amountPaise == null);
  if (unreadable.length) {
    const missing = l => ['quantity', 'rate', 'amount'].filter((_, i) => [l.qty, l.unitPricePaise, l.amountPaise][i] == null).join(', ');
    out.push(check('LINE_FIELDS', S, 'Every line has quantity, rate and amount', 'hold', unreadable.map(l => `Line ${l.n}: ${missing(l)} could not be read`).join('; ') + '.',
      'Some line items on your invoice are missing a quantity, rate or amount. Please re-send a clear copy.'));
  }

  // Arithmetic: each line, lines -> taxable value, taxable + taxes -> total
  const badLines = inv.lines.filter(l => l.qty != null && l.unitPricePaise != null && l.amountPaise != null && !within(Math.round(l.qty * l.unitPricePaise), l.amountPaise, tol));
  out.push(badLines.length
    ? check('ARITH_LINES', S, 'Line amounts = qty × rate', 'hold', badLines.map(l => `Line ${l.n}: ${l.qty} × ${formatINR(l.unitPricePaise)} ≠ ${formatINR(l.amountPaise)}`).join('; '), 'Some line amounts do not equal quantity × rate. Please check and re-issue.')
    : check('ARITH_LINES', S, 'Line amounts = qty × rate', 'pass', `${inv.lines.length} line(s) correct`));

  const lineSum = inv.lines.reduce((s, l) => s + (l.amountPaise || 0), 0);
  if (inv.taxablePaise === null && inv.lines.length) {
    inv.taxablePaise = lineSum; ctx.run.amounts.taxablePaise = lineSum;
    out.push(check('ARITH_SUBTOTAL', S, 'Taxable value', 'info', `Not printed separately; taken as the sum of lines, ${formatINR(lineSum)}.`));
  } else if (inv.taxablePaise !== null) {
    out.push(within(lineSum, inv.taxablePaise, tol)
      ? check('ARITH_SUBTOTAL', S, 'Lines add up to taxable value', 'pass', formatINR(inv.taxablePaise))
      : check('ARITH_SUBTOTAL', S, 'Lines add up to taxable value', 'hold', `Lines sum to ${formatINR(lineSum)} but the taxable value says ${formatINR(inv.taxablePaise)}.`, 'The line items do not add up to the taxable value. Please re-check the invoice.'));
  }
  const taxSum = inv.taxes.reduce((s, t) => s + (t.amountPaise || 0), 0);
  if (inv.totalPaise !== null && inv.taxablePaise !== null) {
    out.push(within(inv.taxablePaise + taxSum, inv.totalPaise, tol)
      ? check('ARITH_TOTAL', S, 'Taxable value + tax = total', 'pass', `${formatINR(inv.taxablePaise)} + ${formatINR(taxSum)} = ${formatINR(inv.totalPaise)}`)
      : check('ARITH_TOTAL', S, 'Taxable value + tax = total', 'hold', `${formatINR(inv.taxablePaise)} + ${formatINR(taxSum)} ≠ ${formatINR(inv.totalPaise)}.`, 'The invoice total does not equal taxable value plus tax. Please re-check.'));
  }

  // GSTIN format (checksum)
  if (inv.vendorGstin) {
    out.push(gstinChecksumValid(inv.vendorGstin)
      ? check('GSTIN_VALID', S, 'Supplier GSTIN valid', 'pass', inv.vendorGstin)
      : check('GSTIN_VALID', S, 'Supplier GSTIN valid', 'hold', `GSTIN "${inv.vendorGstin}" fails the format/checksum test.`, 'The GSTIN on the invoice appears invalid. Please confirm your GSTIN.'));
  } else {
    out.push(check('GSTIN_VALID', S, 'Supplier GSTIN present', 'info', 'No GSTIN found; vendor will be matched by name.'));
  }

  // Grounding: for digital PDFs, the key values the model returned must exist in the PDF's own text layer.
  if (ctx.scanned) {
    // Policy: what cannot be verified against the document is confirmed by a person.
    out.push(check('GROUNDING', S, 'Extracted values verified against the document', 'hold', 'Scanned image: there is no text layer to check the model\'s reading against. A person must confirm the extracted values against the image before payment.'));
  } else {
    const missing = [];
    if (inv.invoiceNumber && !appearsIn(inv.invoiceNumber, ctx.textLayer)) missing.push(`invoice number "${inv.invoiceNumber}"`);
    if (inv.totalPaise !== null && !appearsIn(String(inv.totalPaise / 100).replace(/\.0+$/, ''), ctx.textLayer.replace(/,/g, ''))) missing.push(`total ${formatINR(inv.totalPaise)}`);
    out.push(missing.length
      ? check('GROUNDING', S, 'Extracted values verified against the document', 'hold', `Not found in the PDF's text: ${missing.join(', ')}. The extraction may be wrong.`)
      : check('GROUNDING', S, 'Extracted values verified against the document', 'pass', 'Invoice number and total found in the PDF text layer'));
  }

  const problems = out.filter(c => c.result === 'hold').length;
  return { summary: problems ? `${problems} problem(s) found` : 'Complete and internally consistent', checks: out };
}
