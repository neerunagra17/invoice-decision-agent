// Small, dependency-free helpers for comparing and normalising text.

// Sørensen–Dice coefficient on character bigrams (multiset), 0..1.
// Used ONLY for fuzzy text: vendor names and line descriptions. Never for numbers.
export function dice(a, b) {
  a = normaliseForMatch(a);
  b = normaliseForMatch(b);
  if (!a.length && !b.length) return 1;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = counts.get(g) || 0;
    if (c > 0) { counts.set(g, c - 1); shared++; }
  }
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

// Lowercase, unify '&'/'and', drop punctuation and spaces.
export function normaliseForMatch(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

// Token-set similarity on words (handles reordering, e.g. "Nov-2026" vs "November 2026").
const MONTHS = { jan: 'january', feb: 'february', mar: 'march', apr: 'april', jun: 'june', jul: 'july', aug: 'august', sep: 'september', sept: 'september', oct: 'october', nov: 'november', dec: 'december' };
const STOP = new Set(['the', 'of', 'for', 'and', 'a', 'an', 'to', 'per', 'month', 'charges', 'charge']);
export function tokens(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9.]+/)
    .map(t => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .map(t => MONTHS[t] || t)
    .filter(t => !STOP.has(t));
}
export function tokenSimilarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// Description similarity used for line/PO matching: best of character-level and word-level views.
export function descriptionSimilarity(a, b) {
  return Math.max(dice(a, b), tokenSimilarity(a, b));
}

// Text present in a document's text layer? (ignores spaces/punctuation/case)
export function appearsIn(needle, haystack) {
  const n = normaliseForMatch(needle);
  if (!n) return false;
  return normaliseForMatch(haystack).includes(n);
}
