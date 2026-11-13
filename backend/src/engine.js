// Pure auction rules. No I/O here, so every rule is unit-testable with a
// fake clock and hand-built rankings.

export const TRIGGER_TYPES = Object.freeze({
  BID_RECEIVED: 'BID_RECEIVED',
  ANY_RANK_CHANGE: 'ANY_RANK_CHANGE',
  L1_CHANGE: 'L1_CHANGE',
});

export const STATUS = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  FORCE_CLOSED: 'FORCE_CLOSED',
});

const MINUTE = 60_000;

/**
 * Ranks suppliers by their best (latest) quote.
 * Ties are broken by who got there first, which rewards the earlier bidder.
 * @param {Array<{supplier_id:number,total_amount:number,created_at:number,id:number}>} bids
 * @returns {Array<object>} one entry per supplier, L1 first
 */
export function rankBids(bids) {
  const best = new Map();
  for (const bid of bids) {
    const cur = best.get(bid.supplier_id);
    if (!cur || bid.total_amount < cur.total_amount ||
        (bid.total_amount === cur.total_amount && bid.created_at < cur.created_at)) {
      best.set(bid.supplier_id, bid);
    }
  }
  return [...best.values()].sort(
    (a, b) => a.total_amount - b.total_amount || a.created_at - b.created_at || a.id - b.id,
  );
}

/** supplier ids in rank order */
export const rankOrder = (ranked) => ranked.map((b) => b.supplier_id);

/**
 * Any supplier's rank position changed, or a supplier entered the ranking.
 * A supplier improving their price while keeping their position is NOT a change.
 */
export function rankingChanged(before, after) {
  if (before.length !== after.length) return true;
  return after.some((id, i) => before[i] !== id);
}

/** The L1 (lowest) supplier is different from before. */
export function l1Changed(before, after) {
  return after.length > 0 && before[0] !== after[0];
}

export function isInTriggerWindow(now, currentCloseAt, windowMin) {
  return now >= currentCloseAt - windowMin * MINUTE && now < currentCloseAt;
}

/**
 * Decides whether a just-accepted bid extends the auction.
 *
 * Returns null when nothing should happen, otherwise an object describing
 * the decision. When the forced close time already caps the auction the
 * result has `skipped: true` so we can still log *why* it did not extend.
 */
export function evaluateExtension({ now, rfq, config, before, after }) {
  const { trigger_window_min: X, extension_min: Y, trigger_type: type } = config;
  if (!isInTriggerWindow(now, rfq.current_close_at, X)) return null;

  let reason = null;
  if (type === TRIGGER_TYPES.BID_RECEIVED) {
    reason = `Bid received within the last ${X} min of close`;
  } else if (type === TRIGGER_TYPES.ANY_RANK_CHANGE && rankingChanged(before, after)) {
    reason = `Supplier ranking changed within the last ${X} min of close`;
  } else if (type === TRIGGER_TYPES.L1_CHANGE && l1Changed(before, after)) {
    reason = `New lowest bidder (L1) within the last ${X} min of close`;
  }
  if (!reason) return null;

  const from = rfq.current_close_at;
  if (from >= rfq.forced_close_at) {
    return { skipped: true, reason, from, to: from };
  }
  const proposed = from + Y * MINUTE;
  const to = Math.min(proposed, rfq.forced_close_at);
  return { skipped: false, reason, from, to, capped: proposed > rfq.forced_close_at };
}

export function auctionStatus(rfq, now) {
  if (now < rfq.bid_start_at) return STATUS.SCHEDULED;
  if (now < rfq.current_close_at) return STATUS.ACTIVE;
  return rfq.current_close_at >= rfq.forced_close_at ? STATUS.FORCE_CLOSED : STATUS.CLOSED;
}
