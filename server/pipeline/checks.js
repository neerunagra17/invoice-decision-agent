// A check is one rule's verdict. Every stage returns a list of checks; the decision is derived from them.
// result: 'pass' | 'info' | 'hold' | 'reject'
//   pass   - rule satisfied
//   info   - worth showing, does not block (e.g. "PO inferred", "scanned document")
//   hold   - a person must look before payment
//   reject - must not be paid
// vendorAsk (optional): what we need from the vendor to resolve this check.

export const check = (id, stage, label, result, detail, vendorAsk = null) => ({ id, stage, label, result, detail, vendorAsk });

export const SEVERITY = { pass: 0, info: 1, hold: 2, reject: 3 };
