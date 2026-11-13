import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// All timestamps are stored as epoch milliseconds (INTEGER) so that
// comparisons in SQL and in JS are cheap and timezone-free.
// All money is stored in minor units (paise) to avoid float rounding.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS rfqs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_id       TEXT    NOT NULL UNIQUE,
  name               TEXT    NOT NULL,
  bid_start_at       INTEGER NOT NULL,
  original_close_at  INTEGER NOT NULL,
  current_close_at   INTEGER NOT NULL,
  forced_close_at    INTEGER NOT NULL,
  pickup_date        TEXT    NOT NULL,
  extension_count    INTEGER NOT NULL DEFAULT 0,
  closed_at          INTEGER,
  created_at         INTEGER NOT NULL,
  CHECK (original_close_at > bid_start_at),
  CHECK (forced_close_at > original_close_at),
  CHECK (current_close_at >= original_close_at),
  CHECK (current_close_at <= forced_close_at)
);

CREATE TABLE IF NOT EXISTS auction_configs (
  rfq_id              INTEGER PRIMARY KEY REFERENCES rfqs(id) ON DELETE CASCADE,
  trigger_window_min  INTEGER NOT NULL CHECK (trigger_window_min > 0),
  extension_min       INTEGER NOT NULL CHECK (extension_min > 0),
  trigger_type        TEXT    NOT NULL
                      CHECK (trigger_type IN ('BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_CHANGE'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bids (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id                INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id           INTEGER NOT NULL REFERENCES suppliers(id),
  freight_charges       INTEGER NOT NULL CHECK (freight_charges >= 0),
  origin_charges        INTEGER NOT NULL CHECK (origin_charges >= 0),
  destination_charges   INTEGER NOT NULL CHECK (destination_charges >= 0),
  total_amount          INTEGER NOT NULL CHECK (total_amount > 0),
  transit_time_days     INTEGER NOT NULL CHECK (transit_time_days > 0),
  quote_validity_date   TEXT    NOT NULL,
  created_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bids_rfq_supplier ON bids (rfq_id, supplier_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bids_rfq_total    ON bids (rfq_id, total_amount);

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id      INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL
              CHECK (type IN ('RFQ_CREATED', 'BID_SUBMITTED', 'TIME_EXTENDED',
                              'EXTENSION_SKIPPED', 'AUCTION_CLOSED', 'AUCTION_FORCE_CLOSED')),
  message     TEXT    NOT NULL,
  metadata    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_rfq ON activity_log (rfq_id, created_at);
`;

export function openDb(file = process.env.DB_FILE || path.resolve('data/lastcall.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Runs fn inside BEGIN IMMEDIATE so concurrent bids on the same database
// are serialised: the ranking we read is the ranking we write against.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
