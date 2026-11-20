// Normalisers for the identifiers and formats that vary between vendors.

const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// GSTIN: 2-digit state + 10-char PAN + entity + 'Z' + checksum (mod-36 weighted).
export function normaliseGstin(s) {
  return s ? String(s).toUpperCase().replace(/[^0-9A-Z]/g, '') : null;
}
export function gstinChecksumValid(g) {
  if (!g || !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CH.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CH[(36 - (sum % 36)) % 36] === g[14];
}
export function gstinStateCode(g) {
  return g && /^[0-9]{2}/.test(g) ? g.slice(0, 2) : null;
}

// Invoice numbers: compare case-insensitively, ignoring spaces and separators.
export function normaliseInvoiceNumber(s) {
  if (s === null || s === undefined) return null;
  const n = String(s).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return n.length ? n : null;
}

// PO references arrive as "PO-2026-0412", "PO/2026/0412", "2026-0430", "PO 2026 0430"...
// Canonical form: PO-YYYY-NNNN. Returns null if no year+sequence can be found.
export function normalisePoRef(s) {
  if (!s) return null;
  const m = String(s).toUpperCase().match(/(20\d{2})\D{0,3}(\d{3,5})/);
  if (!m) return null;
  return `PO-${m[1]}-${m[2].padStart(4, '0')}`;
}

// Dates as printed on Indian invoices: 05/11/2026, 05-11-2026, 14.11.2026, 05-Nov-2026, 2026-11-05, 5 November 2026.
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
export function parseInvoiceDate(s) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  let d, m, y, mm;
  if ((mm = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [, y, m, d] = mm;
  else if ((mm = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) [, d, m, y] = mm; // day-first (India)
  else if ((mm = t.match(/^(\d{1,2})[\s\-\/.]*([a-z]{3,9})[\s\-\/.,]*(\d{2,4})$/))) { d = mm[1]; m = MON[mm[2].slice(0, mm[2] === 'sept' ? 4 : 3)]; y = mm[3]; }
  else return null;
  d = Number(d); m = Number(m); y = Number(y);
  if (y < 100) y += 2000;
  if (!m || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00Z');
  return dt.getUTCDate() === d ? iso : null; // rejects 31/02 etc.
}
