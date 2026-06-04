// assignapp.jsx — Assignment cockpit: header, posture, activity, warming, sim.
const AA = window.AssignData;
const { CREW, FILLS_BY, effScore } = AA;

function useCountdown(deadline) {
  const [now, setNow] = React.useState(() => new Date('2026-06-03T08:00:00').getTime());
  React.useEffect(() => { const id = setInterval(() => setNow((n) => n + 60000), 1000); return () => clearInterval(id); }, []);
  const ms = deadline.getTime() - now;
  const h = Math.max(0, Math.floor(ms / 3600000));
  const m = Math.max(0, Math.floor((ms % 3600000) / 60000));
  return { h, m, tight: h < 24 };
}

function shiftState(seats) {
  const req = seats.filter((s) => s.role === 'captain' || s.role === 'mate');
  if (req.some((s) => s.state === 'Bailed')) return 'At-Risk';
  if (req.every((s) => s.state === 'Confirmed')) return 'Crewed';
  // all pools exhausted (declined/silent) on an open seat near deadline → At-Risk
  const stuck = req.some((s) => (s.state === 'Open' || s.state === 'Asked') &&
    s.pool.length > 0 && s.pool.every((p) => p.askState === 'declined' || p.askState === 'silent'));
  if (stuck) return 'At-Risk';
  return 'Filling';
}

