import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, money, fmtDateTime, fmtDate, fmtTime, TRIGGER_LABELS } from '../api.js';
import { syncServerTime, useLiveEvents, useNow } from '../live.js';
import { StatusBadge, Countdown, RankPill, statusAt, Empty } from '../components/bits.jsx';
import Timeline from '../components/Timeline.jsx';
import QuoteForm from '../components/QuoteForm.jsx';
import ActivityLog from '../components/ActivityLog.jsx';

export default function AuctionDetail() {
  const { id } = useParams();
  const [rfq, setRfq] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const lastClose = useRef(null);
  const now = useNow(250);

  const apply = useCallback((data) => {
    syncServerTime(data.serverTime);
    if (lastClose.current && data.currentCloseAt > lastClose.current) {
      const ext = data.activity.find((a) => a.type === 'TIME_EXTENDED');
      setFlash(ext ? `Extended to ${fmtTime(data.currentCloseAt)}: ${ext.metadata?.reason}` : 'Auction extended');
      setTimeout(() => setFlash(null), 6000);
    }
    lastClose.current = data.currentCloseAt;
    setRfq(data);
  }, []);

  const load = useCallback(() => {
    api.getRfq(id).then(apply).catch((e) => setError(e));
  }, [id, apply]);
  useEffect(load, [load]);
  const connected = useLiveEvents((ev) => {
    if (String(ev.rfqId) === String(id)) load();
  });

  if (error) {
    return (
      <Empty title={error.status === 404 ? 'RFQ not found' : 'Could not load this RFQ'}>
        <Link to="/" className="btn">Back to auctions</Link>
      </Empty>
    );
  }
  if (!rfq) return <div className="skeleton tall" />;

  const status = statusAt(rfq, now);
  const extendedBy = Math.round((rfq.currentCloseAt - rfq.originalCloseAt) / 60_000);

  return (
    <section>
      <Link to="/" className="back">← All auctions</Link>
      <header className="page-head detail-head">
        <div>
          <div className="eyebrow mono">{rfq.referenceId}</div>
          <h1>{rfq.name}</h1>
          <p className="sub">
            Pickup {fmtDate(rfq.pickupDate)} · {rfq.ranking.length} suppliers · {rfq.bids.length} bids
            <span className={`live-dot ${connected ? 'on' : ''}`}>{connected ? 'live' : 'reconnecting'}</span>
          </p>
        </div>
        <div className="head-right">
          <StatusBadge status={status} />
          <div className="big-countdown"><Countdown rfq={rfq} now={now} /></div>
        </div>
      </header>

      {flash && <div className="flash">⏱ {flash}</div>}

      <div className="card">
        <Timeline rfq={rfq} now={now} />
      </div>

      <div className="kpis">
        <Kpi label="Current lowest (L1)" value={money(rfq.lowestBid)} strong />
        <Kpi label="Current bid close" value={fmtDateTime(rfq.currentCloseAt)} sub={extendedBy ? `+${extendedBy} min over ${rfq.extensionCount} extension${rfq.extensionCount === 1 ? '' : 's'}` : 'not extended'} />
        <Kpi label="Forced close" value={fmtDateTime(rfq.forcedCloseAt)} sub="hard stop" />
        <Kpi label="Bid start" value={fmtDateTime(rfq.bidStartAt)} />
      </div>

      <div className="detail-grid">
        <div className="col-main">
          <div className="card">
            <div className="row-between"><h2>Supplier ranking</h2><span className="muted small">best quote per supplier, lowest first</span></div>
            {rfq.ranking.length === 0 ? (
              <p className="muted">No quotes yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rank</th><th>Carrier</th><th className="num">Freight</th><th className="num">Origin</th>
                      <th className="num">Destination</th><th className="num">Total</th><th>Transit</th><th>Valid until</th><th>Bid at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfq.ranking.map((b) => (
                      <tr key={b.id} className={b.rank === 1 ? 'leader' : ''}>
                        <td><RankPill label={b.label} /></td>
                        <td className="strong">{b.carrierName}</td>
                        <td className="num">{money(b.freightCharges)}</td>
                        <td className="num">{money(b.originCharges)}</td>
                        <td className="num">{money(b.destinationCharges)}</td>
                        <td className="num strong">{money(b.totalAmount)}</td>
                        <td>{b.transitTimeDays} d</td>
                        <td>{fmtDate(b.quoteValidityDate)}</td>
                        <td className="mono muted">{fmtTime(b.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="row-between"><h2>All bids</h2><span className="muted small">newest first, including superseded quotes</span></div>
            {rfq.bids.length === 0 ? <p className="muted">No bids yet.</p> : (
              <div className="table-scroll">
                <table className="table compact">
                  <thead><tr><th>Time</th><th>Carrier</th><th className="num">Total</th><th>Transit</th><th /></tr></thead>
                  <tbody>
                    {rfq.bids.map((b) => (
                      <tr key={b.id} className={b.isCurrentBest ? '' : 'superseded'}>
                        <td className="mono">{fmtTime(b.createdAt)}</td>
                        <td>{b.carrierName}</td>
                        <td className="num">{money(b.totalAmount)}</td>
                        <td>{b.transitTimeDays} d</td>
                        <td className="muted small">{b.isCurrentBest ? 'current' : 'superseded'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="col-side">
          <QuoteForm rfq={rfq} disabled={status !== 'ACTIVE'} onSubmitted={apply} />

          <div className="card config">
            <h2>Auction configuration</h2>
            <dl>
              <dt>Trigger window (X)</dt><dd>{rfq.config.triggerWindowMin} min</dd>
              <dt>Extension (Y)</dt><dd>{rfq.config.extensionMin} min</dd>
              <dt>Trigger</dt><dd>{TRIGGER_LABELS[rfq.config.triggerType]}</dd>
              <dt>Original close</dt><dd>{fmtDateTime(rfq.originalCloseAt)}</dd>
            </dl>
          </div>

          <div className="card">
            <h2>Activity log</h2>
            <ActivityLog items={rfq.activity} />
          </div>
        </aside>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, strong }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b className={strong ? 'accent' : ''}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}
