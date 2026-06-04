// shiftdetail.jsx — right pane: trips, derived seats, overrides, split/merge, lock.
const SD = window.ShiftData;
const { sBoat, sDateLabel, sDayLong, insideHorizon, sDaysOut, requiredSeats, superSeats,
        gateMet, shiftPax, effMaxPax } = SD;

const seatStateClass = (s) => 'st-' + s.toLowerCase().replace(/[^a-z]/g, '');

function SeatRow({ seat, onRemove }) {
  const kindLabel = seat.kind === 'required' ? 'COI required'
    : seat.kind === 'hand' ? 'added working hand · gates Crewed'
    : 'supernumerary · non-gating';
  return (
    <div className={'seatrow' + (seat.kind === 'super' ? ' seatrow-super' : '')}>
      <div className="seatrow-role">
        <span className={'role-ic role-' + (seat.kind === 'super' ? 'super' : seat.role)}>{seat.role === 'captain' ? 'C' : seat.role === 'mate' ? 'M' : seat.kind === 'super' ? '+' : 'H'}</span>
        <div>
          <div className="seatrow-name">{seat.kind === 'super' ? 'Supernumerary' : seat.kind === 'hand' ? 'Working hand' : seat.role}</div>
          <div className="seatrow-kind">{kindLabel}</div>
        </div>
      </div>
      <div className="seatrow-fill">
        {seat.who ? <span className="seatrow-who">{seat.who}</span> : <span className="seatrow-empty">unfilled</span>}
        {seat.reopened && <span className="seatrow-reopened">↻ {seat.reopened}</span>}
        <span className={'seat-state ' + seatStateClass(seat.state)}>{seat.state}</span>
        {onRemove && <button className="seatrow-x" onClick={onRemove} title="Remove seat">✕</button>}
      </div>
    </div>
  );
}

