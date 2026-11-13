import { STATUS_LABELS, fmtDuration } from '../api.js';

/** Mirrors backend/src/engine.js auctionStatus so badges flip the second time runs out. */
export function statusAt(rfq, now) {
  if (now < rfq.bidStartAt) return 'SCHEDULED';
  if (now < rfq.currentCloseAt) return 'ACTIVE';
  return rfq.currentCloseAt >= rfq.forcedCloseAt ? 'FORCE_CLOSED' : 'CLOSED';
}

export function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      {status === 'ACTIVE' && <span className="pulse" />}
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Countdown({ rfq, now, compact = false }) {
  const status = statusAt(rfq, now);
  if (status === 'SCHEDULED') {
    return <span className="countdown muted">starts in {fmtDuration(rfq.bidStartAt - now)}</span>;
  }
  if (status !== 'ACTIVE') return <span className="countdown muted">ended</span>;
  const left = rfq.currentCloseAt - now;
  const inWindow = left <= rfq.config.triggerWindowMin * 60_000;
  return (
    <span className={`countdown ${inWindow ? 'hot' : ''}`} title={inWindow ? 'Inside the trigger window' : undefined}>
      {fmtDuration(left)}
      {!compact && <small> left</small>}
    </span>
  );
}

export function RankPill({ label }) {
  const cls = label === 'L1' ? 'rank rank-1' : label === 'L2' ? 'rank rank-2' : label === 'L3' ? 'rank rank-3' : 'rank';
  return <span className={cls}>{label}</span>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
