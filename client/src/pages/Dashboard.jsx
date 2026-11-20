import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, socket, inr, when, secs } from '../api.js';
import { DecisionBadge } from '../components/Decision.jsx';

const FILTERS = [['ALL', 'All'], ['APPROVE', 'Approved'], ['HOLD', 'On hold'], ['REJECT', 'Rejected'], ['RUNNING', 'In progress']];

export default function Dashboard() {
  const nav = useNavigate();
  const [runs, setRuns] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let t;
    const load = () => api.runs().then(setRuns).catch(e => setError(e.message));
    const onChange = () => { clearTimeout(t); t = setTimeout(load, 150); }; // collapse bursts of stage events
    load();
    socket.on('runs:changed', onChange);
    return () => { socket.off('runs:changed', onChange); clearTimeout(t); };
  }, []);

  const stats = useMemo(() => {
    const r = runs || [], done = r.filter(x => x.decision);
    const of = d => done.filter(x => x.decision === d);
    const sum = xs => xs.reduce((s, x) => s + (x.totalPaise || 0), 0);
    const durations = done.map(x => x.durationMs).filter(x => x != null);
    return {
      total: r.length, inProgress: r.filter(x => !x.decision && x.status !== 'failed').length,
      approve: of('APPROVE').length, hold: of('HOLD').length, reject: of('REJECT').length,
      approvedPaise: sum(of('APPROVE')), heldPaise: sum(of('HOLD')),
      avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    };
  }, [runs]);

  const counts = { ALL: stats.total, APPROVE: stats.approve, HOLD: stats.hold, REJECT: stats.reject, RUNNING: stats.inProgress };
  const shown = (runs || []).filter(r =>
    (filter === 'ALL' || (filter === 'RUNNING' ? !r.decision : r.decision === filter)) &&
    (!q || [r.fileName, r.vendor, r.invoiceNumber, r.poNumber].some(v => v && v.toLowerCase().includes(q.toLowerCase()))));

  return (
    <div>
      <header className="page-head">
        <h1>Runs</h1>
        <p className="lede">Every invoice processed, with its decision and the reason. Select a run to see each stage and check.</p>
      </header>

      <div className="summary">
        <Stat name="Processed" value={stats.total} foot={stats.inProgress ? `${stats.inProgress} in progress` : 'All finished'} />
        <Stat name="Approved" color="var(--approve)" value={stats.approve} foot={inr(stats.approvedPaise)} />
        <Stat name="On hold" color="var(--hold)" value={stats.hold} foot={stats.hold ? `${inr(stats.heldPaise)} waiting for a person` : 'Nothing waiting'} />
        <Stat name="Rejected" color="var(--reject)" value={stats.reject} foot="Not payable as submitted" />
        <Stat name="Average time" value={secs(stats.avgMs)} foot="Per invoice" />
      </div>

      <section className="panel" style={{ marginTop: 24 }}>
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Filter by decision">
            {FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}<span className="count">{counts[k]}</span></button>)}
          </div>
          <input className="search" type="search" placeholder="Search vendor, invoice number, PO or file" value={q} onChange={e => setQ(e.target.value)} aria-label="Search runs" />
        </div>
        {error && <p className="error" style={{ padding: '0 20px 16px' }}>{error}</p>}
        {runs && runs.length === 0 && <div className="empty">No invoices processed yet. <Link to="/">Process an invoice</Link> to see it here.</div>}
        {runs && runs.length > 0 && shown.length === 0 && <div className="empty">No runs match this filter.</div>}
        {shown.length > 0 && (
          <table className="runs-table">
            <thead><tr><th>Decision</th><th>Vendor and invoice</th><th className="col-po">PO</th><th className="r">Total</th><th>Reason</th><th className="col-time">Processed</th></tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} onClick={() => nav(`/runs/${r.id}`)}>
                  <td><DecisionBadge decision={r.decision} status={r.status} /></td>
                  <td className="col-who">
                    <Link className="who" to={`/runs/${r.id}`} style={{ color: 'var(--ink)' }} onClick={e => e.stopPropagation()}>{r.vendor || r.fileName}</Link>
                    <div className="who-sub">{r.invoiceNumber || 'Invoice number missing'}</div>
                  </td>
                  <td className="col-po nowrap">{r.poNumber || '—'}{r.poInferred && <span className="chip">suggested</span>}</td>
                  <td className="amt">{inr(r.totalPaise)}</td>
                  <td><div className="why">{r.decision ? reason(r) : r.currentStage ? `${r.currentStage}…` : r.status === 'failed' ? 'Run failed' : 'Queued'}</div></td>
                  <td className="col-time nowrap"><div>{when(r.createdAt)}</div><div className="who-sub">{secs(r.durationMs)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// The headline without its decision prefix: the pill already says Approve / Hold / Reject.
const reason = r => (r.headline || '').replace(/^(Approve|Reject:|Hold for review(?: \(\d+ issues\))?:)\s*/, '');

const Stat = ({ name, value, foot, color }) => (
  <div>
    <div className="s-name">{color && <i style={{ background: color }} />}{name}</div>
    <div className="s-val">{value}</div>
    <div className="s-foot">{foot}</div>
  </div>
);
