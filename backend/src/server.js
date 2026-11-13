import { openDb } from './db.js';
import { createEventBus } from './events.js';
import { createAuctionService } from './service.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 4100;

const db = openDb();
const bus = createEventBus();
const service = createAuctionService({ db, bus });
const app = createApp({ service, bus });

// Every second, record a close event for auctions whose time ran out so the
// activity log and connected browsers learn about it without a page refresh.
const sweeper = setInterval(() => {
  try {
    service.sweepClosures();
  } catch (err) {
    console.error('close sweep failed', err);
  }
}, 1000);

const server = app.listen(PORT, () => console.log(`LastCall API listening on http://localhost:${PORT}`));

function shutdown() {
  clearInterval(sweeper);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
