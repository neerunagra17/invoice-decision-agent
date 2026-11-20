const PILL = { APPROVE: 'Approve', HOLD: 'Hold', REJECT: 'Reject' };

export const DecisionBadge = ({ decision, status }) => {
  if (!decision) {
    const failed = status === 'failed';
    return <span className={`pill ${failed ? 'failed' : 'pending'}`}>{failed ? 'Failed' : status === 'queued' ? 'Queued' : 'Processing'}</span>;
  }
  return <span className={`pill ${decision.toLowerCase()}`}>{PILL[decision] || decision}</span>;
};

export const ResultTag = ({ result }) => <span className={`tag ${result}`}>{{ pass: 'Pass', info: 'Note', hold: 'Hold', reject: 'Reject' }[result]}</span>;

// Small line icons, drawn rather than typed so they render the same everywhere.
export const Icon = ({ name, size = 18 }) => {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'check') return <svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
  if (name === 'pause') return <svg {...p}><path d="M9 6v12M15 6v12" /></svg>;
  if (name === 'x') return <svg {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
  if (name === 'alert') return <svg {...p}><path d="M12 7v6M12 17h.01" /></svg>;
  if (name === 'dash') return <svg {...p}><path d="M7 12h10" /></svg>;
  if (name === 'doc') return <svg {...p} strokeWidth={1.8}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 13h5M10 17h5" /></svg>;
  if (name === 'upload') return <svg {...p} strokeWidth={1.8}><path d="M12 16V5M7.5 9.5L12 5l4.5 4.5" /><path d="M5 15v4h14v-4" /></svg>;
  return null;
};
