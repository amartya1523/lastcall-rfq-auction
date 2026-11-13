import { useState } from 'react';
import { api, ApiError, money } from '../api.js';
import Field from './Field.jsx';

const blank = () => ({
  carrierName: (() => { try { return localStorage.getItem('lastcall.carrier') || ''; } catch { return ''; } })(),
  freightCharges: '',
  originCharges: '',
  destinationCharges: '',
  transitTimeDays: '',
  quoteValidityDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
});

/** Supplier-side quote submission. Totals are computed live so carriers see what they are bidding. */
export default function QuoteForm({ rfq, disabled, onSubmitted }) {
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
    setMsg(null); // a fresh edit means the last result no longer applies
  };
  const rupees = (v) => (v === '' ? 0 : Number(v) || 0);
  const total = rupees(form.freightCharges) + rupees(form.originCharges) + rupees(form.destinationCharges);
  const mine = rfq.ranking.find((b) => b.carrierName.toLowerCase() === form.carrierName.trim().toLowerCase());

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.submitBid(rfq.id, { ...form, transitTimeDays: Number(form.transitTimeDays) });
      try { localStorage.setItem('lastcall.carrier', form.carrierName.trim()); } catch { /* private mode */ }
      setMsg({
        ok: true,
        text: `Quote accepted. ${form.carrierName.trim()} is now L${res.rank}.${res.extension ? ' Auction extended!' : ''}`,
      });
      setForm((f) => ({ ...f, freightCharges: '', originCharges: '', destinationCharges: '' }));
      onSubmitted?.(res.rfq);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      setMsg({ ok: false, text: err.message === 'Validation failed' ? 'Please fix the highlighted fields.' : err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form quote" onSubmit={submit} noValidate>
      <div className="row-between">
        <h2>Submit a quote</h2>
        <span className="muted small">Supplier view</span>
      </div>
      <fieldset disabled={disabled || busy}>
        <Field label="Carrier name" error={errors.carrierName}
          hint={mine ? `Your current quote: ${money(mine.totalAmount)} (${mine.label}). Beat it to rebid.` : 'New carriers join the ranking with their first quote.'}>
          <input value={form.carrierName} onChange={set('carrierName')} placeholder="e.g. Blue Dart Surface" />
        </Field>
        <div className="grid-3">
          <Field label="Freight (₹)" error={errors.freightCharges}>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.freightCharges} onChange={set('freightCharges')} />
          </Field>
          <Field label="Origin (₹)" error={errors.originCharges}>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.originCharges} onChange={set('originCharges')} />
          </Field>
          <Field label="Destination (₹)" error={errors.destinationCharges}>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.destinationCharges} onChange={set('destinationCharges')} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Transit time (days)" error={errors.transitTimeDays}>
            <input type="number" min="1" value={form.transitTimeDays} onChange={set('transitTimeDays')} />
          </Field>
          <Field label="Quote valid until" error={errors.quoteValidityDate}>
            <input type="date" value={form.quoteValidityDate} onChange={set('quoteValidityDate')} />
          </Field>
        </div>
        <div className="quote-total">
          <span>Total quote</span>
          <b>{money(Math.round(total * 100))}</b>
        </div>
        {msg && <div className={msg.ok ? 'notice' : 'alert'}>{msg.text}</div>}
        <button className="btn btn-primary block" disabled={disabled || busy}>
          {disabled ? 'Bidding is closed' : busy ? 'Submitting…' : 'Place bid'}
        </button>
      </fieldset>
    </form>
  );
}
