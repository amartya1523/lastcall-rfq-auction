import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createEventBus } from '../src/events.js';
import { createAuctionService } from '../src/service.js';
import { createApp } from '../src/app.js';

const MIN = 60_000;
let now = Date.UTC(2026, 10, 15, 11, 0);
const clock = () => now;

let server;
let base;
let service;

before(async () => {
  const db = openDb(':memory:');
  const bus = createEventBus();
  service = createAuctionService({ db, bus, clock });
  server = createApp({ service, bus, clock }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const get = async (path) => (await fetch(base + path)).json();

const rfqBody = (over = {}) => ({
  name: 'Mumbai to Delhi FTL',
  referenceId: `RFQ-${Math.random().toString(36).slice(2, 8)}`,
  bidStartAt: new Date(now).toISOString(),
  bidCloseAt: new Date(now + 60 * MIN).toISOString(),
  forcedCloseAt: new Date(now + 75 * MIN).toISOString(),
  pickupDate: '2026-11-20',
  triggerWindowMin: 10,
  extensionMin: 5,
  triggerType: 'BID_RECEIVED',
  ...over,
});
const quote = (carrierName, freight, over = {}) => ({
  carrierName, freightCharges: freight, originCharges: 1000, destinationCharges: 1000,
  transitTimeDays: 3, quoteValidityDate: '2026-12-01', ...over,
});

describe('RFQ creation', () => {
  test('rejects forced close that is not after bid close', async () => {
    const res = await post('/rfqs', rfqBody({ forcedCloseAt: new Date(now + 60 * MIN).toISOString() }));
    assert.equal(res.status, 400);
    assert.match(res.body.fields.forcedCloseAt, /later than bid close/);
  });

  test('rejects duplicate reference ids', async () => {
    const body = rfqBody({ referenceId: 'RFQ-DUP-1' });
    assert.equal((await post('/rfqs', body)).status, 201);
    assert.equal((await post('/rfqs', body)).status, 400);
  });
});

describe('bidding flow', () => {
  test('extends, caps at forced close and then closes', async () => {
    const start = now;
    const { body: rfq } = await post('/rfqs', rfqBody({ forcedCloseAt: new Date(start + 68 * MIN).toISOString() }));
    assert.equal(rfq.status, 'ACTIVE');

    // Early bid: outside the 10 min window, no extension.
    let r = await post(`/rfqs/${rfq.id}/bids`, quote('Blue Dart', 50000));
    assert.equal(r.status, 201);
    assert.equal(r.body.extension, null);

    // A supplier cannot raise or repeat their own price.
    r = await post(`/rfqs/${rfq.id}/bids`, quote('blue dart', 50000));
    assert.equal(r.status, 400);

    // 55 min in: inside the window, close moves 60 -> 65.
    now = start + 55 * MIN;
    r = await post(`/rfqs/${rfq.id}/bids`, quote('Delhivery', 48000));
    assert.equal(r.body.rank, 1);
    assert.equal(r.body.rfq.currentCloseAt, start + 65 * MIN);

    // 64 min in: would go to 70, but forced close is 68.
    now = start + 64 * MIN;
    r = await post(`/rfqs/${rfq.id}/bids`, quote('Blue Dart', 47000));
    assert.equal(r.body.extension.capped, true);
    assert.equal(r.body.rfq.currentCloseAt, start + 68 * MIN);

    // 67 min in: already at forced close, logged but not extended.
    now = start + 67 * MIN;
    r = await post(`/rfqs/${rfq.id}/bids`, quote('Gati', 46000));
    assert.equal(r.body.rfq.currentCloseAt, start + 68 * MIN);
    assert.ok(r.body.rfq.activity.some((a) => a.type === 'EXTENSION_SKIPPED'));

    // After forced close nothing is accepted.
    now = start + 68 * MIN;
    r = await post(`/rfqs/${rfq.id}/bids`, quote('Gati', 45000));
    assert.equal(r.status, 409);

    service.sweepClosures();
    const detail = await get(`/rfqs/${rfq.id}`);
    assert.equal(detail.status, 'FORCE_CLOSED');
    assert.deepEqual(detail.ranking.map((b) => b.label), ['L1', 'L2', 'L3']);
    assert.deepEqual(detail.ranking.map((b) => b.carrierName), ['Gati', 'Blue Dart', 'Delhivery']);
    assert.equal(detail.activity[0].type, 'AUCTION_FORCE_CLOSED');
  });

  test('L1 trigger only extends when the leader changes', async () => {
    now = Date.UTC(2026, 10, 16, 10, 0);
    const start = now;
    const { body: rfq } = await post('/rfqs', rfqBody({ triggerType: 'L1_CHANGE' }));
    await post(`/rfqs/${rfq.id}/bids`, quote('A Logistics', 30000));
    await post(`/rfqs/${rfq.id}/bids`, quote('B Freight', 40000));

    now = start + 55 * MIN;
    let r = await post(`/rfqs/${rfq.id}/bids`, quote('C Movers', 35000)); // becomes L2
    assert.equal(r.body.extension, null);

    r = await post(`/rfqs/${rfq.id}/bids`, quote('C Movers', 25000)); // takes L1
    assert.ok(r.body.extension);
    assert.equal(r.body.rfq.currentCloseAt, start + 65 * MIN);

    const list = await get('/rfqs');
    const row = list.items.find((i) => i.id === rfq.id);
    assert.equal(row.lowestBid, 2700000); // 25,000 + 1,000 + 1,000 rupees in paise
  });
});
