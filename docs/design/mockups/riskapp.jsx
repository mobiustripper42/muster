// riskapp.jsx — At-Risk Board shell: urgency sort, resolve→clear, empty=success.
const RA = window.RiskData;

function EmptySuccess({ resolvedCount }) {
  return (
    <div className="empty-success">
      <div className="es-mark">✓</div>
      <h2>Nothing needs you right now.</h2>
      <p>Every shift is crewed or still being worked by the automation. An empty board is the system doing its job — not a reminder to go check something.</p>
      {resolvedCount > 0 && <div className="es-resolved">{resolvedCount} {resolvedCount === 1 ? 'shift' : 'shifts'} cleared this session</div>}
      <div className="es-foot">Tiers 1–2 will ping you here only if a shift genuinely can’t be closed.</div>
    </div>
  );
}

function ResolvedTag({ how }) {
  const map = {
    leaned: 'Leaned — awaiting reply',
    rescheduled: 'Rescheduled · parties notified',
    cancelled: 'Cancelled · cascade run',
  };
  return <span className="resolved-tag">{map[how]}</span>;
}

function RiskApp() {
  const [shifts, setShifts] = React.useState(() => RA.RISK_SHIFTS.map((s) => ({ ...s })));
  const [modal, setModal] = React.useState(null); // {type, shift}
  const [resolved, setResolved] = React.useState([]); // {id, how, label}
  const [toast, setToast] = React.useState(null);

  const showToast = (m) => { setToast(m); clearTimeout(window.__rt); window.__rt = setTimeout(() => setToast(null), 3400); };
  const sorted = [...shifts].sort((a, b) => RA.urgency(b) - RA.urgency(a));

  const resolve = (s, how, msg) => {
    setShifts((ss) => ss.filter((x) => x.id !== s.id));
    setResolved((r) => [...r, { id: s.id, how, label: `${s.boat} · ${s.dayLabel}` }]);
    setModal(null);
    showToast(msg);
  };

  const onLean = (s) => setModal({ type: 'lean', shift: s });
  const onReschedule = (s) => setModal({ type: 'reschedule', shift: s });
  const onCancel = (s) => setModal({ type: 'cancel', shift: s });
  const onOpen = (s) => { window.location.href = 'Assignment View.html'; };

  const regressions = shifts.filter((s) => s.kind === 'regression').length;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Muster</span>
          <span className="brand-sep">/</span>
          <span className="brand-surface">At-Risk Board</span>
        </div>
        <nav className="surface-nav">
          <a href="Crew Roster.html">Crew Roster</a>
          <a href="Event Admin.html">Event Admin</a>
          <a href="Shift Builder.html">Shift Builder</a>
          <a href="Assignment View.html">Assignment</a>
          <span className="surface-nav-on">At-Risk</span>
        </nav>
        <div className="topbar-r">
          <span className="tenant">BrewBoat</span>
          <span className="today">Wed · Jun 3, 2026</span>
        </div>
      </header>

      <div className="board-wrap">
        <div className="board-hd">
          <div className="bh-l">
            <h1>Needs you</h1>
            <p className="bh-sub">Only shifts the automation couldn’t close land here. {shifts.length === 0 ? 'Right now, none do.' : 'Most-urgent first.'}</p>
          </div>
          <div className="bh-r">
            {shifts.length > 0 && (
              <div className="bh-count">
                <span className="bhc-n">{shifts.length}</span>
                <span className="bhc-l">{shifts.length === 1 ? 'shift' : 'shifts'} need a call</span>
                {regressions > 0 && <span className="bhc-reg">{regressions} regression</span>}
              </div>
            )}
          </div>
        </div>

        {shifts.length === 0
          ? <EmptySuccess resolvedCount={resolved.length} />
          : (
            <div className="risk-list">
              {sorted.map((s) => (
                <window.RiskRow key={s.id} s={s}
                  onLean={onLean} onReschedule={onReschedule} onCancel={onCancel} onOpen={onOpen} />
              ))}
            </div>
          )}

        {resolved.length > 0 && shifts.length > 0 && (
          <div className="resolved-strip">
            <span className="rs-label">Cleared this session</span>
            {resolved.map((r) => (
              <span key={r.id} className="rs-item">{r.label} <ResolvedTag how={r.how} /></span>
            ))}
          </div>
        )}
      </div>

      {modal && modal.type === 'lean' &&
        <window.RiskModals.LeanModal s={modal.shift} onClose={() => setModal(null)}
          onConfirm={(s, who) => resolve(s, 'leaned', `↗ Direct nudge sent to ${who} — leaning, not yet filled`)} />}
      {modal && modal.type === 'reschedule' &&
        <window.RiskModals.RescheduleModal s={modal.shift} onClose={() => setModal(null)}
          onConfirm={(s, slot) => resolve(s, 'rescheduled', `↻ Moved to ${slot} · ${s.reservations.length} ${s.reservations.length === 1 ? 'party' : 'parties'} notified`)} />}
      {modal && modal.type === 'cancel' &&
        <window.RiskModals.CancelModal s={modal.shift} onClose={() => setModal(null)}
          onConfirm={(s, opts) => resolve(s, 'cancelled', `✕ Cancel cascade run · ${s.reservations.length} ${s.reservations.length === 1 ? 'party' : 'parties'} refunded${opts.offerRe ? ' + reschedule offered' : ''}`)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<RiskApp />);
