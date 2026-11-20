import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, socket, inr, secs } from '../api.js';
import StageTimeline from '../components/StageTimeline.jsx';
import { ResultTag, Icon } from '../components/Decision.jsx';

const FIELD_LABELS = {
  vendor_name: 'Vendor name', vendor_gstin: 'Vendor GSTIN', invoice_number: 'Invoice number', invoice_date: 'Invoice date',
  po_reference: 'PO reference', place_of_supply: 'Place of supply', taxable_value: 'Taxable value', total_amount: 'Total',
};
const MONEY = new Set(['taxable_value', 'total_amount']);
const VERDICT = { APPROVE: 'Approve', HOLD: 'Hold for review', REJECT: 'Reject' };
const GLYPH = { APPROVE: 'check', HOLD: 'pause', REJECT: 'x' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : iso;

export default function Run() {
  const { id } = useParams();
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRun(null); setError(null);
    const watch = () => socket.emit('run:watch', id);
    const onUpdate = r => { if (r.id === id) setRun(r); };
    api.run(id).then(setRun).catch(e => setError(e.message));
    watch();
    socket.on('connect', watch); // re-join the room after a reconnect
    socket.on('run:update', onUpdate);
    return () => { socket.emit('run:unwatch', id); socket.off('connect', watch); socket.off('run:update', onUpdate); };
  }, [id]);

  if (error) return <p className="error">{error}. <Link to="/runs">Back to runs</Link></p>;
  if (!run) return <p className="muted">Loading…</p>;
  const finished = run.status === 'completed' || run.status === 'failed';

  return (
    <div>
      <div className="crumbs"><Link to="/runs">Runs</Link> › {run.fileName}</div>
      {finished ? <DecisionHero run={run} /> : <ProgressHero run={run} />}

      <div className="run-grid">
        <section className="panel panel-pad">
          <div className="panel-head"><h2>Processing</h2>{run.durationMs != null && <span className="small muted">{secs(run.durationMs)} in total</span>}</div>
          <StageTimeline run={run} />
        </section>
        <section className="panel panel-pad">
          <div className="panel-head"><h2>Invoice</h2><a className="small" href={`/api/runs/${run.id}/file`} target="_blank" rel="noreferrer">Open PDF</a></div>
          <iframe className="doc-frame" title="Invoice PDF" src={`/api/runs/${run.id}/file#view=FitH`} />
        </section>
      </div>

      {finished && run.decision && <Details run={run} />}
    </div>
  );
}

function ProgressHero({ run }) {
  const idx = run.stages.findIndex(s => s.status === 'running');
  const done = run.stages.filter(s => ['done', 'skipped', 'failed'].includes(s.status)).length;
  const queued = run.status === 'queued';
  return (
    <section className="hero">
      <div className="verdict"><span className="glyph" style={{ background: 'var(--fill)' }}><span className="spinner" /></span><h1>{queued ? 'Queued' : 'Processing'}</h1></div>
      <p className="hero-line" style={{ marginTop: 14 }}>
        {queued ? 'Waiting for the previous invoice to finish. Invoices are processed one at a time.'
          : idx >= 0 ? `Step ${idx + 1} of ${run.stages.length}: ${run.stages[idx].label}` : 'Starting…'}
      </p>
      <div className="progress"><div style={{ width: `${Math.round(done / run.stages.length * 100)}%` }} /></div>
    </section>
  );
}

