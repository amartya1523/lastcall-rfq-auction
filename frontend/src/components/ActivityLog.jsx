import { fmtTime } from '../api.js';

const META = {
  RFQ_CREATED: { icon: '✦', cls: 'ev-neutral', title: 'RFQ created' },
  BID_SUBMITTED: { icon: '₹', cls: 'ev-bid', title: 'Bid submitted' },
  TIME_EXTENDED: { icon: '⏱', cls: 'ev-ext', title: 'Time extended' },
  EXTENSION_SKIPPED: { icon: '⛔', cls: 'ev-skip', title: 'Extension blocked' },
  AUCTION_CLOSED: { icon: '■', cls: 'ev-close', title: 'Auction closed' },
  AUCTION_FORCE_CLOSED: { icon: '■', cls: 'ev-force', title: 'Force closed' },
};

export default function ActivityLog({ items }) {
  return (
    <ol className="activity">
      {items.map((a) => {
        const m = META[a.type] || META.RFQ_CREATED;
        return (
          <li key={a.id} className={m.cls}>
            <span className="ev-icon" aria-hidden>{m.icon}</span>
            <div>
              <div className="ev-head">
                <b>{m.title}</b>
                <time className="mono">{fmtTime(a.createdAt)}</time>
              </div>
              <p>{a.message}</p>
              {a.type === 'TIME_EXTENDED' && a.metadata && (
                <p className="ev-detail mono">
                  {fmtTime(a.metadata.from)} → {fmtTime(a.metadata.to)}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
