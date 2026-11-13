import { fmtTime } from '../api.js';

/**
 * Horizontal bar from bid start to forced close:
 *  - shaded zone   = live trigger window (X min before current close)
 *  - solid fill    = time elapsed
 *  - markers       = original close, current close, forced close, now
 */
export default function Timeline({ rfq, now }) {
  const start = rfq.bidStartAt;
  const end = rfq.forcedCloseAt;
  const span = end - start;
  const pct = (t) => `${Math.min(100, Math.max(0, ((t - start) / span) * 100))}%`;
  const windowStart = rfq.currentCloseAt - rfq.config.triggerWindowMin * 60_000;
  const extended = rfq.currentCloseAt > rfq.originalCloseAt;

  return (
    <div className="timeline">
      <div className="tl-track">
        <div className="tl-elapsed" style={{ width: pct(Math.min(now, rfq.currentCloseAt)) }} />
        <div className="tl-ext" style={{ left: pct(rfq.originalCloseAt), width: `calc(${pct(rfq.currentCloseAt)} - ${pct(rfq.originalCloseAt)})` }} />
        <div className="tl-window" style={{ left: pct(windowStart), width: `calc(${pct(rfq.currentCloseAt)} - ${pct(windowStart)})` }} />
        {extended && <i className="tl-mark tl-orig" style={{ left: pct(rfq.originalCloseAt) }} />}
        <i className="tl-mark tl-close" style={{ left: pct(rfq.currentCloseAt) }} />
        <i className="tl-mark tl-forced" style={{ left: '100%' }} />
        {now > start && now < end && <i className="tl-now" style={{ left: pct(now) }} />}
      </div>
      <div className="tl-legend">
        <span><b>Start</b> {fmtTime(start)}</span>
        {extended && <span className="lg-orig"><b>Original close</b> {fmtTime(rfq.originalCloseAt)}</span>}
        <span className="lg-close"><b>Current close</b> {fmtTime(rfq.currentCloseAt)}</span>
        <span className="lg-window"><b>Trigger window</b> last {rfq.config.triggerWindowMin} min</span>
        <span className="lg-forced"><b>Forced close</b> {fmtTime(end)}</span>
      </div>
    </div>
  );
}
