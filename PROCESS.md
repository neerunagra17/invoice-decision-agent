# PS-1 · Invoice processing: process design

**Input:** one vendor invoice PDF, digital or scanned.
**Output:** **APPROVE / HOLD / REJECT**. Every decision comes with the checks that ran, the reasons behind it, and, for HOLD or REJECT, a draft message to the vendor. Each run is saved, and the result feeds the next run's duplicate and PO-balance checks.

## 1. Assumptions

| # | Assumption |
|---|---|
| A1 | Buyer: **Ganga Infra Projects Pvt Ltd**, Kanpur, Uttar Pradesh (state code **09**), GSTIN 09AAACG4821K1ZK. All companies and IDs are fictional. GSTINs have valid checksums. |
| A2 | Amounts are in INR. PO unit prices **exclude GST**. The GST rate is 18% on every PO line. |
| A3 | Supplier in the same state as the buyer (09) → **CGST 9% + SGST 9%**. Supplier in a different state → **IGST 18%**. The supplier's state is the first two digits of its GSTIN. |
| A4 | CSV files stand in for the procurement system: `vendors.csv` (approved-vendor master), `purchase_orders.csv` (one row per PO line) and `invoice_history.csv` (invoices already processed). Every decision is appended to the history. |
| A5 | Tolerances: arithmetic ±₹1 (rounding). **Never pay above the PO price**: a unit price may exceed it by at most ₹1 (rounding); lower prices are accepted. Taxable value may exceed the PO's remaining balance by at most ₹1. |
| A6 | Only **APPROVED** invoices count toward a PO's billed amount. HOLD and REJECT invoices do not use up PO balance. |
| A7 | The process recommends; it doesn't pay. A HOLD goes to a person with a specific reason. **Anything the system cannot verify goes to a person**: inferred POs, scanned invoices, and invoices above the auto-approval limit of ₹10 lakh incl. GST (a setting, `AUTO_APPROVE_LIMIT`). |

## 2. Stages

Each stage returns a status, a one-line summary and a list of checks. Each check is `pass`, `info`, `hold` or `reject`. Each stage is shown live as it runs and is saved on the run record.

