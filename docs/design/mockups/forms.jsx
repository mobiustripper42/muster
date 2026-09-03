// forms.jsx — modal/inline editors used by the detail panel.
const { fmtDate, parseD } = window.MusterData;

// Add-crew modal. Minimal: name + phone + ratings (matches acceptance criterion).
function AddCrewModal({ onClose, onCreate }) {
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [ratings, setRatings] = React.useState([]);
  const valid = name.trim() && phone.trim();
  const toggle = (r) => setRatings((rs) => rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]);

  return (
    <window.Modal
      title="Add crew member"
      onClose={onClose}
      footer={
        <>
          <window.Btn onClick={onClose}>Cancel</window.Btn>
          <window.Btn variant="primary" disabled={!valid}
            onClick={() => onCreate({ name: name.trim(), phone: phone.trim(), email: email.trim(), ratings })}>
            Create crew member
          </window.Btn>
        </>
      }
    >
      <p className="modal-note">Eric creates crew records — crew don't self-register. A new member starts at neutral, “no history yet” standing so they get tried.</p>
      <div className="form-grid">
        <window.Field label="Name">
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" autoFocus />
        </window.Field>
        <window.Field label="Phone" hint="SMS / push target and magic-link destination">
          <input className="inp" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(206) 555-0000" />
        </window.Field>
        <window.Field label="Email" hint="Optional secondary">
          <input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@brewboat.co" />
        </window.Field>
        <window.Field label="Ratings" hint="Leave empty for a trainee on a supernumerary seat">
          <div className="seg">
            {['captain', 'mate'].map((r) => (
              <button key={r} className={'seg-b' + (ratings.includes(r) ? ' seg-on' : '')} onClick={() => toggle(r)}>{r}</button>
            ))}
          </div>
        </window.Field>
      </div>
    </window.Modal>
  );
}

// Inline add-credential form.
function AddCredForm({ onAdd, onCancel }) {
  const [type, setType] = React.useState('MMC');
  const [id, setId] = React.useState('');
  const [expiry, setExpiry] = React.useState('');
  return (
    <div className="inline-form">
      <select className="inp inp-sm" value={type} onChange={(e) => setType(e.target.value)}>
        <option>MMC</option>
        <option>Medical</option>
        <option>TWIC</option>
      </select>
      <input className="inp inp-sm" value={id} onChange={(e) => setId(e.target.value)} placeholder="Identifier (optional)" />
      <input className="inp inp-sm" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      <window.Btn variant="primary" size="s" disabled={!expiry} onClick={() => onAdd({ type, id: id.trim(), expiry })}>Add</window.Btn>
      <window.Btn size="s" onClick={onCancel}>Cancel</window.Btn>
    </div>
  );
}

// Inline add-PTO form.
function AddPtoForm({ onAdd, onCancel }) {
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [reason, setReason] = React.useState('');
  const valid = start && end && parseD(end) >= parseD(start);
  return (
    <div className="inline-form">
      <label className="mini-label">from</label>
      <input className="inp inp-sm" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      <label className="mini-label">to</label>
      <input className="inp inp-sm" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      <input className="inp inp-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
      <window.Btn variant="primary" size="s" disabled={!valid} onClick={() => onAdd({ start, end, reason: reason.trim() })}>Add</window.Btn>
      <window.Btn size="s" onClick={onCancel}>Cancel</window.Btn>
    </div>
  );
}

// Deactivation confirm — surfaces stranded future assignments, reopens seats.
function DeactivateModal({ person, onClose, onConfirm }) {
  const has = person.futureAssignments.length > 0;
  return (
    <window.Modal
      title={`Deactivate ${person.name}?`}
      tone={has ? 'warn' : 'default'}
      onClose={onClose}
      footer={
        <>
          <window.Btn onClick={onClose}>Cancel</window.Btn>
          <window.Btn variant="danger" onClick={onConfirm}>
            {has ? 'Deactivate & reopen seats' : 'Deactivate'}
          </window.Btn>
        </>
      }
    >
      <p className="modal-note">Inactive crew drop out of all future eligible pools. History is preserved — past shifts are untouched.</p>
      {has ? (
        <div className="strand">
          <div className="strand-head">{person.name} holds {person.futureAssignments.length} future {person.futureAssignments.length === 1 ? 'seat' : 'seats'}. Deactivating reopens {person.futureAssignments.length === 1 ? 'it' : 'them'}:</div>
          {person.futureAssignments.map((a) => (
            <div key={a.id} className="strand-row">
              <span className={'chip chip-rating chip-' + a.seat}>{a.seat}</span>
              <span className="strand-shift">{a.shift} · {a.label}</span>
              <span className="strand-reopen">→ seat reopens</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="modal-note muted">{person.name} holds no future seats — nothing to strand.</p>
      )}
    </window.Modal>
  );
}

Object.assign(window, { AddCrewModal, AddCredForm, AddPtoForm, DeactivateModal });
