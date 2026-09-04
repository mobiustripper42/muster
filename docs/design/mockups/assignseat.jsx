// assignseat.jsx — seat card (renders by sub-state) + eligible pool + override.
const AD = window.AssignData;
const { CREW, effScore } = AD;

const BandDot = ({ who }) => {
  const c = CREW[who]; const b = c.band.toLowerCase();
  return <span className={'rel rel-' + b} title={`${c.band} · ${c.score}`}><i />{c.band}</span>;
};

// ask-status label/treatment for a pool candidate. silent is first-class + distinct.
const ASK = {
  available: { label: 'available', cls: 'ask-available' },
  asked:     { label: 'asked', cls: 'ask-asked' },
  in:        { label: 'in', cls: 'ask-in' },
  declined:  { label: 'declined', cls: 'ask-declined' },
  silent:    { label: 'silent', cls: 'ask-silent' },
};

function CandidateRow({ cand, seat, showScore, onAssign, onNudge }) {
  const c = CREW[cand.who];
  const a = ASK[cand.askState];
  const sub = cand.askState === 'in' ? `replied in ${cand.replyMins}m`
    : cand.askState === 'asked' ? 'awaiting reply'
    : cand.askState === 'silent' ? 'no reply — timed out'
    : cand.askState === 'declined' ? 'declined' : 'not yet asked';
  return (
    <div className={'cand ' + (cand.askState === 'silent' ? 'cand-silent' : '')}>
      <div className="cand-l">
        <span className="cand-name">{c.name}</span>
        <BandDot who={cand.who} />
        {showScore && <span className="cand-score mono">{c.score}</span>}
        {c.boosted && <span className="cand-flag" title="Boosted by Eric">▲</span>}
        {c.floor && <span className="cand-flag" title="Floored High by Eric">⚓</span>}
      </div>
      <div className="cand-r">
        <span className={'ask ' + a.cls}>
          {cand.askState === 'silent' && <span className="ghost">👻</span>}
          {a.label}
        </span>
        <span className="cand-sub">{sub}</span>
        <div className="cand-acts">
          {(cand.askState === 'in') && <button className="mini-btn mini-go" onClick={() => onAssign(seat.id, cand.who)}>Confirm</button>}
          {(cand.askState === 'asked' || cand.askState === 'silent') && <button className="mini-btn" onClick={() => onNudge(cand.who)}>Nudge</button>}
          {(cand.askState === 'available') && <button className="mini-btn" onClick={() => onAssign(seat.id, cand.who, true)}>Assign</button>}
          {(cand.askState === 'declined') && <span className="cand-out">—</span>}
        </div>
      </div>
    </div>
  );
}

