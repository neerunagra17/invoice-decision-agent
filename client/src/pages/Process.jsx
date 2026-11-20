import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Decision.jsx';

export default function Process() {
  const nav = useNavigate();
  const [samples, setSamples] = useState([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const input = useRef();
  useEffect(() => { api.samples().then(setSamples).catch(e => setError(e.message)); }, []);

  async function start(fn, label) {
    setError(null); setBusy(label);
    try { const { id } = await fn(); nav(`/runs/${id}`); } catch (e) { setError(e.message); setBusy(null); }
  }
  const onFile = f => f && start(() => api.upload(f), f.name);
  const open = () => !busy && input.current.click();

  return (
    <div>
      <header className="page-head">
        <h1>Process an invoice</h1>
        <p className="lede">Upload a vendor invoice as a PDF. It is read, checked against your purchase orders and approved vendors, and given a recommendation to approve, hold or reject, with the reasons.</p>
      </header>

      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        role="button" tabIndex={0} aria-label="Upload an invoice PDF"
        onClick={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
      >
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e => onFile(e.target.files[0])} />
        <div className="dz-icon"><Icon name="upload" size={26} /></div>
        <div className="dz-title">{drag ? 'Release to upload' : 'Drop an invoice PDF here'}</div>
        <div className="dz-sub">or <span style={{ color: 'var(--accent-ink)' }}>choose a file</span>. Digital or scanned, up to 10 MB.</div>
      </div>
      {busy && <p className="status-line"><span className="spinner" /> Uploading {busy}…</p>}
      {error && <p className="error">{error}</p>}

      <section className="section">
        <div className="section-head"><h2>Sample invoices</h2><span className="aside">Run 01 before 02: the second is a re-sent copy of the first.</span></div>
        <ul className="inset-list">
          {samples.map(s => (
            <li key={s.file}>
              <div className="row-main">
                <div className="row-title">{s.title}</div>
                <div className="row-sub">{s.about}</div>
              </div>
              <div className="row-actions">
                <a href={`/api/samples/${s.file}`} target="_blank" rel="noreferrer">View PDF</a>
                <button className="btn small" disabled={!!busy} onClick={() => start(() => api.runSample(s.file), s.file)}>Run</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <div className="section-head"><h2>How a decision is made</h2></div>
        <ol className="steps">
          <li><b>Read</b>The PDF's text is read, and scanned images are detected.</li>
          <li><b>Extract</b>Gemini pulls out each field with the text it came from. Missing values stay empty, never guessed.</li>
          <li><b>Validate</b>Required fields, arithmetic and GSTIN are checked, and values are found in the document.</li>
          <li><b>Match</b>The vendor, purchase order, each line and the remaining PO balance are matched.</li>
          <li><b>Decide</b>GST and duplicates are checked. Any reject means Reject, any hold means Hold, otherwise Approve.</li>
        </ol>
        <p className="fine" style={{ margin: '12px 4px 0' }}>Only the extract step uses a language model. Every decision after it is a fixed rule, so the same extracted data always gets the same decision. Anything the system cannot verify goes to a person.</p>
      </section>
    </div>
  );
}
