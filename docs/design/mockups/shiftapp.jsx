// shiftapp.jsx — Shift Builder shell: state + lock/override/split/merge actions.
const SA = window.ShiftData;

function ShiftApp() {
  const [shifts, setShifts] = React.useState(() => SA.SHIFTS.map((s) => ({ ...s, seats: s.seats.map((x) => ({ ...x })), trips: s.trips.map((t) => ({ ...t })) })));
  const [selectedId, setSelectedId] = React.useState('sh2');
  const [range, setRange] = React.useState('this');
  const [toast, setToast] = React.useState(null);

  const showToast = (m) => { setToast(m); clearTimeout(window.__st); window.__st = setTimeout(() => setToast(null), 3200); };
  const patch = (id, fn) => setShifts((ss) => ss.map((s) => s.id === id ? fn(s) : s));

  const lockOne = (s) => {
    if (s.locked) return { ...s, locked: false };
    let crewState = s.crewState;
    if (SA.insideHorizon(s.date) && crewState === 'Pending') crewState = 'Filling';
    return { ...s, locked: true, crewState, changedSinceReview: false };
  };
  const onLock = (id) => {
    const s = shifts.find((x) => x.id === id);
    const wasLocked = s.locked;
    patch(id, lockOne);
    if (wasLocked) showToast('Shift unlocked');
    else if (SA.insideHorizon(s.date)) showToast('🔒 Locked · Tier-1 asks fired to the eligible pool');
    else showToast('🔒 Locked · outside the staffing horizon — asks will fire closer to the date');
  };

  const onAddHand = (id) => { patch(id, (s) => ({ ...s, seats: [...s.seats, { id: 'h' + Date.now(), role: 'hand', kind: 'hand', state: 'Open', who: null }], crewState: s.crewState === 'Crewed' ? 'Filling' : s.crewState })); showToast('Added a required working hand — now gates Crewed'); };
  const onAddSuper = (id) => { patch(id, (s) => ({ ...s, seats: [...s.seats, { id: 's' + Date.now(), role: 'super', kind: 'super', state: 'Open', who: null }] })); showToast('Added a supernumerary seat — non-gating, −1 passenger slot'); };
  const onRemoveSeat = (id, seatId) => patch(id, (s) => ({ ...s, seats: s.seats.filter((x) => x.id !== seatId) }));

  const onSplit = (id, assign) => {
    setShifts((ss) => {
      const idx = ss.findIndex((s) => s.id === id);
      const s = ss[idx];
      const mk = (g, suffix) => ({
        ...s, id: s.id + suffix,
        trips: s.trips.filter((_, i) => assign[i] === g),
        seats: SA.reqSeats(), crewState: 'Pending', locked: false,
        changedSinceReview: false, isNew: false, splitFrom: s.id,
      });
      const a = mk('A', 'a'), b = mk('B', 'b');
      const next = [...ss]; next.splice(idx, 1, a, b);
      return next;
    });
    setSelectedId(id + 'a');
    showToast('Split into 2 shifts — each needs review & lock');
  };

  const onMerge = (id, otherId) => {
    setShifts((ss) => {
      const s = ss.find((x) => x.id === id), o = ss.find((x) => x.id === otherId);
      const merged = {
        ...s, id: 'm' + Date.now(),
        trips: [...s.trips, ...o.trips].sort((a, b) => a.time.localeCompare(b.time)),
        seats: SA.reqSeats(), crewState: 'Pending', locked: false, changedSinceReview: false, isNew: false,
      };
      const rest = ss.filter((x) => x.id !== id && x.id !== otherId);
      return [...rest, merged];
    });
    showToast('Merged into one shift');
    setSelectedId(null);
  };

  const onLockWeekend = () => {
    const R = SA.RANGES.find((r) => r.id === range);
    const targets = shifts.filter((s) => R.test(s.date) && !s.locked);
    if (!targets.length) return;
    const fired = targets.filter((s) => SA.insideHorizon(s.date)).length;
    setShifts((ss) => ss.map((s) => (R.test(s.date) && !s.locked) ? lockOne(s) : s));
    showToast(`🔒 Locked ${targets.length} shift${targets.length > 1 ? 's' : ''}${fired ? ` · asks fired for ${fired} inside the horizon` : ''}`);
  };

  const selected = shifts.find((s) => s.id === selectedId);
  const sibling = selected ? shifts.find((s) => s.id !== selected.id && s.boatId === selected.boatId && s.date === selected.date) : null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Muster</span>
          <span className="brand-sep">/</span>
          <span className="brand-surface">Shift Builder</span>
        </div>
        <nav className="surface-nav">
          <a href="Crew Roster.html">Crew Roster</a>
          <a href="Event Admin.html">Event Admin</a>
          <span className="surface-nav-on">Shift Builder</span>
        </nav>
        <div className="topbar-r">
          <span className="tenant">BrewBoat</span>
          <span className="today">Wed · Jun 3, 2026</span>
        </div>
      </header>

      <main className="panes">
        <window.ShiftBoard
          shifts={shifts} selectedId={selectedId} onSelect={setSelectedId}
          range={range} setRange={setRange} onLockWeekend={onLockWeekend}
        />
        <div className="detail-pane">
          {selected
            ? <window.ShiftDetail
                sh={selected} sibling={sibling} update={patch}
                onLock={onLock} onAddHand={onAddHand} onAddSuper={onAddSuper}
                onRemoveSeat={onRemoveSeat} onSplit={onSplit} onMerge={onMerge} />
            : <div className="detail-empty"><div className="detail-empty-mark">—</div><p>Select a shift to review it.</p></div>}
        </div>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ShiftApp />);
