import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankBids, rankOrder, rankingChanged, l1Changed, evaluateExtension, auctionStatus, STATUS,
} from '../src/engine.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 15, 12, 0); // 6:00 PM IST in the spec example
const bid = (id, supplier_id, total_amount, created_at = id) => ({ id, supplier_id, total_amount, created_at });

const rfq = (over = {}) => ({
  bid_start_at: T0 - 60 * MIN,
  current_close_at: T0,
  forced_close_at: T0 + 30 * MIN,
  ...over,
});
const cfg = (trigger_type, X = 10, Y = 5) => ({ trigger_type, trigger_window_min: X, extension_min: Y });

describe('rankBids', () => {
  test('orders suppliers by their lowest quote', () => {
    const ranked = rankBids([bid(1, 'A', 500), bid(2, 'B', 450), bid(3, 'A', 400)]);
    assert.deepEqual(rankOrder(ranked), ['A', 'B']);
    assert.equal(ranked[0].total_amount, 400);
  });

  test('earlier bid wins a tie', () => {
    assert.deepEqual(rankOrder(rankBids([bid(1, 'A', 300, 10), bid(2, 'B', 300, 5)])), ['B', 'A']);
  });
});

describe('ranking change detection', () => {
  test('new supplier entering counts as a ranking change', () => {
    assert.equal(rankingChanged(['A'], ['A', 'B']), true);
  });
  test('improving price but keeping position is not a change', () => {
    assert.equal(rankingChanged(['A', 'B'], ['A', 'B']), false);
  });
  test('L2 overtaking L1 is both a rank and L1 change', () => {
    assert.equal(rankingChanged(['A', 'B', 'C'], ['B', 'A', 'C']), true);
    assert.equal(l1Changed(['A', 'B', 'C'], ['B', 'A', 'C']), true);
  });
  test('L3 overtaking L2 changes ranks but not L1', () => {
    assert.equal(rankingChanged(['A', 'B', 'C'], ['A', 'C', 'B']), true);
    assert.equal(l1Changed(['A', 'B', 'C'], ['A', 'C', 'B']), false);
  });
});

describe('evaluateExtension', () => {
  test('spec 6.3a: bid at 5:55 with X=10, Y=5 extends 6:00 -> 6:05', () => {
    const r = evaluateExtension({ now: T0 - 5 * MIN, rfq: rfq(), config: cfg('BID_RECEIVED'), before: [], after: ['A'] });
    assert.equal(r.skipped, false);
    assert.equal(r.to, T0 + 5 * MIN);
  });

  test('bid outside the trigger window does nothing', () => {
    const r = evaluateExtension({ now: T0 - 11 * MIN, rfq: rfq(), config: cfg('BID_RECEIVED'), before: [], after: ['A'] });
    assert.equal(r, null);
  });

  test('window start is inclusive (exactly 5:50)', () => {
    const r = evaluateExtension({ now: T0 - 10 * MIN, rfq: rfq(), config: cfg('BID_RECEIVED'), before: [], after: ['A'] });
    assert.ok(r);
  });

  test('spec 6.3b: rank change trigger ignores a bid that keeps everyone in place', () => {
    const r = evaluateExtension({ now: T0 - 2 * MIN, rfq: rfq(), config: cfg('ANY_RANK_CHANGE'), before: ['A', 'B'], after: ['A', 'B'] });
    assert.equal(r, null);
  });

  test('spec 6.3b: B underbids A at 5:58 -> extends', () => {
    const r = evaluateExtension({ now: T0 - 2 * MIN, rfq: rfq(), config: cfg('ANY_RANK_CHANGE'), before: ['A', 'B'], after: ['B', 'A'] });
    assert.equal(r.to, T0 + 5 * MIN);
  });

  test('spec 6.3c: L1 trigger ignores an L3 -> L2 move', () => {
    const r = evaluateExtension({ now: T0 - 1 * MIN, rfq: rfq(), config: cfg('L1_CHANGE'), before: ['A', 'B', 'C'], after: ['A', 'C', 'B'] });
    assert.equal(r, null);
  });

  test('spec 6.3c: C becomes L1 at 5:59 -> extends', () => {
    const r = evaluateExtension({ now: T0 - 1 * MIN, rfq: rfq(), config: cfg('L1_CHANGE'), before: ['A', 'B', 'C'], after: ['C', 'A', 'B'] });
    assert.equal(r.to, T0 + 5 * MIN);
  });

  test('extension is capped at the forced close time', () => {
    const r = evaluateExtension({
      now: T0 - 1 * MIN, rfq: rfq({ forced_close_at: T0 + 3 * MIN }), config: cfg('BID_RECEIVED'), before: [], after: ['A'],
    });
    assert.equal(r.to, T0 + 3 * MIN);
    assert.equal(r.capped, true);
  });

  test('no extension once current close already equals forced close', () => {
    const r = evaluateExtension({
      now: T0 - 1 * MIN, rfq: rfq({ forced_close_at: T0 }), config: cfg('BID_RECEIVED'), before: [], after: ['A'],
    });
    assert.equal(r.skipped, true);
    assert.equal(r.to, T0);
  });
});

describe('auctionStatus', () => {
  test('walks through scheduled -> active -> closed', () => {
    const r = rfq();
    assert.equal(auctionStatus(r, r.bid_start_at - 1), STATUS.SCHEDULED);
    assert.equal(auctionStatus(r, T0 - 1), STATUS.ACTIVE);
    assert.equal(auctionStatus(r, T0), STATUS.CLOSED);
  });
  test('force closed when it ran all the way to the forced close time', () => {
    const r = rfq({ current_close_at: T0 + 30 * MIN });
    assert.equal(auctionStatus(r, T0 + 30 * MIN), STATUS.FORCE_CLOSED);
  });
});
