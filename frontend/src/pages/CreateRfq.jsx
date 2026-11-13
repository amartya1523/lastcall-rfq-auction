import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, ApiError, TRIGGER_LABELS, fmtTime } from '../api.js';
import Field from '../components/Field.jsx';

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm"
const toLocalInput = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const roundUpMinute = (ms) => Math.ceil(ms / 60_000) * 60_000;

function defaults() {
  const start = roundUpMinute(Date.now());
  const pickup = new Date(start + 5 * 86_400_000).toISOString().slice(0, 10);
  return {
    name: '',
    referenceId: `RFQ-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 900 + 100)}`,
    bidStartAt: toLocalInput(start),
    bidCloseAt: toLocalInput(start + 60 * 60_000),
    forcedCloseAt: toLocalInput(start + 90 * 60_000),
    pickupDate: pickup,
    triggerWindowMin: 10,
    extensionMin: 5,
    triggerType: 'BID_RECEIVED',
  };
}

const TRIGGER_HELP = {
  BID_RECEIVED: 'Any new quote inside the window pushes the close time.',
  ANY_RANK_CHANGE: 'Only quotes that reshuffle the L1/L2/L3… order push the close time.',
  L1_CHANGE: 'Only a new lowest bidder pushes the close time.',
};

export default function CreateRfq() {
  const [form, setForm] = useState(defaults);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const navigate = useNavigate();

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  // Client-side mirror of the server rules so the user sees problems as they type.
  const live = useMemo(() => {
    const e = {};
    const s = Date.parse(form.bidStartAt);
    const c = Date.parse(form.bidCloseAt);
    const f = Date.parse(form.forcedCloseAt);
    if (c && s && c <= s) e.bidCloseAt = 'Bid close must be after bid start';
    if (f && c && f <= c) e.forcedCloseAt = 'Forced close must be later than bid close';
    return e;
  }, [form]);

  const preview = useMemo(() => {
    const c = Date.parse(form.bidCloseAt);
    const f = Date.parse(form.forcedCloseAt);
    const X = Number(form.triggerWindowMin);
    const Y = Number(form.extensionMin);
    if (!c || !f || f <= c || !X || !Y) return null;
    return { windowFrom: c - X * 60_000, close: c, extended: Math.min(c + Y * 60_000, f), forced: f, maxExt: Math.ceil((f - c) / (Y * 60_000)) };
  }, [form]);

  async function submit(e) {
    e.preventDefault();
    if (Object.keys(live).length) return setErrors(live);
    setSubmitting(true);
    setFormError(null);
    try {
      const rfq = await api.createRfq({
        ...form,
        bidStartAt: new Date(form.bidStartAt).toISOString(),
        bidCloseAt: new Date(form.bidCloseAt).toISOString(),
        forcedCloseAt: new Date(form.forcedCloseAt).toISOString(),
        triggerWindowMin: Number(form.triggerWindowMin),
        extensionMin: Number(form.extensionMin),
      });
      navigate(`/rfqs/${rfq.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(err.message === 'Validation failed' ? 'Please fix the highlighted fields.' : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const err = (k) => errors[k] || live[k];

  return (
    <section className="narrow">
      <Link to="/" className="back">← All auctions</Link>
      <header className="page-head">
        <div>
          <h1>Create RFQ</h1>
          <p className="sub">Request quotes from carriers and let them compete in a British auction.</p>
        </div>
      </header>

      <form className="card form" onSubmit={submit} noValidate>
        <h2>RFQ details</h2>
        <div className="grid-2">
          <Field label="RFQ name" error={err('name')}>
            <input value={form.name} onChange={set('name')} placeholder="e.g. Mumbai → Delhi, 32 ft MXL" />
          </Field>
          <Field label="Reference ID" error={err('referenceId')}>
            <input className="mono" value={form.referenceId} onChange={set('referenceId')} />
          </Field>
          <Field label="Bid start date & time" error={err('bidStartAt')}>
            <input type="datetime-local" value={form.bidStartAt} onChange={set('bidStartAt')} />
          </Field>
          <Field label="Bid close date & time" error={err('bidCloseAt')}>
            <input type="datetime-local" value={form.bidCloseAt} onChange={set('bidCloseAt')} />
          </Field>
          <Field label="Forced bid close date & time" hint="Hard stop. Extensions can never go past this." error={err('forcedCloseAt')}>
            <input type="datetime-local" value={form.forcedCloseAt} onChange={set('forcedCloseAt')} />
          </Field>
          <Field label="Pickup / service date" error={err('pickupDate')}>
            <input type="date" value={form.pickupDate} onChange={set('pickupDate')} />
          </Field>
        </div>

        <div className="divider" />
        <div className="row-between">
          <h2>British auction</h2>
          <span className="toggle-on">Enabled</span>
        </div>
        <div className="grid-2">
          <Field label="Trigger window (X minutes)" hint="How close to the close time we watch for activity." error={err('triggerWindowMin')}>
            <input type="number" min="1" value={form.triggerWindowMin} onChange={set('triggerWindowMin')} />
          </Field>
          <Field label="Extension duration (Y minutes)" hint="Time added each time the trigger fires." error={err('extensionMin')}>
            <input type="number" min="1" value={form.extensionMin} onChange={set('extensionMin')} />
          </Field>
        </div>
        <Field group label="Extension trigger" error={err('triggerType')}>
          <div className="radio-cards">
            {Object.entries(TRIGGER_LABELS).map(([k, label]) => (
              <label key={k} className={`radio-card ${form.triggerType === k ? 'on' : ''}`}>
                <input type="radio" name="triggerType" value={k} checked={form.triggerType === k} onChange={set('triggerType')} />
                <b>{label}</b>
                <span>{TRIGGER_HELP[k]}</span>
              </label>
            ))}
          </div>
        </Field>

        {preview && (
          <div className="preview">
            Bids between <b>{fmtTime(preview.windowFrom)}</b> and <b>{fmtTime(preview.close)}</b> that match the trigger move the
            close to <b>{fmtTime(preview.extended)}</b>. No matter what, bidding stops at <b>{fmtTime(preview.forced)}</b>
            {' '}(at most {preview.maxExt} extension{preview.maxExt === 1 ? '' : 's'} back to back).
          </div>
        )}

        {formError && <div className="alert">{formError}</div>}
        <div className="actions">
          <Link to="/" className="btn">Cancel</Link>
          <button className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create RFQ'}</button>
        </div>
      </form>
    </section>
  );
}