function OverrideMenu({ onPick, onClose }) {
  const all = Object.keys(CREW);
  return (
    <div className="ovr" onClick={onClose}>
      <div className="ovr-box" onClick={(e) => e.stopPropagation()}>
        <div className="ovr-head">Manual override — place anyone <span>you are the authority; backstop only</span></div>
        <div className="ovr-list">
          {all.map((id) => (
            <button key={id} className="ovr-row" onClick={() => onPick(id)}>
              <span>{CREW[id].name}</span>
              <BandDot who={id} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SeatCard({ seat, showScore, onBroadcast, onAssign, onConfirm, onNudge, onWiden, onOverride, onBail }) {
  const [poolOpen, setPoolOpen] = React.useState(seat.state === 'Open' || seat.state === 'Asked');
  const [ovr, setOvr] = React.useState(false);
  const occ = seat.who ? CREW[seat.who] : null;
  const st = seat.state.toLowerCase();

  const pool = [...seat.pool].sort((a, b) => effScore(CREW[b.who]) - effScore(CREW[a.who]));
  const inCount = pool.filter((p) => p.askState === 'in').length;
  const declined = pool.filter((p) => p.askState === 'declined').length;
  const silent = pool.filter((p) => p.askState === 'silent').length;
  const asked = pool.filter((p) => p.askState === 'asked').length;

  return (
    <div className={'seat seat-' + st}>
      <div className="seat-head">
        <div className="seat-id">
          <span className={'role-ic role-' + seat.role}>{seat.role === 'captain' ? 'C' : 'M'}</span>
          <div>
            <div className="seat-role">{seat.role}<span className="seat-req">required</span></div>
            <div className="seat-proto">{seat.protocol === 'assign-then-confirm' ? 'assign → confirm' : 'ask → assign'}</div>
          </div>
        </div>
        <span className={'seat-badge sb-' + st}>{seat.state}</span>
      </div>

      {/* Occupant zone by sub-state */}
      {seat.state === 'Confirmed' && occ && (
        <div className="seat-occ seat-occ-ok">
          <div className="occ-l"><span className="occ-name">{occ.name}</span><BandDot who={seat.who} />{showScore && <span className="mono cand-score">{occ.score}</span>}</div>
          <div className="occ-r">
            <button className="mini-btn">✆ Call</button>
            <button className="mini-btn">✉ Text</button>
            <button className="mini-btn mini-warn" onClick={() => onBail(seat.id)} title="Crew reports they can't make it">Reports a bail…</button>
          </div>
        </div>
      )}
      {seat.state === 'Claimed' && occ && (
        <div className="seat-occ seat-occ-claim">
          <div className="occ-l"><span className="occ-name">{occ.name}</span><BandDot who={seat.who} /><span className="occ-tag">accepted · awaiting your confirm</span></div>
          <button className="mini-btn mini-go" onClick={() => onConfirm(seat.id)}>Confirm into seat</button>
        </div>
      )}
      {seat.state === 'Asked' && occ && (
        <div className="seat-occ seat-occ-asked">
          <div className="occ-l"><span className="occ-name">{occ.name}</span><BandDot who={seat.who} /><span className="occ-tag">named · awaiting their reply</span></div>
          <div className="occ-r">
            <button className="mini-btn" onClick={() => onNudge(seat.who)}>Nudge</button>
            <button className="mini-btn mini-go" onClick={() => onAssign(seat.id, seat.who)}>They accepted →</button>
          </div>
        </div>
      )}
      {seat.state === 'Bailed' && (
        <div className="seat-occ seat-occ-bail">
          <span className="bail-x">✕</span>
          <div><b>{occ ? occ.name : 'Crew'} bailed.</b> Seat auto-reopened — re-asking the next ranked candidate…</div>
        </div>
      )}

      {/* Pool summary line */}
      {(seat.state === 'Open' || seat.state === 'Asked') && (
        <div className="seat-poolbar">
          <button className="poolbar-toggle" onClick={() => setPoolOpen((v) => !v)}>
            {poolOpen ? '▾' : '▸'} Eligible pool · {pool.length}
          </button>
          <div className="poolbar-stats">
            {asked > 0 && <span className="pst pst-asked">{asked} asked</span>}
            {inCount > 0 && <span className="pst pst-in">{inCount} in</span>}
            {declined > 0 && <span className="pst pst-declined">{declined} declined</span>}
            {silent > 0 && <span className="pst pst-silent">{silent} silent</span>}
          </div>
        </div>
      )}

      {/* Eligible pool */}
      {poolOpen && (seat.state === 'Open' || seat.state === 'Asked') && (
        <div className="pool">
          {pool.map((cand) => (
            <CandidateRow key={cand.who} cand={cand} seat={seat} showScore={showScore} onAssign={onAssign} onNudge={onNudge} />
          ))}
          {seat.excluded && seat.excluded.length > 0 && (
            <div className="excl">
              <div className="excl-h">Not eligible — held out by the oracle</div>
              {seat.excluded.map((e) => (
                <div key={e.who} className="excl-row"><span>{CREW[e.who].name}</span><span className="excl-why">⊘ {e.reason}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action bar — controls on demand */}
      <div className="seat-actions">
        {seat.state === 'Open' && seat.protocol === 'ask-then-assign' &&
          <button className="btn btn-primary btn-s" onClick={() => onBroadcast(seat.id)}>📣 Broadcast ask to pool</button>}
        {(seat.state === 'Open' || seat.state === 'Asked') &&
          <button className="btn btn-s" onClick={() => onWiden(seat.id)}>Widen / re-ask</button>}
        <button className="btn btn-s" onClick={() => setOvr(true)}>Manual override…</button>
      </div>

      {ovr && <OverrideMenu onClose={() => setOvr(false)} onPick={(id) => { setOvr(false); onOverride(seat.id, id); }} />}
    </div>
  );
}

window.SeatCard = SeatCard;
