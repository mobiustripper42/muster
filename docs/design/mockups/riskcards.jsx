// riskcards.jsx — triage row: missing, time-to-trip, escalation trail, available, actions.
const RC = window.RiskData;
const { hoursToTrip, ttLabel } = RC;

const KIND = {
  regression: { label: 'Regression · late bail', cls: 'k-regression' },
  atrisk:     { label: 'At-Risk · pool exhausted', cls: 'k-atrisk' },
  credential: { label: 'Credential lapse', cls: 'k-credential' },
};

function MissingChips({ missing }) {
  return (
    <span className="missing">
      {missing.map((m, i) => (
        <span key={i} className={'miss-chip miss-' + m.role}>
          <span className={'role-ic sm role-' + m.role}>{m.role === 'captain' ? 'C' : 'M'}</span>
          1 {m.role}
        </span>
      ))}
    </span>
  );
}

// "asked 5 · 3 declined · 1 silent · widened · nudged Hank · exhausted"
function EscalationTrail({ trail }) {
  const parts = [];
  if (trail.asked) parts.push(<span key="a" className="tr-seg">asked <b>{trail.asked}</b></span>);
  if (trail.declined) parts.push(<span key="d" className="tr-seg tr-mut">{trail.declined} declined</span>);
  if (trail.silent) parts.push(<span key="s" className="tr-seg tr-bad">{trail.silent} silent</span>);
  if (trail.widened) parts.push(<span key="w" className="tr-seg">pool widened</span>);
  if (trail.nudged && trail.nudged.length) parts.push(<span key="n" className="tr-seg">nudged {trail.nudged.join(', ')}</span>);
  if (trail.exhausted) parts.push(<span key="e" className="tr-seg tr-exhaust">exhausted</span>);
  if (!parts.length) parts.push(<span key="z" className="tr-seg tr-mut">not yet worked — flagged by the oracle</span>);
  return (
    <div className="trail">
      <span className="trail-label">System tried</span>
      <div className="trail-segs">{parts.reduce((acc, p, i) => i ? [...acc, <span key={'sep' + i} className="tr-dot">·</span>, p] : [p], [])}</div>
    </div>
  );
}

function RiskRow({ s, onLean, onReschedule, onCancel, onOpen }) {
  const h = hoursToTrip(s.tripISO);
  const k = KIND[s.kind];
  const tight = h < 36;
  return (
    <div className={'risk ' + k.cls}>
      <div className="risk-rail" />
      <div className="risk-body">
        <div className="risk-top">
          <div className="risk-id">
            <span className={'kind-flag ' + k.cls}>{k.label}</span>
            <div className="risk-where">
              <span className="boat-dot" data-boat={s.boatId} />
              <b>{s.boat}</b> · {s.dayLabel} · {s.trips.join(' + ')}
            </div>
          </div>
          <div className="risk-time">
            <span className={'tt' + (tight ? ' tt-tight' : '')}>{ttLabel(h)}</span>
            <span className="tt-sub">fills by {s.fillsBy}</span>
          </div>
        </div>

        <div className="risk-mid">
          <div className="risk-missing">
            <span className="rm-label">Missing</span>
            <MissingChips missing={s.missing} />
            {s.lostCrew && <span className="lost">↘ {s.lostCrew.name} {s.lostCrew.when}</span>}
            {s.credLapse && <span className="lost">⊘ {s.credLapse.name}’s {s.credLapse.cred} {s.credLapse.detail}</span>}
          </div>
        </div>

        <EscalationTrail trail={s.trail} />
        {s.trail.note && <div className="trail-note">{s.trail.note}</div>}

        <div className="risk-avail">
          <span className="ra-label">Still available</span>
          {s.available.length === 0
            ? <span className="ra-none">nobody left in the eligible pool — manual lean won’t help; this is a reschedule / cancel call</span>
            : s.available.map((a, i) => (
                <span key={i} className="ra-person">{a.name}<span className={'ra-band ra-' + a.band.toLowerCase()}>{a.band}</span><em>{a.note}</em></span>
              ))}
        </div>

        <div className="risk-actions">
          <div className="ra-decisions">
            <button className="btn btn-s" disabled={s.available.length === 0} onClick={() => onLean(s)} title={s.available.length === 0 ? 'No one left to lean on' : 'Direct nudge — “I need you on this”'}>↗ Lean</button>
            <button className="btn btn-s" onClick={() => onReschedule(s)}>↻ Reschedule</button>
            <button className="btn btn-s btn-danger-ghost" onClick={() => onCancel(s)}>✕ Cancel…</button>
          </div>
          <button className="open-assign" onClick={() => onOpen(s)}>Open in Assignment ↗</button>
        </div>
      </div>
    </div>
  );
}

window.RiskRow = RiskRow;
