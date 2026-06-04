// crewapp.jsx — the crew member's three surfaces. Insultingly small.
const CD = window.CrewData;
const { ME, CO, SHIFTS, ASKS } = CD;

function fmtDateShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
const telHref = (p) => 'tel:' + p.replace(/[^0-9+]/g, '');
const smsHref = (p) => 'sms:' + p.replace(/[^0-9+]/g, '');
const mapHref = (q) => 'https://maps.google.com/?q=' + encodeURIComponent(q);

// ---------- The ask (push/SMS-style, answerable inline) ----------
function AskCard({ ask, onIn, onOut }) {
  return (
    <div className="ask-card">
      <div className="ask-push">
        <span className="ask-app">MUSTER · now</span>
        <div className="ask-line">{ask.line} <b>In or out?</b></div>
      </div>
      <div className="ask-btns">
        <button className="ask-out" onClick={() => onOut(ask)}>Out</button>
        <button className="ask-in" onClick={() => onIn(ask)}>In</button>
      </div>
      <div className="ask-foot">Answer right here — no login, no hunting.</div>
    </div>
  );
}

// ---------- Standing (own only, non-comparative) ----------
function StandingSheet({ onClose }) {
  const s = ME.standing;
  return (
    <Sheet title="Your standing" onClose={onClose}>
      <div className="stand-big"><span className={'stand-band sb-' + s.band.toLowerCase()}>{s.band}</span><span className="stand-blurb">{s.blurb}</span></div>
      <ul className="stand-reasons">{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      <div className="stand-note">This is just yours — you’re never ranked against other crew.</div>
    </Sheet>
  );
}

// ---------- Sheet primitive ----------
function Sheet({ title, onClose, children, footer, danger }) {
  return (
    <div className="cw-sheet-scrim" onClick={onClose}>
      <div className={'cw-sheet' + (danger ? ' danger' : '')} onClick={(e) => e.stopPropagation()}>
        <div className="cw-grip" />
        {title && <h3>{title}</h3>}
        {children}
        {footer && <div className="cw-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Home: My shifts ----------
function Home({ shifts, asks, onOpen, onAskIn, onAskOut, onStanding, credDismissed, onDismissCred }) {
  const cred = ME.credential;
  return (
    <div className="cw-scroll">
      <header className="cw-head">
        <div className="cw-hi">Hi, {ME.name}</div>
        <button className="cw-standing" onClick={onStanding}>
          <span className={'stand-dot sb-' + ME.standing.band.toLowerCase()} />
          {ME.standing.band} standing
          <span className="cw-chev">›</span>
        </button>
      </header>

      {!credDismissed && (
        <div className="cred-nudge">
          <span className="cred-i">⏷</span>
          <div className="cred-body">
            <b>Your {cred.type} expires {fmtDateShort(cred.expiresISO)}</b>
            <span>{cred.daysLeft} days left. Renew soon so you stay in the rotation — we’ll stop asking you for trips after it lapses.</span>
            <div className="cred-acts">
              <button className="cred-cta">How to renew</button>
              <button className="cred-x" onClick={onDismissCred}>Got it</button>
            </div>
          </div>
        </div>
      )}

      {asks.length > 0 && (
        <section className="cw-section">
          <div className="cw-sec-h">You’re asked</div>
          {asks.map((a) => <AskCard key={a.id} ask={a} onIn={onAskIn} onOut={onAskOut} />)}
        </section>
      )}

      <section className="cw-section">
        <div className="cw-sec-h">Your shifts</div>
        {shifts.length === 0
          ? <div className="cw-empty"><div className="cw-empty-i">⚓</div><b>Nothing booked right now.</b><span>That’s normal — you’ll get a ping when there’s a trip for you.</span></div>
          : shifts.map((s) => (
            <button key={s.id} className="cw-shift" onClick={() => onOpen(s.id)}>
              <div className="cw-shift-l">
                <div className="cw-shift-day">{s.dayLabel}{s.changed && <span className="cw-updated">Updated</span>}</div>
                <div className="cw-shift-boat"><span className="boat-dot" data-boat={s.boatId} />{s.boat} · {s.tripType}</div>
                <div className="cw-shift-times"><span className="t-call">Call {s.callTime}</span><span className="t-dep">Departs {s.departTime}</span></div>
              </div>
              <span className="cw-chev big">›</span>
            </button>
          ))}
      </section>

      <div className="cw-foot-note">Your shift card is the one source of truth. If a time changes, the card changes and you get a ping — never “check your email.”</div>
    </div>
  );
}

// ---------- Shift card: single source of truth ----------
function EventManifest({ ev }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mani-ev">
      <button className="mani-ev-h" onClick={() => setOpen((v) => !v)}>
        <span className="mani-time">{ev.time}</span>
        <span className="mani-pax">{ev.pax} guests</span>
        <span className="mani-toggle">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mani-parties">
          {ev.parties.map((p, i) => (
            <a key={i} className="mani-party" href={telHref(p.phone)}>
              <span className="mani-name">{p.name} <span className="mani-n">×{p.n}</span></span>
              <span className="mani-phone mono">{p.phone}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftCard({ s, onBack, onBail }) {
  return (
    <div className="cw-scroll cw-card-scroll">
      <div className="cw-cardbar">
        <button className="cw-back" onClick={onBack}>‹ Shifts</button>
      </div>

      {s.changed && (
        <div className="live-banner">
          <span className="live-dot" /> <b>Changed since you last looked.</b> {s.changeNote}
        </div>
      )}

      <div className="cw-card-hd">
        <div className="cw-card-day">{s.dayLabel}</div>
        <h1>{s.boat}</h1>
        <div className="cw-card-type">{s.tripType}</div>
      </div>

      {/* the load-bearing distinction: call vs departure */}
      <div className="times-row">
        <div className="time-box time-call">
          <span className="time-l">Be there (call)</span>
          <span className="time-v">{s.callTime}</span>
        </div>
        <div className="time-box">
          <span className="time-l">First departure</span>
          <span className="time-v">{s.departTime}</span>
        </div>
      </div>

      <a className="dock-pin" href={mapHref(s.dockMap)} target="_blank" rel="noopener">
        <span className="dock-ic">📍</span>
        <div><span className="dock-l">Dock</span><b>{s.dock}</b></div>
        <span className="dock-go">Map ›</span>
      </a>

      <section className="cw-card-sec">
        <div className="cw-card-sec-h">Crewing with you</div>
        {s.coCrew.map((id) => {
          const c = CO[id];
          return (
            <div key={id} className="cocrew">
              <div className="cocrew-l"><span className={'role-ic role-' + c.role}>{c.role === 'captain' ? 'C' : 'M'}</span><div><b>{c.name}</b><span className="cocrew-role">{c.role}</span></div></div>
              <div className="cocrew-acts"><a className="cc-btn" href={telHref(c.phone)}>✆</a><a className="cc-btn" href={smsHref(c.phone)}>✉</a></div>
            </div>
          );
        })}
      </section>

      <section className="cw-card-sec">
        <div className="cw-card-sec-h">Manifest <span className="sec-note">per trip — different guests each time</span></div>
        <div className="mani">{s.events.map((ev, i) => <EventManifest key={i} ev={ev} />)}</div>
      </section>

      {s.notes && (
        <section className="cw-card-sec">
          <div className="cw-card-sec-h">Notes</div>
          <div className="cw-notes">{s.notes}</div>
        </section>
      )}

      <button className="bail-btn" onClick={() => onBail(s)}>Can’t make this one</button>
      <div className="bail-foot">No guilt — tap it and we’ll line up someone else right away. Telling us beats a no-show.</div>
    </div>
  );
}

// ---------- Root ----------
function CrewApp() {
  const [shifts, setShifts] = React.useState(() => SHIFTS.map((s) => ({ ...s })));
  const [asks, setAsks] = React.useState(() => ASKS.map((a) => ({ ...a })));
  const [screen, setScreen] = React.useState('home');
  const [openId, setOpenId] = React.useState(null);
  const [sheet, setSheet] = React.useState(null); // 'standing' | {type:'bail',shift} | {type:'askResult',...}
  const [credDismissed, setCredDismissed] = React.useState(false);
  const [toast, setToast] = React.useState(null);

  const showToast = (m) => { setToast(m); clearTimeout(window.__cwt); window.__cwt = setTimeout(() => setToast(null), 3000); };

  const onAskIn = (ask) => {
    if (ask.filled) {
      setSheet({ type: 'filled', ask });
      setAsks((a) => a.filter((x) => x.id !== ask.id));
      return;
    }
    // accept → becomes a confirmed shift
    const ns = {
      id: ask.id, boat: ask.boat, boatId: ask.boatId, dayLabel: ask.dayLabel,
      tripType: ask.tripType === 'sunset' ? 'Sunset cruise' : 'Day tour',
      callTime: ask.callTime, departTime: ask.tripType === 'sunset' ? '5:00 PM' : '1:00 PM',
      dock: 'Elliott Bay — Pier 56', dockMap: 'Pier 56, Seattle', coCrew: ['marisol'],
      changed: false, notes: 'Newly confirmed — details fill in as the date nears.',
      events: [{ time: ask.callTime, pax: 0, parties: [] }],
    };
    setShifts((s) => [...s, ns]);
    setAsks((a) => a.filter((x) => x.id !== ask.id));
    setSheet({ type: 'in', ask });
  };
  const onAskOut = (ask) => {
    setAsks((a) => a.filter((x) => x.id !== ask.id));
    showToast('Thanks for the quick no — we’re already asking the next mate.');
  };

  const onBail = (s) => setSheet({ type: 'bail', shift: s });
  const confirmBail = (s) => {
    setShifts((ss) => ss.filter((x) => x.id !== s.id));
    setSheet(null); setScreen('home'); setOpenId(null);
    showToast('You’re off this one. Seat reopened — we’re asking the next mate now.');
  };

  const openShift = (id) => { setOpenId(id); setScreen('card'); };
  const current = shifts.find((s) => s.id === openId);

  return (
    <window.IOSDevice>
      <div className="cw-app">
        {screen === 'home' &&
          <Home shifts={shifts} asks={asks} onOpen={openShift}
            onAskIn={onAskIn} onAskOut={onAskOut} onStanding={() => setSheet('standing')}
            credDismissed={credDismissed} onDismissCred={() => setCredDismissed(true)} />}
        {screen === 'card' && current &&
          <ShiftCard s={current} onBack={() => { setScreen('home'); setOpenId(null); }} onBail={onBail} />}

        {sheet === 'standing' && <StandingSheet onClose={() => setSheet(null)} />}
        {sheet && sheet.type === 'bail' &&
          <Sheet title={`Can’t make ${sheet.shift.dayLabel}?`} danger onClose={() => setSheet(null)}
            footer={<><button className="cw-sb" onClick={() => setSheet(null)}>Never mind</button><button className="cw-sb cw-sb-danger" onClick={() => confirmBail(sheet.shift)}>Yes, I’m out</button></>}>
            <p className="cw-sheet-note">No problem at all. We’ll reopen the seat and ask the next mate right away — way better than a no-show. Your card drops off your list.</p>
          </Sheet>}
        {sheet && sheet.type === 'in' &&
          <Sheet title="You’re on! ✓" onClose={() => setSheet(null)}
            footer={<button className="cw-sb cw-sb-primary" onClick={() => setSheet(null)}>Done</button>}>
            <p className="cw-sheet-note">Locked in for {sheet.ask.dayLabel} · {sheet.ask.boat}. It’s on your shifts now — the card fills in with call time, dock, and manifest as the date nears.</p>
          </Sheet>}
        {sheet && sheet.type === 'filled' &&
          <Sheet title="Ah — just filled" onClose={() => setSheet(null)}
            footer={<button className="cw-sb cw-sb-primary" onClick={() => setSheet(null)}>No worries</button>}>
            <p className="cw-sheet-note">{sheet.ask.filledBy} grabbed this one a few seconds before you — first yes wins. Nothing you did wrong; we’ll catch you on the next ask.</p>
          </Sheet>}

        {toast && <div className="cw-toast">{toast}</div>}
      </div>
    </window.IOSDevice>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<CrewApp />);
