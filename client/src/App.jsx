import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { api, socket } from './api.js';
import Process from './pages/Process.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Run from './pages/Run.jsx';
import Reference from './pages/Reference.jsx';

const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#000" />
    <path d="M10 7.5h8.5l4 4V24.5H10z" fill="#fff" />
    <path d="M13 17.2l2.4 2.4 4.4-4.6" stroke="#000" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function App() {
  const [health, setHealth] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ ok: false }));
    const on = () => setConnected(true), off = () => setConnected(false);
    socket.on('connect', on); socket.on('disconnect', off);
    setConnected(socket.connected); // the socket may have connected before this effect subscribed
    return () => { socket.off('connect', on); socket.off('disconnect', off); };
  }, []);
  const model = health?.extractor?.replace(/^gemini · /, '');

  return (
    <div className="app">
      {health?.mock && <div className="mock-banner">Test mode: invoices are not being read; the extractor returns stored test data. Set EXTRACTOR=gemini for real runs.</div>}
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><Logo /> <span className="name">Invoice Decision Agent</span> <span className="for">for Ganga Infra Projects</span></Link>
          <nav>
            <NavLink to="/" end>Process invoice</NavLink>
            <NavLink to="/runs">Runs</NavLink>
            <NavLink to="/reference">Reference data</NavLink>
          </nav>
          <div className="env" title={connected ? 'Live updates connected' : 'Live updates disconnected'}>
            <span className={`dot ${connected ? 'ok' : 'bad'}`} />
            {model && <span>{model}</span>}
            {health?.storage && <><span className="sep" /><span>{health.storage === 'mongo' ? 'MongoDB' : 'In-memory storage'}</span></>}
          </div>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Process />} />
          <Route path="/runs" element={<Dashboard />} />
          <Route path="/runs/:id" element={<Run />} />
          <Route path="/reference" element={<Reference />} />
          <Route path="*" element={<p className="muted">This page doesn't exist. <Link to="/">Process an invoice</Link></p>} />
        </Routes>
      </main>
    </div>
  );
}
