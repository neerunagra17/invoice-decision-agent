import { io } from 'socket.io-client';

export const socket = io({ autoConnect: true });

async function req(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  health: () => req('/api/health'),
  llmHealth: () => req('/api/health/llm'),
  samples: () => req('/api/samples'),
  runs: () => req('/api/runs'),
  run: id => req(`/api/runs/${id}`),
  reference: () => req('/api/reference'),
  reset: () => req('/api/reference/reset', { method: 'POST' }),
  runSample: file => req(`/api/runs/sample/${encodeURIComponent(file)}`, { method: 'POST' }),
  upload: file => { const fd = new FormData(); fd.append('file', file); return req('/api/runs', { method: 'POST', body: fd }); },
};

// Same Indian grouping as the server: 1439600.00 -> ₹14,39,600.00
export function inr(paise) {
  if (paise === null || paise === undefined) return '—';
  const neg = paise < 0, abs = Math.abs(paise);
  const r = Math.floor(abs / 100).toString(), d = String(abs % 100).padStart(2, '0');
  let head = r.slice(0, -3); const tail = r.slice(-3);
  if (head) head = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
  return `${neg ? '-' : ''}₹${head}${tail}.${d}`;
}

export const when = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
export const secs = ms => ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
