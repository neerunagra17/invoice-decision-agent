// Money is handled as integer paise to avoid floating-point errors (450.1 * 3 = 1350.3000000000002).

export function toPaise(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : Number(String(x).replace(/[,\s₹]|INR|Rs\.?/gi, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function fromPaise(p) {
  return p === null || p === undefined ? null : p / 100;
}

// Indian digit grouping: 1439600 -> "14,39,600.00"
export function formatINR(paise) {
  if (paise === null || paise === undefined) return '—';
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toString();
  const dec = String(abs % 100).padStart(2, '0');
  let head = rupees.slice(0, -3), tail = rupees.slice(-3);
  if (head) head = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
  return `${neg ? '-' : ''}₹${head}${tail}.${dec}`;
}

// Is `actual` within `tolPaise` of `expected`?
export function within(actual, expected, tolPaise) {
  return Math.abs(actual - expected) <= tolPaise;
}