function DecisionHero({ run }) {
  const [copied, setCopied] = useState(false);
  if (!run.decision) {
    return (
      <section className="hero failed">
        <div className="verdict"><span className="glyph"><Icon name="x" size={18} /></span><h1>Run failed</h1></div>
        <p className="hero-line" style={{ marginTop: 14 }}>{run.error || 'Processing stopped unexpectedly.'} Nothing was approved. Try the upload again.</p>
      </section>
    );
  }
  const d = run.decision;
  const due = run.headline?.match(/due (\d{4}-\d{2}-\d{2}) \((\d+)-day terms\)/);
  const vendor = run.vendor?.legalName || run.extracted?.fields?.vendor_name?.value || 'Unknown vendor';
  const n = run.reasons.length;
  const line = d === 'APPROVE'
    ? <>Pay {vendor} against {run.po?.poNumber}.{due && <> Due {day(due[1])}, on {due[2]}-day terms.</>}</>
    : d === 'HOLD' ? <>{n === 1 ? 'One issue needs' : `${n} issues need`} a person before this invoice can be paid.</>
    : <>This invoice will not be paid as submitted.</>;
  const copy = () => navigator.clipboard?.writeText(run.vendorMessage).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const x = run.extracted;

  return (
    <section className={`hero ${d.toLowerCase()}`}>
      <div className="hero-grid">
        <div>
          <div className="verdict"><span className="glyph"><Icon name={GLYPH[d]} size={18} /></span><h1>{VERDICT[d]}</h1></div>
          <div className="hero-amount">{inr(run.amounts?.totalPaise)}</div>
          <p className="hero-line">{line}</p>
        </div>
        <dl className="facts">
          <dt>Vendor</dt><dd>{vendor}{run.vendor && <div className="sub">Matched by {run.vendor.matchedBy}</div>}</dd>
          <dt>Invoice</dt><dd>{run.invoiceNumber || <span style={{ color: 'var(--hold)' }}>Number missing</span>}{x?.normalised?.invoiceDate && <div className="sub">Dated {day(x.normalised.invoiceDate)}</div>}</dd>
          <dt>Purchase order</dt><dd>{run.po?.poNumber || '—'}{run.po?.inferred && <span className="chip">suggested</span>}</dd>
          <dt>Taxable value</dt><dd>{inr(run.amounts?.taxablePaise)}</dd>
          <dt>Document</dt><dd>{run.scanned ? 'Scanned image' : 'Digital PDF'}{run.pages ? `, ${run.pages} page${run.pages > 1 ? 's' : ''}` : ''}</dd>
          <dt>Read by</dt><dd>{run.model || run.extractor}</dd>
        </dl>
      </div>

      {n > 0 && (
        <div className="hero-block">
          <h3>{d === 'REJECT' ? 'Why it was rejected' : 'What needs attention'}</h3>
          <ul className="reasons">{run.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {run.notes.length > 0 && (
        <div className="hero-block">
          <h3>Notes</h3>
          <ul className="reasons notes">{run.notes.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {run.vendorMessage && (
        <div className="hero-block">
          <h3>Draft message to vendor <button className="btn secondary small" onClick={copy}>{copied ? 'Copied' : 'Copy message'}</button></h3>
          <pre className="vendor-msg">{run.vendorMessage}</pre>
        </div>
      )}
    </section>
  );
}

function Details({ run }) {
  const [tab, setTab] = useState('checks');
  return (
    <section className="section">
      <div className="section-head">
        <h2>Details</h2>
        <div className="segmented" role="tablist">
          {[['checks', 'Checks', run.checks.length], ['extracted', 'Extracted data'], ['po', 'Purchase order']].map(([k, l, c]) =>
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{c != null && <span className="count">{c}</span>}</button>)}
        </div>
      </div>
      <div className="panel panel-pad">
        {tab === 'checks' && <Checks run={run} />}
        {tab === 'extracted' && <Extracted run={run} />}
        {tab === 'po' && <PoPanel run={run} />}
      </div>
    </section>
  );
}

function Checks({ run }) {
  const order = run.stages.map(s => s.key);
  const label = Object.fromEntries(run.stages.map(s => [s.key, s.label]));
  const sorted = [...run.checks].sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  const issues = sorted.filter(c => c.result === 'hold' || c.result === 'reject').sort((a, b) => (b.result === 'reject') - (a.result === 'reject'));
  const notes = sorted.filter(c => c.result === 'info');
  const passed = sorted.filter(c => c.result === 'pass');
  const [showPassed, setShowPassed] = useState(issues.length === 0);
  const Row = c => (
    <li key={`${c.id}-${c.label}`} className={`check ${c.result}`}>
      <span><ResultTag result={c.result} /></span>
      <span className="c-label" title={c.id}>{c.label}<span className="c-stage">{label[c.stage] || c.stage}</span></span>
      <span className="c-detail">{c.detail}</span>
    </li>
  );
  return (
    <div>
      {issues.length === 0
        ? <div className="all-pass"><Icon name="check" size={16} /> All {passed.length} checks passed</div>
        : <ul className="check-list">{issues.map(Row)}</ul>}
      {notes.length > 0 && <ul className="check-list" style={{ borderTop: issues.length ? '1px solid var(--hair)' : 0 }}>{notes.map(Row)}</ul>}
      <div className="fold">
        <button className="linkbtn" onClick={() => setShowPassed(v => !v)} aria-expanded={showPassed}>
          {showPassed ? 'Hide passed checks' : `Show ${passed.length} passed checks`}
        </button>
        {showPassed && <ul className="check-list" style={{ marginTop: 8 }}>{passed.map(Row)}</ul>}
      </div>
    </div>
  );
}

function Extracted({ run }) {
  const x = run.extracted;
  if (!x) return <p className="muted">Nothing was extracted.</p>;
  return (
    <div>
      <p className="fine" style={{ marginBottom: 14 }}>Each value is shown with the text the model says it came from. "Not found" means the document didn't contain it.</p>
      <table className="table">
        <thead><tr><th>Field</th><th>Value</th><th>Read from</th></tr></thead>
        <tbody>{Object.entries(x.fields).map(([k, f]) => (
          <tr key={k}>
            <td className="nowrap muted">{FIELD_LABELS[k] || k}</td>
            <td className="mono">{f.value === null ? <span className="missing">Not found</span> : MONEY.has(k) && typeof f.value === 'number' ? inr(Math.round(f.value * 100)) : String(f.value)}
              {k === 'invoice_date' && x.normalised.invoiceDate && x.normalised.invoiceDate !== f.value && <span className="mini">read as {x.normalised.invoiceDate}</span>}
              {k === 'po_reference' && x.normalised.poRef && x.normalised.poRef !== f.value && <span className="mini">read as {x.normalised.poRef}</span>}
            </td>
            <td className="source">{f.source || '—'}</td>
          </tr>))}
        </tbody>
      </table>
      <h3 className="sub-h">Line items</h3>
      <table className="table">
        <thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>{x.lines.map(l => (
          <tr key={l.n}><td className="muted">{l.n}</td><td>{l.description}</td><td className="mono muted">{l.hsn || '—'}</td><td className="num">{l.qty ?? '—'} {l.unit || ''}</td><td className="num">{inr(l.unitPricePaise)}</td><td className="num">{inr(l.amountPaise)}</td></tr>))}
        </tbody>
      </table>
      <h3 className="sub-h">Taxes</h3>
      <table className="table">
        <thead><tr><th>Type</th><th className="num">Rate</th><th className="num">Amount</th><th>Read from</th></tr></thead>
        <tbody>{x.taxes.length ? x.taxes.map((t, i) => <tr key={i}><td>{t.type}</td><td className="num">{t.ratePct ?? '—'}%</td><td className="num">{inr(t.amountPaise)}</td><td className="source">{t.source || '—'}</td></tr>)
          : <tr><td colSpan={4} className="muted">No tax lines found</td></tr>}</tbody>
      </table>
      {x.notes && <><h3 className="sub-h">Other text on the invoice</h3><p className="note-text">{x.notes}</p></>}
    </div>
  );
}

function PoPanel({ run }) {
  if (!run.po) return <p className="muted">No purchase order was matched.</p>;
  const b = run.poBalance;
  return (
    <div>
      <dl className="facts" style={{ paddingTop: 0 }}>
        <dt>Purchase order</dt>
        <dd><b>{run.po.poNumber}</b> {run.po.inferred ? <span className="chip">suggested, not quoted</span> : <span className="muted">quoted on the invoice as "{run.po.quotedAs}"</span>}</dd>
        {run.po.inferred && <><dt>Why this PO</dt><dd>{run.po.evidence}</dd></>}
        {run.po.inferred && run.po.rejected?.length > 0 && <><dt>Ruled out</dt><dd>{run.po.rejected.join('; ')}</dd></>}
        {b && <>
          <dt>PO total</dt><dd>{inr(b.poTotalPaise)}</dd>
          <dt>Billed before</dt><dd>{inr(b.billedBeforePaise)}</dd>
          <dt>Remaining</dt><dd>{inr(b.remainingBeforePaise)}</dd>
          <dt>This invoice</dt><dd>{inr(run.amounts?.taxablePaise)} before tax</dd>
        </>}
      </dl>
      <p className="small" style={{ marginTop: 18 }}><Link to="/reference">See all purchase orders and invoice history</Link></p>
    </div>
  );
}
