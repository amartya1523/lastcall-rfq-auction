import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, money, fmtDateTime } from '../api.js';
import { syncServerTime, useLiveEvents, useNow } from '../live.js';
import { StatusBadge, Countdown, statusAt, Empty } from '../components/bits.jsx';

const FILTERS = ['ALL', 'ACTIVE', 'SCHEDULED', 'CLOSED', 'FORCE_CLOSED'];
const FILTER_LABEL = { ALL: 'All', ACTIVE: 'Active', SCHEDULED: 'Scheduled', CLOSED: 'Closed', FORCE_CLOSED: 'Force closed' };

export default function AuctionList() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const now = useNow();
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.listRfqs()
      .then((d) => { syncServerTime(d.serverTime); setItems(d.items); setError(null); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useLiveEvents(load);

  const withStatus = useMemo(() => (items || []).map((r) => ({ ...r, live: statusAt(r, now) })), [items, now]);
  const counts = useMemo(() => {
    const c = { ALL: withStatus.length };
    for (const r of withStatus) c[r.live] = (c[r.live] || 0) + 1;
    return c;
  }, [withStatus]);
  const rows = filter === 'ALL' ? withStatus : withStatus.filter((r) => r.live === filter);

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>British Auctions</h1>
          <p className="sub">Every RFQ running as a reverse auction. Updates live as suppliers bid.</p>
        </div>
        <Link to="/rfqs/new" className="btn btn-primary">+ New RFQ</Link>
      </header>

      <div className="stats">
        <Stat label="Live now" value={counts.ACTIVE || 0} tone="green" />
        <Stat label="Scheduled" value={counts.SCHEDULED || 0} />
        <Stat label="Closed" value={(counts.CLOSED || 0) + (counts.FORCE_CLOSED || 0)} />
        <Stat label="Total bids" value={withStatus.reduce((s, r) => s + r.bidCount, 0)} />
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f} className={`tab ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]} <span>{counts[f] || 0}</span>
          </button>
        ))}
      </div>

      {error && <div className="alert">Could not load auctions: {error}</div>}
      {!items && !error && <div className="skeleton" />}
      {items && rows.length === 0 && (
        <Empty title="No auctions here yet">
          <p>Create an RFQ with British auction enabled to get started.</p>
        </Empty>
      )}

      {rows.length > 0 && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>RFQ</th>
                <th className="num">Current lowest bid</th>
                <th>Current bid close</th>
                <th>Forced close</th>
                <th>Time left</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/rfqs/${r.id}`)}>
                  <td>
                    <div className="rfq-name">{r.name}</div>
                    <div className="mono muted">{r.referenceId} · {r.bidCount} bids · {r.supplierCount} suppliers</div>
                  </td>
                  <td className="num strong">{money(r.lowestBid)}</td>
                  <td>
                    {fmtDateTime(r.currentCloseAt)}
                    {r.extensionCount > 0 && <span className="chip">+{r.extensionCount} ext</span>}
                  </td>
                  <td>{fmtDateTime(r.forcedCloseAt)}</td>
                  <td><Countdown rfq={r} now={now} compact /></td>
                  <td><StatusBadge status={r.live} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
