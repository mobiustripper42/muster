// assignmobile.jsx — Assignment admin mobile: monitor-first, light driving.
const AMB = window.AssignData;
const { CREW, FILLS_BY, effScore } = AMB;

function shiftState(seats) {
  if (seats.some((s) => s.state === 'Bailed')) return 'At-Risk';
  if (seats.every((s) => s.state === 'Confirmed')) return 'Crewed';
  return 'Filling';
}

const ASK = { available: 'available', asked: 'asked', in: 'in', declined: 'declined', silent: 'silent' };

function Band({ who }) { const c = CREW[who]; return <span className={'am-band am-' + c.band.toLowerCase()}>{c.band}</span>; }

function PoolSheet({ seat, onClose, onAssign }) {
  const pool = [...seat.pool].sort((a, b) => effScore(CREW[b.who]) - effScore(CREW[a.who]));
  return (
    <div className="am-sheet-scrim" onClick={onClose}>
      <div className="am-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="am-grip" />
        <h3>{seat.role} pool</h3>
        <p className="am-sheet-note">Only legally-fillable people, ranked by reliability. Silence is shown distinctly.</p>
        {pool.map((p) => {
          const c = CREW[p.who];
          return (
            <div key={p.who} className={'am-cand' + (p.askState === 'silent' ? ' silent' : '')}>
              <div className="am-cand-l"><span className="am-cand-n">{c.name}</span><Band who={p.who} /></div>
              <div className="am-cand-r">
                <span className={'am-ask ak-' + p.askState}>{p.askState === 'silent' && '👻 '}{ASK[p.askState]}</span>
                {(p.askState === 'in') && <button className="am-mini go" onClick={() => onAssign(seat.id, p.who)}>Confirm</button>}
                {(p.askState === 'available') && <button className="am-mini" onClick={() => onAssign(seat.id, p.who)}>Assign</button>}
              </div>
            </div>
          );
        })}
        {seat.excluded && seat.excluded.map((e) => (
          <div key={e.who} className="am-excl">{CREW[e.who].name} <span>⊘ {e.reason}</span></div>
        ))}
      </div>
    </div>
  );
}

function SeatCard({ seat, onConfirm, onBroadcast, onOpenPool, onNudge }) {
  const occ = seat.who ? CREW[seat.who] : null;
  const st = seat.state.toLowerCase();
  const inCount = seat.pool.filter((p) => p.askState === 'in').length;
  const silent = seat.pool.filter((p) => p.askState === 'silent').length;
  return (
    <div className={'am-seat am-seat-' + st}>
      <div className="am-seat-top">
        <div className="am-seat-id">
          <span className={'role-ic role-' + seat.role}>{seat.role === 'captain' ? 'C' : 'M'}</span>
          <div>
            <div className="am-seat-role">{seat.role}</div>
            <div className="am-seat-proto">{seat.protocol === 'assign-then-confirm' ? 'assign → confirm' : 'ask → assign'}</div>
          </div>
        </div>
        <span className={'am-badge ab-' + st}>{seat.state}</span>
      </div>

      {seat.state === 'Confirmed' && occ && (
        <div className="am-occ ok"><span className="am-occ-n">{occ.name}</span><Band who={seat.who} /><a className="am-call" href={'tel:' + occ.name}>✆</a></div>
      )}
      {seat.state === 'Claimed' && occ && (
        <div className="am-occ claim">
          <div><span className="am-occ-n">{occ.name}</span><Band who={seat.who} /><div className="am-occ-tag">accepted · awaiting confirm</div></div>
          <button className="am-cta" onClick={() => onConfirm(seat.id)}>Confirm</button>
        </div>
      )}
      {seat.state === 'Asked' && occ && (
        <div className="am-occ asked">
          <div><span className="am-occ-n">{occ.name}</span><Band who={seat.who} /><div className="am-occ-tag">named · awaiting reply</div></div>
          <button className="am-mini" onClick={() => onNudge(seat.who)}>Nudge</button>
        </div>
      )}
      {seat.state === 'Bailed' && (
        <div className="am-occ bail">✕ {occ ? occ.name : 'Crew'} bailed — reopening &amp; re-asking…</div>
      )}

      {(seat.state === 'Open' || seat.state === 'Asked') && (
        <button className="am-poolbtn" onClick={() => onOpenPool(seat)}>
          View pool · {seat.pool.length}
          <span className="am-poolstats">
            {inCount > 0 && <span className="ps in">{inCount} in</span>}
            {silent > 0 && <span className="ps silent">{silent} silent</span>}
          </span>
        </button>
      )}
      {seat.state === 'Open' && seat.protocol === 'ask-then-assign' &&
        <button className="am-cta wide" onClick={() => onBroadcast(seat.id)}>📣 Broadcast ask</button>}
    </div>
  );
}

