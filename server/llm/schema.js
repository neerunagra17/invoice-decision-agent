// Shape the extraction step must return. The LLM's JSON is validated against this before anything uses it.
import { z } from 'zod';

const num = z.preprocess(v => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[,\s₹%]|INR|Rs\.?/gi, ''));
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());
const str = z.preprocess(v => (v === undefined || v === '' ? null : v === null ? null : String(v)), z.string().nullable());

// Accepts {value, source} or a bare value (models sometimes flatten fields).
const field = (inner) => z.preprocess(
  v => (v === undefined ? undefined : v !== null && typeof v === 'object' && !Array.isArray(v) ? v : { value: v, source: null }),
  z.object({ value: inner, source: str.default(null) }),
).default({ value: null, source: null });

export const ExtractionSchema = z.object({
  vendor_name: field(str),
  vendor_gstin: field(str),
  invoice_number: field(str),
  invoice_date: field(str),
  po_reference: field(str),
  place_of_supply: field(str),
  line_items: z.array(z.object({
    description: str,
    hsn_sac: str.default(null),
    quantity: num,
    unit: str.default(null),
    unit_price: num,
    amount: num,
    source: str.default(null),
  })).default([]),
  taxable_value: field(num),
  taxes: z.array(z.object({
    type: z.preprocess(v => String(v ?? 'OTHER').toUpperCase(), z.enum(['CGST', 'SGST', 'IGST', 'UTGST', 'CESS', 'OTHER']).catch('OTHER')),
    rate_percent: num,
    amount: num,
    source: str.default(null),
  })).default([]),
  total_amount: field(num),
  notes: str.default(null),
});

// Plain-language description of the schema, included in the prompt.
export const SCHEMA_FOR_PROMPT = `{
  "vendor_name":     {"value": string|null, "source": string|null},
  "vendor_gstin":    {"value": string|null, "source": string|null},
  "invoice_number":  {"value": string|null, "source": string|null},
  "invoice_date":    {"value": string|null, "source": string|null},   // exactly as printed, e.g. "05/11/2026"
  "po_reference":    {"value": string|null, "source": string|null},   // purchase order number if printed anywhere
  "place_of_supply": {"value": string|null, "source": string|null},
  "line_items": [{"description": string, "hsn_sac": string|null, "quantity": number|null, "unit": string|null,
                  "unit_price": number|null, "amount": number|null, "source": string|null}],
  "taxable_value":   {"value": number|null, "source": string|null},   // total before tax
  "taxes": [{"type": "CGST"|"SGST"|"IGST"|"UTGST"|"CESS"|"OTHER", "rate_percent": number|null, "amount": number|null, "source": string|null}],
  "total_amount":    {"value": number|null, "source": string|null},   // final payable total
  "notes": string|null
}`;
