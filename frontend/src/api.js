export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status})`, res.status, body.fields);
  return body;
}

export const api = {
  listRfqs: () => request('/rfqs'),
  getRfq: (id) => request(`/rfqs/${id}`),
  createRfq: (data) => request('/rfqs', { method: 'POST', body: JSON.stringify(data) }),
  submitBid: (id, data) => request(`/rfqs/${id}/bids`, { method: 'POST', body: JSON.stringify(data) }),
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (paise) => (paise == null ? '—' : inr.format(paise / 100));

const dtFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
});
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export const fmtDateTime = (ms) => dtFmt.format(new Date(ms));
export const fmtTime = (ms) => timeFmt.format(new Date(ms));
export const fmtDate = (isoDate) => dateFmt.format(new Date(`${isoDate}T00:00:00`));

export function fmtDuration(ms) {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const TRIGGER_LABELS = {
  BID_RECEIVED: 'Bid received in last X min',
  ANY_RANK_CHANGE: 'Any supplier rank change in last X min',
  L1_CHANGE: 'Lowest bidder (L1) change in last X min',
};

export const STATUS_LABELS = {
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  FORCE_CLOSED: 'Force Closed',
};
