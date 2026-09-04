// atoms.jsx — shared primitives for the Crew Roster. Exported to window.
const { fmtDate, credHealth } = window.MusterData;

// Monospaced inline value (IDs, phone, expiries).
function Mono({ children, className = '' }) {
  return <span className={'mono ' + className}>{children}</span>;
}

// Rating chip — captain / mate.
function RatingChip({ rating }) {
  return <span className={'chip chip-rating chip-' + rating}>{rating}</span>;
}

// Trainee marker (no rating yet).
function TraineeChip() {
  return <span className="chip chip-trainee">trainee · supernumerary</span>;
}

// Reliability standing — band pill (+ optional rank / score by display mode).
function Standing({ person, people, seat, display = 'band' }) {
  const band = window.MusterData.effectiveBand(person);
  const cls = band === 'New' ? 'new' : band.toLowerCase();
  const floored = person.manualThumb.kind === 'floor';
  let rankNode = null;
  if (display === 'rank' && seat) {
    const r = window.MusterData.poolRank(people, person, seat);
    rankNode = r ? <span className="standing-rank">#{r.rank}<span className="of">/{r.of}</span></span> : null;
  }
  let scoreNode = null;
  if (display === 'score' && person.reliability.history) {
    scoreNode = <span className="standing-rank">{Math.round(window.MusterData.effectiveScore(person))}</span>;
  }
  return (
    <span className="standing">
      <span className={'band band-' + cls}>
        {floored && <span className="band-pin" title="Pinned by Eric">▲</span>}
        {band}
      </span>
      {rankNode}
      {scoreNode}
    </span>
  );
}

// Credential-health flag — the at-a-glance pool-health signal.
const HEALTH_LABEL = { valid: 'Current', soon: 'Expiring', expired: 'Expired' };
function HealthFlag({ state, compact = false }) {
  if (state === 'valid' && compact) {
    return <span className="health-dot health-valid" title="Credentials current" />;
  }
  return (
    <span className={'flag flag-' + state}>
      <span className="flag-dot" />
      {HEALTH_LABEL[state]}
    </span>
  );
}

// Generic small button.
function Btn({ children, onClick, variant = 'ghost', size = 'm', type = 'button', disabled, title }) {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

// Labeled field row in the detail panel.
function Field({ label, children, hint }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

// Section header inside the detail panel.
function Section({ title, action, children }) {
  return (
    <section className="d-section">
      <div className="d-section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Modal shell.
function Modal({ title, children, onClose, footer, tone = 'default' }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={'modal modal-' + tone} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Credential row inside the detail panel.
function CredRow({ cred, onRemove }) {
  const h = credHealth(cred);
  const label = h.state === 'expired'
    ? `Expired ${Math.abs(h.days)}d ago`
    : h.state === 'soon'
      ? `Expires in ${h.days}d`
      : `Valid · ${h.days}d left`;
  return (
    <div className={'cred-row cred-' + h.state}>
      <div className="cred-type">{cred.type}</div>
      <div className="cred-id"><Mono>{cred.id || '—'}</Mono></div>
      <div className="cred-exp">
        <Mono>{fmtDate(cred.expiry)}</Mono>
        <span className={'cred-health cred-health-' + h.state}>{label}</span>
      </div>
      {onRemove && <button className="cred-x" onClick={onRemove} title="Remove credential">✕</button>}
    </div>
  );
}

Object.assign(window, {
  Mono, RatingChip, TraineeChip, Standing, HealthFlag, Btn, Field, Section, Modal, CredRow,
});
