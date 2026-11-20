import { SCHEMA_FOR_PROMPT } from './schema.js';

export const EXTRACTION_PROMPT = `You are reading one vendor invoice (Indian GST tax invoice) for an accounts-payable team.
Extract the fields below and return ONLY a JSON object with exactly this shape:

${SCHEMA_FOR_PROMPT}

Rules:
1. Copy values exactly as printed. Do not correct, complete or infer anything.
2. If a field is absent, blank, or illegible, return {"value": null, "source": null}. Never invent an invoice number, date or PO reference.
3. "source" is the exact text from the document the value came from (label and value, e.g. "Invoice No: NIM/26-27/0871").
4. Numbers: plain numbers without commas or currency symbols (8,31,900.00 -> 831900). Quantity "10 nos" -> quantity 10, unit "nos".
5. List every tax line separately (CGST, SGST, IGST...) with its rate and amount.
6. "po_reference" is the buyer's purchase order number if the invoice quotes one under any label (PO No, Order Ref, Your PO, Against PO...).
7. "vendor_name" and "vendor_gstin" are the SUPPLIER who issued the invoice, not the "Bill To" buyer.
8. Put any vendor remarks (e.g. reasons for extra quantities) and other relevant printed text in "notes".`;
