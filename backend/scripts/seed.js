// Builds a fresh demo database with auctions in every state.
// Past auctions are replayed with a moving clock so their activity logs,
// extensions and close events look exactly like real runs.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createAuctionService } from '../src/service.js';

const MIN = 60_000;
const file = process.env.DB_FILE || path.resolve('data/lastcall.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

const db = openDb(file);
// Anchor everything to a whole minute so the seeded times read cleanly.
const BASE = Math.floor(Date.now() / MIN) * MIN;
let now = BASE;
const service = createAuctionService({ db, clock: () => now });

const iso = (ms) => new Date(ms).toISOString();
const day = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

function auction({ ref, name, startOffset, closeAfter, forcedAfter, X, Y, trigger, pickupIn }) {
  const start = BASE + startOffset * MIN;
  now = Math.min(start, Date.now());
  return service.createRfq({
    name, referenceId: ref, bidStartAt: iso(start), bidCloseAt: iso(start + closeAfter * MIN),
    forcedCloseAt: iso(start + forcedAfter * MIN), pickupDate: day(pickupIn),
    triggerWindowMin: X, extensionMin: Y, triggerType: trigger,
  });
}

function bid(rfq, atMin, carrierName, freight, origin, dest, transit) {
  now = rfq.bidStartAt + atMin * MIN;
  service.submitBid(rfq.id, {
    carrierName, freightCharges: freight, originCharges: origin, destinationCharges: dest,
    transitTimeDays: transit, quoteValidityDate: day(30),
  });
}

// 1. Closed normally after one extension.
const closed = auction({
  ref: 'RFQ-2611-BOM-DEL', name: 'Mumbai → Delhi, 32 ft MXL, 18 T', startOffset: -180,
  closeAfter: 60, forcedAfter: 90, X: 10, Y: 5, trigger: 'BID_RECEIVED', pickupIn: 3,
});
bid(closed, 5, 'Blue Dart Surface', 82000, 4500, 3500, 3);
bid(closed, 18, 'TCI Freight', 79500, 4000, 3500, 3);
bid(closed, 31, 'Delhivery Freight', 78000, 4200, 3000, 2);
bid(closed, 54, 'Blue Dart Surface', 76500, 4500, 3500, 3);

// 2. Bidding war that ran into the forced close.
const forced = auction({
  ref: 'RFQ-2611-MAA-BLR', name: 'Chennai → Bengaluru, 20 ft container', startOffset: -150,
  closeAfter: 40, forcedAfter: 50, X: 10, Y: 5, trigger: 'L1_CHANGE', pickupIn: 2,
});
bid(forced, 4, 'Gati Express', 41000, 2500, 2000, 1);
bid(forced, 12, 'Safexpress', 42500, 2200, 2000, 1);
bid(forced, 33, 'Safexpress', 39500, 2200, 2000, 1);
bid(forced, 41, 'Gati Express', 38800, 2500, 2000, 1);
bid(forced, 47, 'Rivigo', 37900, 2400, 1800, 1);
bid(forced, 49, 'Safexpress', 37000, 2200, 2000, 1);

// 3. Live auction with a healthy runway.
const live = auction({
  ref: 'RFQ-2611-DEL-KOL', name: 'Delhi → Kolkata, 2 × 40 ft HQ', startOffset: -30,
  closeAfter: 75, forcedAfter: 105, X: 10, Y: 5, trigger: 'ANY_RANK_CHANGE', pickupIn: 6,
});
bid(live, 3, 'Maersk Inland', 168000, 9000, 8500, 5);
bid(live, 9, 'Allcargo Logistics', 171000, 8000, 8000, 5);
bid(live, 17, 'TCI Freight', 165500, 8500, 9000, 6);
bid(live, 26, 'Allcargo Logistics', 162000, 8000, 8000, 5);

// 4. Starts later today.
auction({
  ref: 'RFQ-2611-AMD-PNQ', name: 'Ahmedabad → Pune, reefer 24 ft', startOffset: 120,
  closeAfter: 60, forcedAfter: 80, X: 5, Y: 3, trigger: 'BID_RECEIVED', pickupIn: 8,
});

now = Date.now();
service.sweepClosures();
db.close();
console.log(`Seeded demo data into ${file}`);
