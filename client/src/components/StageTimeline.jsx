import { secs } from '../api.js';
import { Icon } from './Decision.jsx';

// One row per pipeline stage; rows change state as Socket.io events arrive.
export default function StageTimeline({ run }) {
  const worst = key => {
    const cs = run.checks.filter(c => c.stage === key);
    return cs.some(c => c.result === 'reject') ? 'reject' : cs.some(c => c.result === 'hold') ? 'hold' : null;
  };
  return (
    <ol className="timeline">
      {run.stages.map(s => {
        const flag = s.status === 'done' ? worst(s.key) : null;
        const icon = s.status === 'running' ? <span className="spinner" />
          : s.status === 'done' ? <Icon name={flag ? 'alert' : 'check'} size={15} />
          : s.status === 'failed' ? <Icon name="x" size={14} />
          : s.status === 'skipped' ? <Icon name="dash" size={14} /> : null;
        const summary = s.status === 'running' ? (s.key === 'extract' ? 'Reading the document with the model…' : 'Working…')
          : s.status === 'pending' ? null : s.status === 'skipped' && !s.summary ? 'Skipped' : s.summary;
        return (
          <li key={s.key} className={`stage ${s.status} ${flag || ''}`}>
            <span className="s-dot">{icon}</span>
            <span className="s-label">{s.label}</span>
            <span className="s-ms">{s.ms != null ? secs(s.ms) : ''}</span>
            {summary && <span className="s-summary">{summary}</span>}
          </li>
        );
      })}
    </ol>
  );
}
