// riskmodals.jsx — the three first-class decisions: Lean / Reschedule / Cancel-cascade.
const RM = window.RiskData;

function Modal({ title, tone, onClose, children, footer }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={'modal modal-' + (tone || 'default')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button className="modal-x" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// LEAN — direct nudge to a specific high-value person (manual Tier-2)
function LeanModal({ s, onClose, onConfirm }) {
  const [pick, setPick] = React.useState(s.available[0] ? s.available[0].name : null);
  const [msg, setMsg] = React.useState('Short one on the ' + s.dayLabel + ' ' + s.boat + ' — can you cover? I’d owe you one.');
  return (
    <Modal title="Lean on someone" tone="default" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!pick} onClick={() => onConfirm(s, pick)}>Send direct nudge</button></>}>
      <p className="modal-note">A personal, manual Tier-2 ask — not a broadcast. Goes straight to one person with a note from you.</p>
      <div className="lean-people">
        {s.available.map((a, i) => (
          <button key={i} className={'lean-person' + (pick === a.name ? ' on' : '')} onClick={() => setPick(a.name)}>
            <span className="lp-name">{a.name}</span>
            <span className={'ra-band ra-' + a.band.toLowerCase()}>{a.band}</span>
            <span className="lp-note">{a.note}</span>
          </button>
        ))}
      </div>
      <label className="modal-l">Message<textarea className="modal-ta" value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} /></label>
    </Modal>
  );
}

// RESCHEDULE — move to a slot that can be crewed; triggers customer comms
function RescheduleModal({ s, onClose, onConfirm }) {
  const slots = RM.RESLOTS[s.id] || [];
  const firstCrewable = slots.find((x) => x.crewable);
  const [pick, setPick] = React.useState(firstCrewable ? firstCrewable.label : null);
  return (
    <Modal title={`Reschedule · ${s.boat} ${s.dayLabel}`} tone="default" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!pick} onClick={() => onConfirm(s, pick)}>Move trip &amp; notify {s.reservations.length} {s.reservations.length === 1 ? 'party' : 'parties'}</button></>}>
      <p className="modal-note">Move the trip to a slot that can actually be crewed. This triggers customer-facing comms to every party on the shift.</p>
      <div className="reslots">
        {slots.map((sl, i) => (
          <button key={i} className={'reslot' + (pick === sl.label ? ' on' : '') + (sl.crewable ? '' : ' reslot-no')}
            disabled={!sl.crewable} onClick={() => sl.crewable && setPick(sl.label)}>
            <span className="reslot-l">{sl.label}</span>
            <span className={'reslot-tag ' + (sl.crewable ? 'rt-ok' : 'rt-no')}>{sl.crewable ? '✓ crewable' : '✕ ' + sl.note}</span>
            {sl.crewable && <span className="reslot-note">{sl.note}</span>}
          </button>
        ))}
      </div>
      <div className="comms-note">↳ {s.reservations.length} {s.reservations.length === 1 ? 'party' : 'parties'} will get a reschedule notice with the new time.</div>
    </Modal>
  );
}

// CANCEL — the cascade. Never a silent delete: customer comms + refunds per policy.
function CancelModal({ s, onClose, onConfirm }) {
  const [offerRe, setOfferRe] = React.useState(true);
  const totalPax = s.reservations.reduce((a, r) => a + r.pax, 0);
  return (
    <Modal title={`Cancel ${s.boat} · ${s.dayLabel}?`} tone="danger" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Keep the shift</button>
        <button className="btn btn-danger" onClick={() => onConfirm(s, { offerRe })}>Run cancel cascade</button></>}>
      <p className="modal-note">Cancel is not a delete. It cascades across every booking on this shift — notifications, refunds per policy, and an optional reschedule offer.</p>
      <div className="cascade">
        <div className="cascade-step">
          <span className="cs-n">1</span>
          <div><b>Notify {s.reservations.length} {s.reservations.length === 1 ? 'party' : 'parties'}</b> ({totalPax} pax)
            <div className="cs-list">{s.reservations.map((r, i) => <span key={i} className="cs-cust">{r.customer} <i>×{r.pax}</i></span>)}</div>
          </div>
        </div>
        <div className="cascade-step">
          <span className="cs-n">2</span>
          <div><b>Refund per policy</b><div className="cs-sub">{s.refund} → {s.reservations.length} {s.reservations.length === 1 ? 'booking' : 'bookings'} processed</div></div>
        </div>
        <div className="cascade-step">
          <span className="cs-n">3</span>
          <div><b>Offer reschedule</b>
            <label className="cs-toggle"><input type="checkbox" checked={offerRe} onChange={(e) => setOfferRe(e.target.checked)} /> include a “rebook another day” link in the notice</label>
          </div>
        </div>
      </div>
      <div className="cancel-warn">This sends real customer comms and moves money. It’s the call that keeps you up at night — so here’s exactly what happens before you commit.</div>
    </Modal>
  );
}

window.RiskModals = { LeanModal, RescheduleModal, CancelModal };