function AssignApp() {
  const [seats, setSeats] = React.useState(() => AA.SEED_SHIFT.seats.map((s) => ({ ...s, pool: s.pool.map((p) => ({ ...p })) })));
  const [auto, setAuto] = React.useState(true);          // automation posture
  const [showScore, setShowScore] = React.useState(false); // reliability number on demand
  const [warming, setWarming] = React.useState(false);
  const [activity, setActivity] = React.useState(() => [...AA.SEED_SHIFT.activity]);
  const [toast, setToast] = React.useState(null);
  const timers = React.useRef([]);
  const cd = useCountdown(FILLS_BY);
  const sh = AA.SEED_SHIFT;
  const state = shiftState(seats);

  const log = (t, text) => setActivity((a) => [{ t, when: 'just now', text }, ...a]);
  const showToast = (m) => { setToast(m); clearTimeout(window.__at); window.__at = setTimeout(() => setToast(null), 3000); };
  const pauseAuto = (reason) => { if (auto) { setAuto(false); log('You', 'Took manual control — automation paused. ' + reason); } };
  const patchSeat = (id, fn) => setSeats((ss) => ss.map((s) => s.id === id ? fn(s) : s));
  const setCand = (seatId, who, askState, extra = {}) =>
    patchSeat(seatId, (s) => ({ ...s, pool: s.pool.map((p) => p.who === who ? { ...p, askState, ...extra } : p) }));

  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const after = (ms, fn) => { const id = setTimeout(fn, ms); timers.current.push(id); };

  // --- Broadcast (ask-then-assign): fire to whole pool, simulate replies ---
  const onBroadcast = (seatId) => {
    pauseAuto('Broadcast fired manually.');
    patchSeat(seatId, (s) => ({ ...s, state: 'Asked', pool: s.pool.map((p) => ({ ...p, askState: 'asked' })) }));
    log('You', 'Broadcast ask fired to the mate pool (4 people).');
    showToast('📣 Asked the eligible pool — first acceptable yes wins');
    // simulated staggered responses
    after(1200, () => setCand(seatId, 'cody', 'declined'));
    after(2400, () => { setCand(seatId, 'petra', 'in', { replyMins: 6 }); log('Tier 2', 'Petra Lindqvist replied IN (6m) — fastest acceptable yes.');
      // first-acceptable-yes-wins → becomes claimant
      patchSeat(seatId, (s) => ({ ...s, state: 'Claimed', who: 'petra' })); });
    after(4200, () => setCand(seatId, 'will', 'in', { replyMins: 22 }));
    after(6000, () => { setCand(seatId, 'theo', 'silent'); log('Tier 2', 'Theo Marsh went silent — timed out. Score penalized.'); });
  };

  // --- Assign / "they accepted" → claimant; Confirm → locked ---
  const onAssign = (seatId, who, direct) => {
    pauseAuto('Named someone into a seat.');
    patchSeat(seatId, (s) => ({ ...s, state: 'Claimed', who }));
    if (direct) log('You', `Assigned ${CREW[who].name} — they'll get a confirm/decline ask.`);
  };
  const onConfirm = (seatId) => {
    pauseAuto('Confirmed a claimant.');
    patchSeat(seatId, (s) => ({ ...s, state: 'Confirmed', pool: s.pool.map((p) => p.who === s.who ? { ...p, askState: 'in' } : p) }));
    const s = seats.find((x) => x.id === seatId);
    log('You', `Confirmed ${CREW[s.who] ? CREW[s.who].name : 'crew'} into the ${s.role} seat.`);
    showToast('✓ Confirmed — seat locked');
  };
  const onNudge = (who) => { pauseAuto('Nudged a candidate.'); log('You', `Nudged ${CREW[who].name} directly (manual Tier 2).`); showToast('Nudge sent to ' + CREW[who].name); };
  const onWiden = (seatId) => { pauseAuto('Widened the pool.'); log('You', 'Re-asked / widened the pool.'); showToast('Re-asked the pool'); };

  // --- Manual override: drop anyone in regardless of rank ---
  const onOverride = (seatId, who) => {
    pauseAuto('Manual override.');
    patchSeat(seatId, (s) => ({ ...s, state: 'Confirmed', who, pool: s.pool.some((p) => p.who === who) ? s.pool.map((p) => p.who === who ? { ...p, askState: 'in' } : p) : s.pool }));
    log('You', `Override — placed ${CREW[who].name} into the ${seats.find((x) => x.id === seatId).role} seat (authority backstop).`);
    showToast('Override — ' + CREW[who].name + ' placed directly');
  };

  // --- Bail: flip red, auto-reopen, auto-re-ask next ranked (no manual step) ---
  const onBail = (seatId) => {
    const s = seats.find((x) => x.id === seatId);
    const bailed = s.who;
    patchSeat(seatId, (x) => ({ ...x, state: 'Bailed', pool: x.pool.map((p) => p.who === bailed ? { ...p, askState: 'declined' } : p) }));
    log('System', `${CREW[bailed] ? CREW[bailed].name : 'Crew'} bailed — ${s.role} seat flipped At-Risk.`);
    showToast('⚠ Bail — seat reopened, re-asking automatically');
    after(1500, () => {
      // auto-reopen + re-ask next ranked available/declined-excluded candidate
      const next = [...s.pool].filter((p) => p.who !== bailed).sort((a, b) => effScore(CREW[b.who]) - effScore(CREW[a.who]))[0];
      patchSeat(seatId, (x) => ({
        ...x, state: 'Asked', who: x.protocol === 'assign-then-confirm' && next ? next.who : null,
        pool: x.pool.map((p) => p.who === (next && next.who) ? { ...p, askState: 'asked' } : p),
      }));
      if (next) log('System', `Auto-re-asked ${CREW[next.who].name} (next by reliability) — no manual step.`);
    });
  };

  const resumeAuto = () => { setAuto(true); log('You', 'Resumed automation — Tiers 1–2 back in control.'); showToast('Automation resumed'); };

  const totalPax = sh.trips.reduce((s, t) => s + t.pax, 0);
  // warming signals
  const responded = seats.flatMap((s) => s.pool).filter((p) => p.askState === 'in' || p.askState === 'declined').length;
  const askedTot = seats.flatMap((s) => s.pool).filter((p) => p.askState !== 'available').length;
  const rate = askedTot ? Math.round((responded / askedTot) * 100) : 0;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Muster</span>
          <span className="brand-sep">/</span>
          <span className="brand-surface">Assignment</span>
        </div>
        <nav className="surface-nav">
          <a href="Crew Roster.html">Crew Roster</a>
          <a href="Event Admin.html">Event Admin</a>
          <a href="Shift Builder.html">Shift Builder</a>
          <span className="surface-nav-on">Assignment</span>
        </nav>
        <div className="topbar-r">
          <span className="tenant">BrewBoat</span>
          <span className="today">Wed · Jun 3, 2026</span>
        </div>
      </header>

      <div className="cockpit">
        {/* Shift header */}
        <div className="shift-hd">
          <div className="shd-l">
            <div className="shd-eyebrow"><span className="boat-dot lg" data-boat={sh.boatId} />{sh.boat} · {sh.dayLabel}</div>
            <div className="shd-trips">
              {sh.trips.map((t, i) => <span key={i} className="shd-trip">{t.label}<b>{t.pax}</b>{t.note && <em>{t.note}</em>}</span>)}
              <span className="shd-pax">{totalPax} pax total</span>
            </div>
          </div>
          <div className="shd-r">
            <div className={'fills-by' + (cd.tight ? ' tight' : '')}>
              <span className="fb-l">fills by</span>
              <span className="fb-v mono">{cd.h}h {String(cd.m).padStart(2, '0')}m</span>
              <span className="fb-s">Thu 6:00 PM · staffing horizon</span>
            </div>
            <span className={'shift-badge shb-' + state.toLowerCase().replace(/[^a-z]/g, '')}>{state}</span>
          </div>
        </div>

        {/* Posture bar */}
        <div className={'posture' + (auto ? ' posture-auto' : ' posture-manual')}>
          <div className="posture-l">
            {auto
              ? <><span className="pulse" /><b>Automation working</b><span className="posture-sub">Tiers 1–2 are crewing this shift — you're monitoring</span></>
              : <><span className="hand">✋</span><b>You're driving</b><span className="posture-sub">Manual control — automation paused so the bots don't fight you</span></>}
          </div>
          <div className="posture-r">
            <button className={'ghost-toggle' + (showScore ? ' on' : '')} onClick={() => setShowScore((v) => !v)}>{showScore ? 'Hide' : 'Show'} reliability #</button>
            <button className={'ghost-toggle' + (warming ? ' on' : '')} onClick={() => setWarming((v) => !v)}>Warming signals</button>
            {!auto && <button className="btn btn-s btn-primary" onClick={resumeAuto}>Resume automation</button>}
          </div>
        </div>

        {/* Warming view — deliberate, explicitly NOT the At-Risk board */}
        {warming && (
          <div className="warming">
            <div className="warming-h">Warming signals <span>trending toward risk — not yet At-Risk, so it's not on the board</span></div>
            <div className="warming-grid">
              <div className="wm"><b className={cd.tight ? 'wm-warn' : ''}>{cd.h}h</b><span>to staffing deadline</span></div>
              <div className="wm"><b className={rate < 50 ? 'wm-warn' : ''}>{rate}%</b><span>pool response rate</span></div>
              <div className="wm"><b>{seats.filter((s) => s.state !== 'Confirmed').length}</b><span>seats not yet confirmed</span></div>
              <div className="wm"><b className="wm-warn">1</b><span>silent (ghost) so far</span></div>
            </div>
          </div>
        )}

        {/* Seat cards */}
        <div className="seats-grid">
          {seats.map((seat) => (
            <window.SeatCard key={seat.id} seat={seat} showScore={showScore}
              onBroadcast={onBroadcast} onAssign={onAssign} onConfirm={onConfirm}
              onNudge={onNudge} onWiden={onWiden} onOverride={onOverride} onBail={onBail} />
          ))}
        </div>

        {/* Activity feed (what the system is doing) */}
        <div className="activity">
          <div className="activity-h">Activity · what the system is doing</div>
          <div className="activity-list">
            {activity.map((a, i) => (
              <div key={i} className={'act act-' + a.t.toLowerCase().replace(/[^a-z]/g, '')}>
                <span className="act-t">{a.t}</span>
                <span className="act-text">{a.text}</span>
                <span className="act-when">{a.when}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AssignApp />);
