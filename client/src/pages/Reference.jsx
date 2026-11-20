import { useEffect, useState } from 'react';
import { api, socket, inr } from '../api.js';
import { DecisionBadge } from '../components/Decision.jsx';

// The simulated procurement system the process checks against.
export default function Reference() {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = () => api.reference().then(setD).catch(e => setMsg(e.message));
  useEffect(() => {
    load();
    socket.on('runs:changed', load);
    return () => socket.off('runs:changed', load);
  }, []);

  async function reset() {
    if (!confirm('Delete all runs and restore the invoice history to its starting state?')) return;
    try { await api.reset(); setMsg('Demo data reset.'); load(); } catch (e) { setMsg(e.message); }
  }
  if (!d) return <p className="muted">{msg || 'Loading…'}</p>;
  const vendorName = id => d.vendors.find(v => v.vendorId === id)?.legalName || id;

  return (
    <div>
      <header className="page-head">
        <h1>Reference data</h1>
        <p className="lede">The procurement records every invoice is checked against: the buyer, approved vendors, purchase orders and past invoices. They stand in for the customer's ERP and are loaded from the files in <span className="mono">data/</span>.</p>
      </header>

      <section className="panel panel-pad">
        <div className="buyer-row">
          <div>
            <div className="b-name">{d.buyer.legal_name}</div>
            <div className="b-meta">Buyer. GSTIN {d.buyer.gstin}, {d.buyer.state} ({d.buyer.state_code})</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {msg && <span className="small muted">{msg}</span>}
            <button className="btn danger" onClick={reset}>Reset demo data</button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Approved vendors</h2></div>
        <div className="panel panel-pad">
          <table className="table">
            <thead><tr><th>ID</th><th>Name</th><th>GSTIN</th><th>State</th><th>Status</th><th className="num">Payment terms</th></tr></thead>
            <tbody>{d.vendors.map(v => (
              <tr key={v.vendorId}><td className="muted">{v.vendorId}</td><td>{v.legalName}</td><td className="mono">{v.gstin}</td><td>{v.state} ({v.stateCode})</td>
                <td><span className={`tag ${v.status === 'ACTIVE' ? 'pass' : 'reject'}`}>{v.status === 'ACTIVE' ? 'Active' : 'Blocked'}</span></td><td className="num">{v.paymentTermsDays} days</td></tr>))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Purchase orders</h2><span className="aside">Billed counts approved invoices only; held and rejected invoices don't use up a PO.</span></div>
        <div className="panel panel-pad">
          <table className="table">
            <thead><tr><th>PO</th><th>Vendor</th><th>Lines: ordered, still open</th><th className="num">PO value</th><th>Billed</th><th className="num">Remaining</th></tr></thead>
            <tbody>{d.pos.map(p => {
              const pct = Math.min(100, Math.round(p.usage.billedPaise / p.totalPaise * 100));
              return (
                <tr key={p.poNumber}>
                  <td className="nowrap">{p.poNumber}</td>
                  <td>{vendorName(p.vendorId)}</td>
                  <td className="small po-lines">{p.usage.lines.map(l => <div key={l.lineNo}>{l.description}: {l.qty} ordered, <b>{l.remainingQty}</b> {l.unit} open at {inr(l.unitPricePaise)}</div>)}</td>
                  <td className="num">{inr(p.totalPaise)}</td>
                  <td className="bar-cell"><div className="bar"><div style={{ width: `${pct}%` }} /></div><span className="small muted">{pct}%</span></td>
                  <td className="num">{inr(p.usage.remainingPaise)}</td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Invoice history</h2><span className="aside">Used for duplicate checks and PO balances.</span></div>
        <div className="panel panel-pad">
          <table className="table">
            <thead><tr><th>Processed</th><th>Vendor</th><th>Invoice no.</th><th>PO</th><th className="num">Total</th><th>Decision</th><th>Source</th></tr></thead>
            <tbody>{d.history.map((h, i) => (
              <tr key={i}><td className="nowrap muted">{h.processedAt?.slice(0, 16).replace('T', ' ')}</td><td>{h.vendorId ? vendorName(h.vendorId) : '—'}</td>
                <td>{h.invoiceNumber || <span className="missing">Missing</span>}</td><td>{h.poNumber || '—'}</td>
                <td className="num">{inr(h.totalPaise)}</td><td><DecisionBadge decision={h.decision} /></td><td className="muted">{h.source === 'seed' ? 'Starting data' : 'This app'}</td></tr>))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Rules in force</h2></div>
        <div className="panel panel-pad">
          <ul className="rules">
            <li>Arithmetic tolerance: ±{inr(d.rules.arithmeticTolPaise)}.</li>
            <li>Never pay above the PO price: a unit price may exceed it by at most {inr(d.rules.unitPriceUpTolPaise)} (rounding). Lower prices are accepted.</li>
            <li>An invoice may exceed the remaining PO balance by at most {inr(d.rules.poBalanceTolPaise)} (rounding).</li>
            <li>Invoices without a PO number: when exactly one open PO fits, {d.rules.inferredPoPolicy === 'approve' ? 'use it and note the inference' : 'suggest it and hold for a person to confirm'}.</li>
            <li>Scanned invoices: always held, so a person confirms the values read from the image.</li>
            <li>Duplicates: same vendor, number and amount as an approved invoice is rejected. Same number with a different amount, or the same total within {d.rules.possibleDuplicateWindowDays} days, is held.</li>
            <li>Auto-approval limit: {d.rules.autoApproveLimitPaise > 0 ? `${inr(d.rules.autoApproveLimitPaise)} including GST. Above it, a person approves.` : 'none.'}</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
