// shiftboard.jsx — left pane: range bar, lock-weekend, shifts grouped boat→day.
const SB = window.ShiftData;
const { sBoat, sDateLabel, sDayLong, insideHorizon, sDaysOut, requiredSeats, superSeats, shiftPax } = SB;

function SeatPip({ seat }) {
  const cls = seat.state.toLowerCase().replace(/[^a-z]/g, '');
  const glyph = seat.role === 'captain' ? 'C' : seat.role === 'mate' ? 'M' : 'H';
  return <span className={'pip pip-' + cls} title={`${seat.role} · ${seat.state}`}>{glyph}</span>;
}

function ShiftCard({ sh, selected, onSelect }) {
  const boat = sBoat(sh.boatId);
  const st = sh.crewState.toLowerCase().replace(/[^a-z]/g, '');
  return (
    <button className={'scard' + (selected ? ' scard-sel' : '') + (sh.isNew ? ' scard-new' : '')} onClick={() => onSelect(sh.id)}>
      <div className="scard-top">
        <div className="scard-day">
          <span className="scard-dayname">{sDayLong(sh.date)}</span>
          <span className="scard-date">{sDateLabel(sh.date)}</span>
        </div>
        <div className="scard-badges">
          {sh.isNew && <span className="etag etag-new">new · review</span>}
          <span className={'shift-state ss-' + st}>{sh.crewState}</span>
          <span className={'lock' + (sh.locked ? ' lock-on' : '')} title={sh.locked ? 'Locked' : 'Unlocked'}>
            {sh.locked ? '🔒' : '🔓'}
          </span>
        </div>
      </div>

      <div className="scard-trips">
        {sh.trips.map((t, i) => (
          <span key={i} className="trip-chip">{t.label}<b>{t.pax}</b></span>
        ))}
        <span className="scard-pax">{shiftPax(sh)} pax</span>
      </div>

      <div className="scard-bot">
        <div className="scard-seats">
          {requiredSeats(sh).map((s) => <SeatPip key={s.id} seat={s} />)}
          {superSeats(sh).map((s) => <span key={s.id} className="pip pip-super" title="supernumerary">+</span>)}
          <span className="scard-seats-l">{requiredSeats(sh).length} required</span>
        </div>
        {sh.changedSinceReview && <span className="scard-nudge">⟳ changed since review</span>}
        {!sh.locked && insideHorizon(sh.date) && sh.crewState === 'Pending' && <span className="scard-hint">in horizon</span>}
      </div>
    </button>
  );
}

function ShiftBoard({ shifts, selectedId, onSelect, range, setRange, onLockWeekend }) {
  const R = SB.RANGES.find((r) => r.id === range);
  const inRange = shifts.filter((s) => R.test(s.date));
  // group by boat then day
  const byBoat = {};
  inRange.forEach((s) => { (byBoat[s.boatId] = byBoat[s.boatId] || []).push(s); });
  SB.S_BOATS.forEach((b) => { if (byBoat[b.id]) byBoat[b.id].sort((a, c) => a.date.localeCompare(c.date) || a.trips[0].time.localeCompare(c.trips[0].time)); });

  const unlocked = inRange.filter((s) => !s.locked).length;
  const needReview = inRange.filter((s) => s.changedSinceReview || s.isNew).length;

  return (
    <div className="board">
      <div className="board-top">
        <div className="range-row">
          <div className="range-pills">
            {SB.RANGES.map((r) => (
              <button key={r.id} className={'range-pill' + (range === r.id ? ' on' : '')} onClick={() => setRange(r.id)}>
                {r.label}{r.sub && <span className="range-sub">{r.sub}</span>}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" disabled={!unlocked} onClick={onLockWeekend}>
            🔒 Lock all{unlocked ? ` (${unlocked})` : ''}
          </button>
        </div>
        <div className="board-summary">
          <span><b>{inRange.length}</b> shifts</span>
          <span className="bs-sep" />
          <span>{unlocked} unlocked</span>
          {needReview > 0 && <span className="bs-review">{needReview} need review</span>}
          <span className="board-mode">build → review</span>
        </div>
      </div>

      <div className="board-scroll">
        {SB.S_BOATS.filter((b) => byBoat[b.id]).map((b) => (
          <div key={b.id} className="boat-group">
            <div className="boat-group-head">
              <span className="boat-dot" data-boat={b.id} />
              <span className="boat-group-name">{b.name}</span>
              <span className="boat-group-meta">COI {1}+{1} · max {b.coiMax} pax</span>
            </div>
            {byBoat[b.id].map((sh) => (
              <ShiftCard key={sh.id} sh={sh} selected={sh.id === selectedId} onSelect={onSelect} />
            ))}
          </div>
        ))}
        {inRange.length === 0 && <div className="board-empty">No shifts in this range.</div>}
      </div>
    </div>
  );
}

window.ShiftBoard = ShiftBoard;
