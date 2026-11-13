import { TRIGGER_TYPES } from './engine.js';

export class ValidationError extends Error {
  constructor(errors) {
    super('Validation failed');
    this.status = 400;
    this.errors = errors; // { field: message }
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.status = 404;
  }
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const toTime = (v) => (isBlank(v) ? NaN : new Date(v).getTime());
const isDateOnly = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Rupees (number or numeric string, max 2 decimals) -> paise integer */
const toPaise = (v) => {
  if (isBlank(v)) return NaN;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
};

export function parseRfqInput(body, now) {
  const e = {};
  const name = String(body.name ?? '').trim();
  const referenceId = String(body.referenceId ?? '').trim().toUpperCase();
  const start = toTime(body.bidStartAt);
  const close = toTime(body.bidCloseAt);
  const forced = toTime(body.forcedCloseAt);
  const X = Number(body.triggerWindowMin);
  const Y = Number(body.extensionMin);
  const type = body.triggerType;

  if (!name) e.name = 'RFQ name is required';
  else if (name.length > 120) e.name = 'Keep the name under 120 characters';

  if (!referenceId) e.referenceId = 'Reference ID is required';
  else if (!/^[A-Z0-9][A-Z0-9-_/]{1,39}$/.test(referenceId)) {
    e.referenceId = 'Use 2-40 letters, digits, - _ or /';
  }

  if (Number.isNaN(start)) e.bidStartAt = 'Bid start date & time is required';
  if (Number.isNaN(close)) e.bidCloseAt = 'Bid close date & time is required';
  else if (!Number.isNaN(start) && close <= start) e.bidCloseAt = 'Bid close must be after bid start';
  else if (close <= now) e.bidCloseAt = 'Bid close must be in the future';

  if (Number.isNaN(forced)) e.forcedCloseAt = 'Forced close date & time is required';
  else if (!Number.isNaN(close) && forced <= close) {
    e.forcedCloseAt = 'Forced close must be later than bid close';
  }

  if (!isDateOnly(body.pickupDate)) e.pickupDate = 'Pickup / service date is required';

  if (!Number.isInteger(X) || X < 1 || X > 24 * 60) e.triggerWindowMin = 'Trigger window (X) must be 1-1440 minutes';
  if (!Number.isInteger(Y) || Y < 1 || Y > 24 * 60) e.extensionMin = 'Extension (Y) must be 1-1440 minutes';
  if (!Object.values(TRIGGER_TYPES).includes(type)) e.triggerType = 'Pick an extension trigger';

  if (Object.keys(e).length) throw new ValidationError(e);
  return {
    name, referenceId, bidStartAt: start, bidCloseAt: close, forcedCloseAt: forced,
    pickupDate: body.pickupDate, triggerWindowMin: X, extensionMin: Y, triggerType: type,
  };
}

export function parseBidInput(body) {
  const e = {};
  const carrierName = String(body.carrierName ?? '').trim();
  const freight = toPaise(body.freightCharges);
  const origin = toPaise(body.originCharges);
  const destination = toPaise(body.destinationCharges);
  const transit = Number(body.transitTimeDays);

  if (!carrierName) e.carrierName = 'Carrier name is required';
  else if (carrierName.length > 80) e.carrierName = 'Keep the carrier name under 80 characters';
  if (Number.isNaN(freight)) e.freightCharges = 'Enter freight charges (0 or more)';
  if (Number.isNaN(origin)) e.originCharges = 'Enter origin charges (0 or more)';
  if (Number.isNaN(destination)) e.destinationCharges = 'Enter destination charges (0 or more)';
  if (!Number.isInteger(transit) || transit < 1 || transit > 365) e.transitTimeDays = 'Transit time must be 1-365 days';
  if (!isDateOnly(body.quoteValidityDate)) e.quoteValidityDate = 'Quote validity date is required';

  const total = freight + origin + destination;
  if (!Object.keys(e).length && total <= 0) e.freightCharges = 'Total quote must be more than zero';

  if (Object.keys(e).length) throw new ValidationError(e);
  return {
    carrierName, freightCharges: freight, originCharges: origin, destinationCharges: destination,
    totalAmount: total, transitTimeDays: transit, quoteValidityDate: body.quoteValidityDate,
  };
}