function AssignMobileApp() {
  const [seats, setSeats] = React.useState(() => AMB.SEED_SHIFT.seats.map((s) => ({ ...s, pool: s.pool.map((p) => ({ ...p })) })));
  const [auto, setAuto] = React.useState(true);
  const [pool, setPool] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const timers = React.useRef([]);
  const sh = AMB.SEED_SHIFT;
  const state = shiftState(seats);
  const totalPax = sh.trips.reduce((s, t) => s + t.pax, 0);

  const showToast = (m) => { setToast(m); clearTimeout(window.__amt); window.__amt = setTimeout(() => setToast(null), 2800); };
  const pause = () => setAuto(false);
  const patch = (id, fn) => setSeats((ss) => ss.map((s) => s.id === id ? fn(s) : s));
  const after = (ms, fn) => { const id = setTimeout(fn, ms); timers.current.push(id); };
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const onBroadcast = (id) => {
    pause();
    patch(id, (s) => ({ ...s, state: 'Asked', pool: s.pool.map((p) => ({ ...p, askState: 'asked' })) }));
    showToast('📣 Asked the pool — first yes wins');
    setPool(null);
    after(1100, () => patch(id, (s) => ({ ...s, pool: s.pool.map((p) => p.who === 'cody' ? { ...p, askState: 'declined' } : p) })));
    after(2300, () => patch(id, (s) => ({ ...s, state: 'Claimed', who: 'petra', pool: s.pool.map((p) => p.who === 'petra' ? { ...p, askState: 'in', replyMins: 6 } : p) })));
    after(4000, () => patch(id, (s) => ({ ...s, pool: s.pool.map((p) => p.who === 'theo' ? { ...p, askState: 'silent' } : p) })));
  };
  const onAssign = (id, who) => { pause(); patch(id, (s) => ({ ...s, state: 'Claimed', who })); setPool(null); showToast(CREW[who].name + ' assigned — awaiting confirm'); };
  const onConfirm = (id) => { pause(); patch(id, (s) => ({ ...s, state: 'Confirmed' })); const s = seats.find((x) => x.id === id); showToast('✓ Confirmed into the ' + (s ? s.role : '') + ' seat'); };
  const onNudge = (who) => { pause(); showToast('Nudged ' + CREW[who].name); };
  const resume = () => { setAuto(true); showToast('Automation resumed'); };

  return (
    <window.IOSDevice>
      <div className="am-app">
        <div className="am-scroll">
          <header className="am-head">
            <div className="am-eyebrow"><span className="boat-dot" data-boat={sh.boatId} /> {sh.boat} · {sh.dayLabel}</div>
            <div className="am-h-row">
              <div className="am-trips">{sh.trips.map((t, i) => <span key={i} className="am-trip">{t.label}<b>{t.pax}</b></span>)}<span className="am-pax">{totalPax} pax</span></div>
              <span className={'am-shift-badge sb-' + state.toLowerCase().replace(/[^a-z]/g, '')}>{state}</span>
            </div>
            <div className="am-fillsby"><span>fills by Thu 6:00 PM</span><b className="am-cd">33h 56m</b></div>
          </header>

          <div className={'am-posture' + (auto ? ' auto' : ' manual')}>
            {auto
              ? <><span className="am-pulse" /><b>Automation working</b><span>monitoring</span></>
              : <><span>✋</span><b>You're driving</b><button className="am-resume" onClick={resume}>Resume</button></>}
          </div>

          <div className="am-seats">
            {seats.map((s) => (
              <SeatCard key={s.id} seat={s} onConfirm={onConfirm} onBroadcast={onBroadcast} onOpenPool={setPool} onNudge={onNudge} />
            ))}
          </div>

          <div className="am-foot-note">Heavy work — overrides, split/merge, the full pool — lives on the desktop assignment view. This is for quick calls on the go.</div>
        </div>

        {pool && <PoolSheet seat={seats.find((s) => s.id === pool.id)} onClose={() => setPool(null)} onAssign={onAssign} />}
        {toast && <div className="am-toast">{toast}</div>}
      </div>
    </window.IOSDevice>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AssignMobileApp />);
