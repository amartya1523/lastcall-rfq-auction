import { transaction } from './db.js';
import { rankBids, rankOrder, evaluateExtension, auctionStatus, STATUS } from './engine.js';
import { parseRfqInput, parseBidInput, ConflictError, NotFoundError, ValidationError } from './validate.js';

const fmtTime = (ms) => new Date(ms).toISOString();

export function createAuctionService({ db, clock = () => Date.now(), bus }) {
  const emit = (type, rfqId) => bus?.publish({ type, rfqId, at: clock() });

  const stmts = {
    insertRfq: db.prepare(`
      INSERT INTO rfqs (reference_id, name, bid_start_at, original_close_at, current_close_at,
                        forced_close_at, pickup_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    insertConfig: db.prepare(`
      INSERT INTO auction_configs (rfq_id, trigger_window_min, extension_min, trigger_type)
      VALUES (?, ?, ?, ?)`),
    rfqById: db.prepare(`
      SELECT r.*, c.trigger_window_min, c.extension_min, c.trigger_type
      FROM rfqs r JOIN auction_configs c ON c.rfq_id = r.id WHERE r.id = ?`),
    rfqByRef: db.prepare('SELECT id FROM rfqs WHERE reference_id = ?'),
    listRfqs: db.prepare(`
      SELECT r.*, c.trigger_window_min, c.extension_min, c.trigger_type,
             (SELECT MIN(total_amount) FROM bids b WHERE b.rfq_id = r.id) AS lowest_bid,
             (SELECT COUNT(*) FROM bids b WHERE b.rfq_id = r.id) AS bid_count,
             (SELECT COUNT(DISTINCT supplier_id) FROM bids b WHERE b.rfq_id = r.id) AS supplier_count
      FROM rfqs r JOIN auction_configs c ON c.rfq_id = r.id
      ORDER BY r.created_at DESC`),
    bidsForRfq: db.prepare(`
      SELECT b.*, s.name AS carrier_name
      FROM bids b JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.rfq_id = ? ORDER BY b.created_at ASC, b.id ASC`),
    supplierByName: db.prepare('SELECT * FROM suppliers WHERE name = ?'),
    insertSupplier: db.prepare('INSERT INTO suppliers (name, created_at) VALUES (?, ?)'),
    insertBid: db.prepare(`
      INSERT INTO bids (rfq_id, supplier_id, freight_charges, origin_charges, destination_charges,
                        total_amount, transit_time_days, quote_validity_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    extend: db.prepare(`
      UPDATE rfqs SET current_close_at = ?, extension_count = extension_count + 1
      WHERE id = ? AND current_close_at = ?`),
    insertActivity: db.prepare(`
      INSERT INTO activity_log (rfq_id, type, message, metadata, created_at) VALUES (?, ?, ?, ?, ?)`),
    activityForRfq: db.prepare('SELECT * FROM activity_log WHERE rfq_id = ? ORDER BY created_at DESC, id DESC'),
    dueForClose: db.prepare('SELECT * FROM rfqs WHERE closed_at IS NULL AND current_close_at <= ?'),
    markClosed: db.prepare('UPDATE rfqs SET closed_at = ? WHERE id = ? AND closed_at IS NULL'),
  };

  const log = (rfqId, type, message, metadata, at) =>
    stmts.insertActivity.run(rfqId, type, message, metadata ? JSON.stringify(metadata) : null, at);

  function present(row, now) {
    return {
      id: row.id,
      referenceId: row.reference_id,
      name: row.name,
      bidStartAt: row.bid_start_at,
      originalCloseAt: row.original_close_at,
      currentCloseAt: row.current_close_at,
      forcedCloseAt: row.forced_close_at,
      pickupDate: row.pickup_date,
      extensionCount: row.extension_count,
      status: auctionStatus(row, now),
      config: {
        triggerWindowMin: row.trigger_window_min,
        extensionMin: row.extension_min,
        triggerType: row.trigger_type,
      },
      createdAt: row.created_at,
    };
  }

  function createRfq(body) {
    const now = clock();
    const input = parseRfqInput(body, now);
    const id = transaction(db, () => {
      if (stmts.rfqByRef.get(input.referenceId)) {
        throw new ValidationError({ referenceId: 'An RFQ with this reference already exists' });
      }
      const { lastInsertRowid } = stmts.insertRfq.run(
        input.referenceId, input.name, input.bidStartAt, input.bidCloseAt, input.bidCloseAt,
        input.forcedCloseAt, input.pickupDate, now,
      );
      const rfqId = Number(lastInsertRowid);
      stmts.insertConfig.run(rfqId, input.triggerWindowMin, input.extensionMin, input.triggerType);
      log(rfqId, 'RFQ_CREATED', `RFQ ${input.referenceId} created with British auction enabled`, {
        bidStartAt: input.bidStartAt, bidCloseAt: input.bidCloseAt, forcedCloseAt: input.forcedCloseAt,
      }, now);
      return rfqId;
    });
    emit('rfq.created', id);
    return getRfq(id);
  }

  function listRfqs() {
    const now = clock();
    return stmts.listRfqs.all().map((row) => ({
      ...present(row, now),
      lowestBid: row.lowest_bid,
      bidCount: row.bid_count,
      supplierCount: row.supplier_count,
    }));
  }

  function getRfq(id) {
    const now = clock();
    const row = stmts.rfqById.get(Number(id));
    if (!row) throw new NotFoundError('RFQ not found');
    const bids = stmts.bidsForRfq.all(row.id);
    const ranked = rankBids(bids).map((b, i) => ({ ...presentBid(b), rank: i + 1, label: `L${i + 1}` }));
    const bestBySupplier = new Map(ranked.map((b) => [b.id, b]));
    return {
      ...present(row, now),
      serverTime: now,
      lowestBid: ranked[0]?.totalAmount ?? null,
      ranking: ranked,
      bids: bids.map((b) => ({ ...presentBid(b), isCurrentBest: bestBySupplier.has(b.id) })).reverse(),
      activity: stmts.activityForRfq.all(row.id).map((a) => ({
        id: a.id, type: a.type, message: a.message, createdAt: a.created_at,
        metadata: a.metadata ? JSON.parse(a.metadata) : null,
      })),
    };
  }

  function submitBid(rfqId, body) {
    const input = parseBidInput(body);
    const result = transaction(db, () => {
      // Read the clock inside the transaction so the time check and the
      // extension decision are made against the same snapshot.
      const now = clock();
      const rfq = stmts.rfqById.get(Number(rfqId));
      if (!rfq) throw new NotFoundError('RFQ not found');

      const status = auctionStatus(rfq, now);
      if (status === STATUS.SCHEDULED) throw new ConflictError('Bidding has not started yet');
      if (status !== STATUS.ACTIVE) throw new ConflictError('This auction is closed for bidding');
      if (input.quoteValidityDate < new Date(now).toISOString().slice(0, 10)) {
        throw new ValidationError({ quoteValidityDate: 'Quote validity cannot be in the past' });
      }

      let supplier = stmts.supplierByName.get(input.carrierName);
      if (!supplier) {
        const { lastInsertRowid } = stmts.insertSupplier.run(input.carrierName, now);
        supplier = { id: Number(lastInsertRowid), name: input.carrierName };
      }

      const existing = stmts.bidsForRfq.all(rfq.id);
      const before = rankBids(existing);
      const own = before.find((b) => b.supplier_id === supplier.id);
      if (own && input.totalAmount >= own.total_amount) {
        throw new ValidationError({
          freightCharges: `New quote must be lower than your current quote of ₹${(own.total_amount / 100).toLocaleString('en-IN')}`,
        });
      }

      const { lastInsertRowid } = stmts.insertBid.run(
        rfq.id, supplier.id, input.freightCharges, input.originCharges, input.destinationCharges,
        input.totalAmount, input.transitTimeDays, input.quoteValidityDate, now,
      );
      const bidId = Number(lastInsertRowid);
      const after = rankBids([...existing, {
        id: bidId, supplier_id: supplier.id, total_amount: input.totalAmount, created_at: now,
      }]);
      const rank = after.findIndex((b) => b.id === bidId) + 1;

      log(rfq.id, 'BID_SUBMITTED',
        `${supplier.name} quoted ₹${(input.totalAmount / 100).toLocaleString('en-IN')} (now L${rank})`,
        { bidId, supplier: supplier.name, totalAmount: input.totalAmount, rank }, now);

      const decision = evaluateExtension({
        now, rfq, config: rfq, before: rankOrder(before), after: rankOrder(after),
      });
      let extension = null;
      if (decision?.skipped) {
        log(rfq.id, 'EXTENSION_SKIPPED',
          `${decision.reason}, but the auction is already at its forced close time`,
          { reason: decision.reason, forcedCloseAt: rfq.forced_close_at }, now);
      } else if (decision) {
        stmts.extend.run(decision.to, rfq.id, rfq.current_close_at);
        const minutes = Math.round((decision.to - decision.from) / 60_000 * 10) / 10;
        log(rfq.id, 'TIME_EXTENDED',
          `Extended by ${minutes} min${decision.capped ? ' (capped at forced close)' : ''}: ${decision.reason}`,
          { reason: decision.reason, from: decision.from, to: decision.to, capped: decision.capped, triggeredBy: bidId }, now);
        extension = { from: fmtTime(decision.from), to: fmtTime(decision.to), reason: decision.reason, capped: decision.capped };
      }
      return { bidId, rank, extension };
    });
    emit('bid.submitted', Number(rfqId));
    return { ...result, rfq: getRfq(rfqId) };
  }

  /** Writes a one-off close entry into the activity log for auctions whose time ran out. */
  function sweepClosures() {
    const now = clock();
    const due = stmts.dueForClose.all(now);
    for (const rfq of due) {
      const forced = rfq.current_close_at >= rfq.forced_close_at;
      transaction(db, () => {
        const { changes } = stmts.markClosed.run(rfq.current_close_at, rfq.id);
        if (!changes) return;
        log(rfq.id, forced ? 'AUCTION_FORCE_CLOSED' : 'AUCTION_CLOSED',
          forced ? 'Auction force closed: reached the forced bid close time' : 'Auction closed: no further extensions triggered',
          { closedAt: rfq.current_close_at, extensions: rfq.extension_count }, rfq.current_close_at);
      });
      emit('auction.closed', rfq.id);
    }
    return due.length;
  }

  return { createRfq, listRfqs, getRfq, submitBid, sweepClosures };
}

function presentBid(b) {
  return {
    id: b.id,
    supplierId: b.supplier_id,
    carrierName: b.carrier_name,
    freightCharges: b.freight_charges,
    originCharges: b.origin_charges,
    destinationCharges: b.destination_charges,
    totalAmount: b.total_amount,
    transitTimeDays: b.transit_time_days,
    quoteValidityDate: b.quote_validity_date,
    createdAt: b.created_at,
  };
}
