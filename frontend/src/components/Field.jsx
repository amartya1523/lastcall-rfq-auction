export default function Field({ label, hint, error, group = false, children }) {
  // Radio groups contain their own <label>s, and labels cannot nest.
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={`field ${error ? 'has-error' : ''}`} role={group ? 'group' : undefined}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="error">{error}</span> : hint && <span className="hint">{hint}</span>}
    </Tag>
  );
}