| # | Stage | What happens | Checks it can raise |
|---|---|---|---|
| 1 | **Receive** | Save the file and compute its SHA-256 hash. | – |
| 2 | **Read** | Confirm the file is a PDF and read its text layer with pdf.js. Fewer than 30 characters means a **scanned** image. If the file isn't a PDF, skip to step 10. | `PDF_READABLE` hold |
| 3 | **Extract** *(LLM)* | Gemini receives the PDF itself, so scanned pages are read by vision. It returns a strict JSON schema. Every field carries the text it was read from, or `null` if absent; values are never guessed. zod validates the shape. If extraction fails, skip to step 10. | `EXTRACTION` hold |
| 4 | **Validate** | Checks the invoice number, date and total are present, and that line items or a taxable value were read. Every line must have a quantity, rate and amount (a value that can't be read holds the invoice; it never skips a check). Checks the date is not in the future. Checks each line is qty × rate, the lines add up to the taxable value, and taxable value + tax = total (±₹1). Validates the GSTIN checksum. **Grounding:** for digital PDFs, the extracted invoice number and total must appear in the PDF's own text. Scans can't be grounded, so they are held for a person. | `REQ_*`, `LINE_FIELDS`, `ARITH_*`, `GSTIN_VALID`, `GROUNDING` hold |
| 5 | **Vendor** | Exact GSTIN match against the vendor master. Fallback: name similarity (Sørensen–Dice ≥ 0.85), which always goes to a person. The vendor must be ACTIVE. | `VENDOR_MATCH` hold · `VENDOR_STATUS` **reject** |
| 6 | **PO** | Normalise the reference ("PO/2026/0412", "2026-0430" → `PO-YYYY-NNNN`). A reference printed in an unrecognised format is held, never replaced by a guess. The PO must exist, belong to this vendor and be OPEN, and the invoice can't be dated before the PO. **No reference quoted:** look at the vendor's OPEN POs. If **exactly one** fits both the amount (within A5) and the description (similarity ≥ 0.45), suggest it and HOLD for a person to confirm. | `PO_FOUND`, `PO_OPEN`, `DATE_AFTER_PO` hold |
| 7 | **Lines & balance** | Pair each invoice line with a PO line using description similarity (70%) plus price closeness (30%); the description must match (similarity ≥ 0.35), so a matching price alone never pairs a line. The rate must not exceed the PO price beyond ₹1. Quantity billed per PO line must be ≤ quantity still open (ordered minus approved history). Taxable value must be ≤ remaining PO balance + tolerance. | `LINE_MATCH`, `LINE_PRICE`, `LINE_QTY`, `PO_BALANCE` hold |
| 8 | **GST** | The tax type must follow A3, the total rate must match the PO, and tax must equal taxable × rate. | `TAX_TYPE`, `TAX_RATE`, `TAX_AMOUNT` hold |
| 9 | **Duplicates** | Look for the same vendor and same **normalised** invoice number in history. Approved with the **same amount** → **REJECT**. Approved with a different amount → HOLD (number reused; confirm with the vendor). Earlier HOLD or REJECT → HOLD (a resubmission for a person to compare). Same vendor and same total within 7 days under a different or missing number → HOLD (possible duplicate). | `DUPLICATE` reject/hold · `POSSIBLE_DUPLICATE` hold |
| 10 | **Decide** | Total above the auto-approval limit (₹10 lakh) → HOLD. Precedence: any reject → **REJECT**; else any hold → **HOLD**; else **APPROVE**. Collect the blocking checks as reasons and draft the vendor message. Compute the due date from payment terms. Append to history. | – |

## 3. Design choices (and why)

- **The LLM only reads.** Stage 3 is the only non-deterministic step. Every decision after it is a fixed rule in code, so the same extraction always produces the same decision, every reason traces to a rule, and every rule has a test.
- **Missing beats guessed.** The prompt and schema force `null` for absent fields, and a `null` triggers a specific HOLD. The model is never allowed to fill in an invoice number.
- **The model's reading is checked.** Arithmetic consistency catches most misreads. For digital PDFs, grounding also confirms the invoice number and total appear in the document's own text layer.
- **Numbers are compared as numbers, with explicit tolerances.** Money is stored as integer paise to avoid floating-point error. Text similarity (Dice) is used only where wording varies: vendor names and line descriptions.
- **Duplicates are found by vendor + normalised invoice number, not by file hash.** A re-sent copy is usually a different file, with a different layout, scan or date format.
- **The PO balance ignores earlier copies of the same invoice.** Otherwise a duplicate would also be reported as over-billing its own PO. The duplicate check covers those copies.
- **One invoice at a time.** Each run must see the previous run's decision, both for duplicates and for PO balance.
- **Without a PO number, the system suggests; a person confirms.** It infers a PO only when exactly one fits, shows the evidence and the ruled-out POs, and holds the invoice for confirmation. (`INFERRED_PO_POLICY=approve` would pay against a unique fit instead.)
- **REJECT means certain.** Only a same-vendor, same-number, same-amount copy of an approved invoice is rejected. Anything less certain is a HOLD.
- **Never pay above the agreed price.** Tolerances forgive rounding (₹1), not price increases; those need a PO amendment.
- **Reason, not just verdict.** Each check has a plain-language detail. HOLD and REJECT checks also carry the exact ask to the vendor, which becomes the drafted message.

## 4. Test invoices and outcomes

Run them **in this order**: 02 depends on 01 having been approved. **Reset demo data** restores the starting state.

| File | Scenario | Decision | Why |
|---|---|---|---|
| `01_happy_nimbus_laptops.pdf` | Clean digital PDF, PO-2026-0418, Karnataka → UP with IGST | **APPROVE** | Every check passes. Due date = invoice date + 30-day terms. |
| `02_duplicate_nimbus_resend.pdf` | NIM/26-27/0871 re-sent as a **different file**: new layout, "05-Nov-2026", "RE-SENT" stamp | **REJECT** | Same vendor, normalised number and amount as the invoice approved in run 01 → double payment. Only the duplicate is reported. |
| `03_split_overbilling_apex.pdf` | PO-2026-0425 split across two invoices. Type tests were already billed (APX/2026/112 in history). This invoice bills **26** routine tests against **20** ordered. | **HOLD** | Quantity 26 > 20 open, and ₹2,60,000 against ₹2,00,000 remaining (+30%). The vendor's note claims a site instruction, so the vendor is asked for a PO amendment or a re-issue for 20. |
| `04_scanned_missing_invoice_no_shakti.pdf` | Image-only scan with no text layer. The invoice-number field is blank. PO written "PO/2026/0412". | **HOLD** (3 reasons) | The vision model reads the scan, and the lines, PO and IGST all match. Without an invoice number, duplicate detection by number is impossible, so the vendor is asked for it. Also held because scans can't be grounded and ₹14,39,600 is above the ₹10 lakh limit; those two are internal and not sent to the vendor. |
| `05_no_po_reference_ganges.pdf` | No PO quoted. Vendor V003 has two OPEN POs. UP → UP with CGST + SGST. | **HOLD** (PO suggested) | Only PO-2026-0421 fits: ₹2,16,000 equals what it still owes and the description is "Warehousing … November 2026". PO-2026-0433 (December freight, ₹1,44,000) is ruled out. The evidence is shown and a person confirms the PO. |
| `06_wrong_tax_type_shakti.pdf` | Gujarat supplier billing a UP buyer with CGST + SGST. PO written "2026-0430". | **HOLD** | An inter-state supply needs IGST, so the buyer could not claim input tax credit. The vendor is asked for a credit note and a re-issue with IGST. |

The automated tests also cover a BLOCKED vendor (REJECT), the same file uploaded twice (REJECT), a held invoice resubmitted (HOLD, with PO balance untouched), `INFERRED_PO_POLICY=approve`, a non-PDF upload, and regression cases that must never approve: no amounts read, an unreadable quantity, an unrelated item at the PO price, an unrecognised PO reference, a price above the PO, a reused invoice number with a different amount (HOLD, not REJECT), a copy with no invoice number, an invoice dated before its PO, and an invoice above the approval limit.

**Edge cases for the submission:** 03 (split PO / over-billing), 04 (scanned + missing field) and 05 (no PO reference) are the situations named in the brief. 02 (duplicate) and 06 (GST) are extras.

## 5. Run record (drives the live view and the dashboard)

```
run: {
  id, createdAt, fileName, fileSize, source: upload|sample, status: queued|running|completed|failed,
  extractor, model, scanned, pages, durationMs,
  stages:   [{ key, label, status: pending|running|done|failed|skipped, startedAt, endedAt, ms, summary }],
  extracted:{ fields: { name: { value, source } }, lines[], taxes[], notes, normalised: { invoiceDate, poRef, vendorGstin } },
  vendor:   { vendorId, legalName, gstin, matchedBy },  po: { poNumber, inferred, quotedAs | evidence, rejected[] },
  poBalance:{ poTotalPaise, billedBeforePaise, remainingBeforePaise },  amounts: { taxablePaise, totalPaise },
  checks:   [{ id, stage, label, result: pass|info|hold|reject, detail, vendorAsk }],
  decision: APPROVE|HOLD|REJECT, headline, reasons[], notes[], vendorMessage
}
```

## 6. What I'd add next

- Multi-PO invoices and partial approval (approve the matching lines, hold the rest).
- A reviewer action on HOLD runs (approve with a comment, or reject) that writes back to history.
- Email intake, sending the vendor message, and pushing approved invoices to the ERP or payment run.
- A per-vendor memory of layouts and wording, for faster and stricter grounding.
