// Reference data = the "procurement system": approved vendors, purchase orders, and the seed invoice history.
// Loaded from CSV files in /data at startup (read-only). Decisions made by the process are stored separately.
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { config } from '../config.js';
import { toPaise } from '../lib/money.js';
import { normaliseInvoiceNumber } from '../lib/normalise.js';

function readCsv(name) {
  return parse(fs.readFileSync(path.join(config.dataDir, name), 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
}

export function normaliseDecision(d) {
  const u = String(d).toUpperCase();
  return u.startsWith('APPROV') ? 'APPROVE' : u.startsWith('REJECT') ? 'REJECT' : 'HOLD';
}

export function loadReference() {
  const buyer = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'buyer.json'), 'utf8'));

  const vendors = readCsv('vendors.csv').map(v => ({
    vendorId: v.vendor_id, legalName: v.legal_name, gstin: v.gstin.toUpperCase(),
    state: v.state, stateCode: v.state_code.padStart(2, '0'), status: v.status.toUpperCase(),
    paymentTermsDays: Number(v.payment_terms_days),
  }));

  const pos = new Map();
  for (const r of readCsv('purchase_orders.csv')) {
    if (!pos.has(r.po_number)) {
      pos.set(r.po_number, { poNumber: r.po_number, vendorId: r.vendor_id, poDate: r.po_date, status: r.po_status.toUpperCase(), lines: [] });
    }
    pos.get(r.po_number).lines.push({
      lineNo: Number(r.line_no), description: r.description, hsnSac: r.hsn_sac,
      qty: Number(r.qty), unit: r.unit, unitPricePaise: toPaise(r.unit_price), taxRatePct: Number(r.tax_rate),
    });
  }
  for (const po of pos.values()) {
    po.totalPaise = po.lines.reduce((s, l) => s + l.qty * l.unitPricePaise, 0);
  }

  // Seed history: one CSV row per billed PO line; grouped into one entry per invoice.
  const seed = new Map();
  for (const r of readCsv('invoice_history.csv')) {
    const key = `${r.vendor_id}|${normaliseInvoiceNumber(r.invoice_number)}`;
    if (!seed.has(key)) {
      seed.set(key, {
        vendorId: r.vendor_id, invoiceNumber: r.invoice_number, invoiceNumberNorm: normaliseInvoiceNumber(r.invoice_number),
        invoiceDate: r.invoice_date, poNumber: r.po_number, decision: normaliseDecision(r.decision),
        taxablePaise: 0, totalPaise: 0, lines: [], processedAt: r.processed_on, source: 'seed', runId: null,
      });
    }
    const e = seed.get(key);
    e.lines.push({ poLineNo: Number(r.po_line_no), qty: Number(r.qty_billed), taxablePaise: toPaise(r.taxable_amount) });
    e.taxablePaise += toPaise(r.taxable_amount);
    e.totalPaise += toPaise(r.total_amount);
  }

  return { buyer, vendors, pos: [...pos.values()], seedHistory: [...seed.values()] };
}

// How much of a PO has already been billed on APPROVED invoices (HOLD/REJECT don't consume balance).
export function poUsage(po, history) {
  const approved = history.filter(h => h.decision === 'APPROVE' && h.poNumber === po.poNumber);
  const billedQtyByLine = new Map(po.lines.map(l => [l.lineNo, 0]));
  let billedPaise = 0;
  for (const h of approved) {
    billedPaise += h.taxablePaise;
    for (const l of h.lines || []) billedQtyByLine.set(l.poLineNo, (billedQtyByLine.get(l.poLineNo) || 0) + l.qty);
  }
  return {
    billedPaise,
    remainingPaise: po.totalPaise - billedPaise,
    lines: po.lines.map(l => ({ ...l, billedQty: billedQtyByLine.get(l.lineNo) || 0, remainingQty: l.qty - (billedQtyByLine.get(l.lineNo) || 0) })),
  };
}
