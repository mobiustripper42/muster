// riskmobile.jsx — At-Risk admin mobile: the 11pm call. Fully actionable triage.
const RMB = window.RiskData;
const { hoursToTrip, ttLabel, urgency } = RMB;

const KIND = {
  regression: { label: 'Regression · late bail', cls: 'rk-reg' },
  atrisk:     { label: 'At-Risk · exhausted', cls: 'rk-at' },
  credential: { label: 'Credential lapse', cls: 'rk-cr' },
};

function Trail({ t }) {
  const segs = [];
  if (t.asked) segs.push(`asked ${t.asked}`);
  if (t.declined) segs.push(`${t.declined} declined`);
  if (t.silent) segs.push(`${t.silent} silent`);
  if (t.widened) segs.push('widened');
  if (t.nudged && t.nudged.length) segs.push('nudged ' + t.nudged.join(', '));
  if (t.exhausted) segs.push('exhausted');
  if (!segs.length) segs.push('flagged by the oracle');
  return <div className="rm-trail"><span className="rm-trail-l">System tried</span> {segs.join(' · ')}</div>;
}

function RiskCard({ s, onAct }) {
  const h = hoursToTrip(s.tripISO);
  const k = KIND[s.kind];
  const tight = h < 36;
  const noLean = s.available.length === 0;
  return (
    <div className={'rm-card ' + k.cls}>
      <div className="rm-rail" />
      <div className="rm-cbody">
        <div className="rm-ctop">
          <span className={'rm-flag ' + k.cls}>{k.label}</span>
          <span className={'rm-tt' + (tight ? ' tight' : '')}>{ttLabel(h)}</span>
        </div>
        <div className="rm-where">
          <span className="boat-dot" data-boat={s.boatId} /><b>{s.boat}</b> · {s.dayLabel} · {s.trips.join(' + ')}
        </div>
        <div className="rm-missing">
          <span className="rm-miss-l">Missing</span>
          {s.missing.map((m, i) => (
            <span key={i} className="rm-miss"><span className={'role-ic sm role-' + m.role}>{m.role === 'captain' ? 'C' : 'M'}</span>1 {m.role}</span>
          ))}
          <span className="rm-fillsby">fills by {s.fillsBy}</span>
        </div>
        {s.lostCrew && <div className="rm-lost">↘ {s.lostCrew.name} {s.lostCrew.when}</div>}
        {s.credLapse && <div className="rm-lost">⊘ {s.credLapse.name}’s {s.credLapse.cred} {s.credLapse.detail}</div>}
        <Trail t={s.trail} />
        <div className="rm-avail">
          {noLean
            ? <span className="rm-avail-none">Nobody left in the pool — this is a reschedule / cancel call.</span>
            : <span><span className="rm-avail-l">Still available</span> {s.available.map((a) => a.name).join(', ')}</span>}
        </div>
        <div className="rm-acts">
          <button className="rm-act" disabled={noLean} onClick={() => onAct('lean', s)}>↗ Lean</button>
          <button className="rm-act" onClick={() => onAct('reschedule', s)}>↻ Reschedule</button>
          <button className="rm-act rm-act-danger" onClick={() => onAct('cancel', s)}>✕ Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---- bottom sheets ----
function Sheet({ title, onClose, children, footer, danger }) {
  return (
    <div className="rm-sheet-scrim" onClick={onClose}>
      <div className={'rm-sheet' + (danger ? ' danger' : '')} onClick={(e) => e.stopPropagation()}>
        <div className="rm-grip" />
        <h3>{title}</h3>
        {children}
        {footer && <div className="rm-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

function LeanSheet({ s, onClose, onDone }) {
  const [pick, setPick] = React.useState(s.available[0] ? s.available[0].name : null);
  return (
    <Sheet title="Lean on someone" onClose={onClose}
      footer={<><button className="rm-sb" onClick={onClose}>Cancel</button><button className="rm-sb rm-sb-primary" disabled={!pick} onClick={() => onDone(`↗ Direct nudge sent to ${pick}`)}>Send nudge</button></>}>
      <p className="rm-sheet-note">A personal Tier-2 ask — straight to one person, not a broadcast.</p>
      {s.available.map((a, i) => (
        <button key={i} className={'rm-pick' + (pick === a.name ? ' on' : '')} onClick={() => setPick(a.name)}>
          <span className="rm-pick-n">{a.name}</span>
          <span className={'rm-band rm-' + a.band.toLowerCase()}>{a.band}</span>
          <span className="rm-pick-note">{a.note}</span>
        </button>
      ))}
    </Sheet>
  );
}

function RescheduleSheet({ s, onClose, onDone }) {
  const slots = RMB.RESLOTS[s.id] || [];
  const first = slots.find((x) => x.crewable);
  const [pick, setPick] = React.useState(first ? first.label : null);
  const n = s.reservations.length;
  return (
    <Sheet title="Reschedule" onClose={onClose}
      footer={<><button className="rm-sb" onClick={onClose}>Cancel</button><button className="rm-sb rm-sb-primary" disabled={!pick} onClick={() => onDone(`↻ Moved to ${pick} · ${n} notified`)}>Move &amp; notify {n}</button></>}>
      <p className="rm-sheet-note">Move to a slot that can be crewed. Notifies every party on the shift.</p>
      {slots.map((sl, i) => (
        <button key={i} className={'rm-pick' + (pick === sl.label ? ' on' : '') + (sl.crewable ? '' : ' off')} disabled={!sl.crewable} onClick={() => sl.crewable && setPick(sl.label)}>
          <span className="rm-pick-n">{sl.label}</span>
          <span className={'rm-slot-tag ' + (sl.crewable ? 'ok' : 'no')}>{sl.crewable ? '✓ crewable' : '✕ no crew'}</span>
        </button>
      ))}
    </Sheet>
  );
}

function CancelSheet({ s, onClose, onDone }) {
  const [offer, setOffer] = React.useState(true);
  const n = s.reservations.length;
  const pax = s.reservations.reduce((a, r) => a + r.pax, 0);
  return (
    <Sheet title={`Cancel ${s.boat} · ${s.dayLabel}?`} danger onClose={onClose}
      footer={<><button className="rm-sb" onClick={onClose}>Keep shift</button><button className="rm-sb rm-sb-danger" onClick={() => onDone(`✕ Cascade run · ${n} refunded${offer ? ' + reschedule offered' : ''}`)}>Run cancel cascade</button></>}>
      <p className="rm-sheet-note">Not a delete — it cascades across every booking.</p>
      <div className="rm-casc">
        <div className="rm-cstep"><span className="rm-cn">1</span><div><b>Notify {n} {n === 1 ? 'party' : 'parties'}</b> ({pax} pax)</div></div>
        <div className="rm-cstep"><span className="rm-cn">2</span><div><b>Refund per policy</b><div className="rm-csub">{s.refund}</div></div></div>
        <div className="rm-cstep"><span className="rm-cn">3</span><label className="rm-ctoggle"><input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked)} /> offer a rebook link</label></div>
      </div>
      <div className="rm-cwarn">Sends real customer comms and moves money. Here’s exactly what happens before you commit.</div>
    </Sheet>
  );
}

function EmptySuccess({ cleared }) {
  return (
    <div className="rm-empty">
      <div className="rm-check">✓</div>
      <h2>Nothing needs you.</h2>
      <p>Every shift is crewed or still being worked by the automation. An empty board is the system doing its job.</p>
      {cleared > 0 && <div className="rm-cleared">{cleared} cleared this session</div>}
    </div>
  );
}

function RiskMobileApp() {
  const [shifts, setShifts] = React.useState(() => RMB.RISK_SHIFTS.map((s) => ({ ...s })));
  const [sheet, setSheet] = React.useState(null);
  const [cleared, setCleared] = React.useState(0);
  const [toast, setToast] = React.useState(null);
  const sorted = [...shifts].sort((a, b) => urgency(b) - urgency(a));
  const regr = shifts.filter((s) => s.kind === 'regression').length;

  const showToast = (m) => { setToast(m); clearTimeout(window.__rmt); window.__rmt = setTimeout(() => setToast(null), 3000); };
  const onAct = (type, s) => setSheet({ type, s });
  const done = (msg) => { const id = sheet.s.id; setShifts((ss) => ss.filter((x) => x.id !== id)); setCleared((c) => c + 1); setSheet(null); showToast(msg); };

  return (
    <window.IOSDevice>
      <div className="rm-app">
        <div className="rm-scroll">
          <header className="rm-head">
            <div className="rm-eyebrow">BrewBoat · Wed Jun 3, 8:00 AM</div>
            <div className="rm-h-row">
              <h1>Needs you</h1>
              {shifts.length > 0 && <span className="rm-count">{shifts.length}</span>}
            </div>
            <p className="rm-sub">{shifts.length === 0 ? 'Nothing the automation couldn’t close.' : `${shifts.length} ${shifts.length === 1 ? 'shift needs' : 'shifts need'} a call${regr ? ` · ${regr} regression` : ''}`}</p>
          </header>

          {shifts.length === 0
            ? <EmptySuccess cleared={cleared} />
            : <div className="rm-list">{sorted.map((s) => <RiskCard key={s.id} s={s} onAct={onAct} />)}</div>}

          <div className="rm-foot-note">The board pings you — you don’t monitor it. Deep work opens on the desktop assignment view.</div>
        </div>

        {sheet && sheet.type === 'lean' && <LeanSheet s={sheet.s} onClose={() => setSheet(null)} onDone={done} />}
        {sheet && sheet.type === 'reschedule' && <RescheduleSheet s={sheet.s} onClose={() => setSheet(null)} onDone={done} />}
        {sheet && sheet.type === 'cancel' && <CancelSheet s={sheet.s} onClose={() => setSheet(null)} onDone={done} />}
        {toast && <div className="rm-toast">{toast}</div>}
      </div>
    </window.IOSDevice>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<RiskMobileApp />);