function SplitPanel({ sh, onSplit, onCancel }) {
  // default: earliest trip in A, rest in B
  const [assign, setAssign] = React.useState(() => sh.trips.map((t, i) => i === 0 ? 'A' : 'B'));
  const aCount = assign.filter((x) => x === 'A').length;
  const bCount = assign.filter((x) => x === 'B').length;
  const ok = aCount > 0 && bCount > 0;
  return (
    <div className="split-panel">
      <div className="split-h">Assign each trip to a shift — they must partition (both sides non-empty).</div>
      {sh.trips.map((t, i) => (
        <div key={i} className="split-trip">
          <span className="split-trip-l">{t.label} · {t.pax} pax</span>
          <div className="seg seg-sm">
            {['A', 'B'].map((g) => (
              <button key={g} className={'seg-b' + (assign[i] === g ? ' seg-on' : '')}
                onClick={() => setAssign((a) => a.map((x, j) => j === i ? g : x))}>Shift {g}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="split-actions">
        <button className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-s" disabled={!ok} onClick={() => onSplit(sh.id, assign)}>Split into 2 shifts</button>
      </div>
    </div>
  );
}

function ShiftDetail(props) {
  const { sh, sibling, update, onLock, onAddHand, onAddSuper, onRemoveSeat, onSplit, onMerge } = props;
  const [splitting, setSplitting] = React.useState(false);
  const boat = sBoat(sh.boatId);
  const st = sh.crewState.toLowerCase().replace(/[^a-z]/g, '');
  const inHorizon = insideHorizon(sh.date);
  const req = requiredSeats(sh);
  const sup = superSeats(sh);
  const met = gateMet(sh);

  return (
    <div className="sdetail">
      <div className="sd-head">
        <div>
          <div className="sd-eyebrow">
            <span className="boat-dot lg" data-boat={sh.boatId} />
            {boat.name} · {sDateLabel(sh.date)}
          </div>
          <h2>{sDayLong(sh.date)} shift</h2>
          <div className="sd-sub">{sh.trips.length} {sh.trips.length === 1 ? 'trip' : 'trips'} · {shiftPax(sh)} pax · {sDaysOut(sh.date)}d out</div>
        </div>
        <span className={'shift-state lg ss-' + st}>{sh.crewState}</span>
      </div>

      <div className="sd-scroll">
        {/* Nudges */}
        {sh.changedSinceReview && (
          <div className="sd-nudge">
            <span className="sd-nudge-i">⟳</span>
            <div><b>Changed since you reviewed it.</b> {sh.changeNote || 'A booking changed after this shift was locked.'} It joined automatically — review and re-lock so nothing surprises you at the dock.</div>
          </div>
        )}
        {sh.isNew && (
          <div className="sd-nudge sd-nudge-new">
            <span className="sd-nudge-i">✦</span>
            <div><b>Freshly proposed.</b> A late booking landed on a boat/day with no shift, so the system spawned this one. Review and lock to start crewing.</div>
          </div>
        )}

        {/* Trips */}
        <section className="sd-section">
          <h3>Trips batched into this shift</h3>
          <div className="trips-list">
            {sh.trips.map((t, i) => (
              <div key={i} className="trip-row">
                <span className="trip-time">{t.label}</span>
                <span className="trip-pax"><b>{t.pax}</b> / {effMaxPax(sh)} pax</span>
                <span className="trip-res">{t.res} {t.res === 1 ? 'reservation' : 'reservations'}</span>
                {t.note && <span className="trip-note">{t.note}</span>}
              </div>
            ))}
          </div>
          {sup.length > 0 && (
            <div className="pax-note">COI max pax {boat.coiMax} → <b>{effMaxPax(sh)}</b> — {sup.length} supernumerary {sup.length === 1 ? 'seat consumes' : 'seats consume'} a passenger slot.</div>
          )}
        </section>

        {/* Seats */}
        <section className="sd-section">
          <div className="sd-section-head">
            <h3>Seats</h3>
            <span className={'gate' + (met ? ' gate-ok' : '')}>
              {met ? '✓ Crewed gate met' : `Crewed when ${req.map((s) => s.role).join(' + ')} confirmed`}
            </span>
          </div>
          <div className="seats">
            {req.map((s) => (
              <SeatRow key={s.id} seat={s} onRemove={s.kind === 'hand' ? () => onRemoveSeat(sh.id, s.id) : null} />
            ))}
            {sup.map((s) => (
              <SeatRow key={s.id} seat={s} onRemove={() => onRemoveSeat(sh.id, s.id)} />
            ))}
          </div>
          <div className="seat-overrides">
            <button className="btn btn-s" onClick={() => onAddHand(sh.id)}>+ Required working hand</button>
            <button className="btn btn-s" onClick={() => onAddSuper(sh.id)}>+ Supernumerary / trainee</button>
          </div>
          <div className="seat-foot">Required seats are derived from the vessel COI ({boat.name}: 1 captain + 1 mate) — not hand-entered. A working hand gates <i>Crewed</i>; a supernumerary seat doesn't, and consumes one passenger slot.</div>
        </section>

        {/* Structure: split / merge */}
        <section className="sd-section">
          <h3>Shift structure</h3>
          {!splitting ? (
            <div className="struct-actions">
              <button className="btn btn-s" disabled={sh.trips.length < 2} onClick={() => setSplitting(true)} title={sh.trips.length < 2 ? 'Needs 2+ trips to split' : 'Split this shift'}>Split shift…</button>
              {sibling && <button className="btn btn-s" onClick={() => onMerge(sh.id, sibling.id)}>Merge with {sDayLong(sibling.date)} ({sibling.trips.length} trips)</button>}
            </div>
          ) : (
            <SplitPanel sh={sh} onCancel={() => setSplitting(false)} onSplit={(id, a) => { onSplit(id, a); setSplitting(false); }} />
          )}
          <div className="seat-foot">Default is one boat, one day. Split when the morning charter wants different crew than the afternoon trips; merge is the inverse.</div>
        </section>
      </div>

      {/* Lock bar */}
      <div className="sd-lockbar">
        <div className="lockbar-info">
          {sh.locked
            ? <><b>Locked</b> · reviewed — crewing may proceed{sh.changedSinceReview ? ' (re-lock to clear the change nudge)' : ''}</>
            : inHorizon
              ? <><b>Unlocked</b> · inside the {SD.HORIZON_DAYS}-day staffing horizon — locking fires Tier-1 asks now</>
              : <><b>Unlocked</b> · outside horizon — locking reviews it; asks fire closer to the date</>}
        </div>
        <button className={'btn ' + (sh.locked ? '' : 'btn-primary')} onClick={() => onLock(sh.id)}>
          {sh.locked ? '🔓 Unlock' : '🔒 Lock shift'}
        </button>
      </div>
    </div>
  );
}

window.ShiftDetail = ShiftDetail;
