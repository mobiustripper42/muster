// mobiledetail.jsx — read-first person detail + PTO quick-log sheet + root app.
const MD = window.MusterData;
const { fmtDate, fmtShort, personHealth, credHealth, poolBlockReason,
        effectiveBand, effectiveScore, poolRank, parseD } = MD;
const { Band } = window.MobileBits;
const telH = (p) => 'tel:' + p.replace(/[^0-9+]/g, '');
const smsH = (p) => 'sms:' + p.replace(/[^0-9+]/g, '');

function Card({ title, children, action }) {
  return (
    <section className="m-card">
      {title && <div className="m-card-h"><h2>{title}</h2>{action}</div>}
      {children}
    </section>
  );
}

function ThumbBadge({ p }) {
  const t = p.manualThumb;
  if (t.kind === 'boost') return <span className="m-thumb m-thumb-boost">▲ Boosted by Eric</span>;
  if (t.kind === 'floor') return <span className="m-thumb m-thumb-floor">▲ Pinned · never below {t.band}</span>;
  return null;
}

function DetailScreen({ person, people, onBack, onAddPto, onRemovePto }) {
  const [sheet, setSheet] = React.useState(false);
  const cold = !person.reliability.history;
  const inactive = person.status === 'inactive';

  return (
    <div className="m-scroll m-detail-scroll">
      <div className="m-dbar">
        <button className="m-back" onClick={onBack}>
          <svg width="11" height="18" viewBox="0 0 11 18"><path d="M9 1L2 9l7 8" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Crew
        </button>
      </div>

      <div className="m-dhead">
        <div className="m-dname">
          {person.name}
          {inactive && <span className="m-tag lg">inactive</span>}
        </div>
        <div className="m-dsub">
          <span className={'m-status' + (person.status === 'active' ? ' on' : '')}><i />{person.status === 'active' ? 'Active' : 'Inactive'}</span>
          <window.MobileBits.RatingChips p={person} />
        </div>
      </div>

      {/* Contact — the real phone affordance */}
      <div className="m-contact">
        <a className="m-cbtn m-call" href={telH(person.phone)}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.2 1l-2.3 2.2z"/></svg>
          Call
        </a>
        <a className="m-cbtn m-text" href={smsH(person.phone)}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H8l-4 4V6c0-1.1.9-2 2-2z"/></svg>
          Text
        </a>
        <div className="m-phone"><span className="mono">{person.phone}</span></div>
      </div>

      {/* Standing */}
      <Card title="Reliability standing">
        <div className="m-standing">
          <Band p={person} />
          {person.reliability.history
            ? <span className="m-score mono">{Math.round(effectiveScore(person))}</span>
            : <span className="m-cold">No history yet — neutral, mid-pool so they get tried.</span>}
        </div>
        <ThumbBadge p={person} />
        {!cold && (
          <ul className="m-reasons">
            {person.reliability.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </Card>

      {/* Pool membership */}
      <Card title="Pools">
        {person.ratings.length === 0 ? (
          <div className="m-pmrow"><span className="m-chip m-chip-trainee">trainee</span><span className="m-pmnote">Supernumerary seat — not in a required-seat pool until rated.</span></div>
        ) : person.ratings.map((seat) => {
          const block = poolBlockReason(person, seat);
          const r = !block ? poolRank(people, person, seat) : null;
          return (
            <div key={seat} className={'m-pmrow' + (block ? ' out' : '')}>
              <span className={'m-chip m-chip-' + seat}>{seat}</span>
              {block
                ? <span className="m-pmblock">⊘ {block}</span>
                : <span className="m-pmnote">In pool{r ? <> · <b>#{r.rank}</b> of {r.of}</> : ''}</span>}
            </div>
          );
        })}
      </Card>

      {/* Credentials */}
      <Card title="Credentials">
        {person.credentials.length === 0 && <div className="m-empty-line">None on file.</div>}
        {person.credentials.map((c, i) => {
          const h = credHealth(c);
          const note = h.state === 'expired' ? `Expired ${Math.abs(h.days)}d ago`
            : h.state === 'soon' ? `Expires in ${h.days}d` : `Valid · ${h.days}d`;
          return (
            <div key={i} className={'m-cred m-cred-' + h.state}>
              <div className="m-cred-type">{c.type}</div>
              <div className="m-cred-mid"><span className="mono">{c.id || '—'}</span></div>
              <div className="m-cred-exp">
                <span className="mono">{fmtDate(c.expiry)}</span>
                <span className={'m-cred-n m-' + h.state}>{note}</span>
              </div>
            </div>
          );
        })}
      </Card>

      {/* Availability — the one light edit allowed on mobile */}
      <Card title="Availability" action={<button className="m-add" onClick={() => setSheet(true)}>+ Log PTO</button>}>
        {person.suppressions.length === 0
          ? <div className="m-empty-line">No suppressions — available by default.</div>
          : person.suppressions.map((s) => (
            <div key={s.id} className="m-supp">
              <span className="mono">{fmtShort(s.start)} – {fmtShort(s.end)}</span>
              <span className="m-supp-r">{s.reason || 'PTO'}</span>
              <button className="m-supp-x" onClick={() => onRemovePto(person.id, s.id)}>✕</button>
            </div>
          ))}
      </Card>

      <div className="m-foot-note">Ratings, credentials &amp; status are managed on the desktop roster.</div>

      {sheet && <PtoSheet onClose={() => setSheet(false)} onAdd={(w) => { onAddPto(person.id, w); setSheet(false); }} />}
    </div>
  );
}

function PtoSheet({ onClose, onAdd }) {
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [reason, setReason] = React.useState('');
  const valid = start && end && parseD(end) >= parseD(start);
  return (
    <div className="m-sheet-scrim" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" />
        <h3>Log PTO / blackout</h3>
        <p className="m-sheet-note">Removes them from eligible pools that overlap. No positive availability is ever required.</p>
        <label className="m-l">From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="m-l">To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="m-l">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" /></label>
        <div className="m-sheet-actions">
          <button className="m-sb" onClick={onClose}>Cancel</button>
          <button className="m-sb m-sb-primary" disabled={!valid} onClick={() => onAdd({ start, end, reason: reason.trim() })}>Add window</button>
        </div>
      </div>
    </div>
  );
}

function MobileApp() {
  const [people, setPeople] = React.useState(() => MD.SEED.map((p) => ({ ...p })));
  const [screen, setScreen] = React.useState('list');
  const [sel, setSel] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [toast, setToast] = React.useState(null);

  const showToast = (m) => { setToast(m); clearTimeout(window.__mt); window.__mt = setTimeout(() => setToast(null), 2400); };
  const open = (id) => { setSel(id); setScreen('detail'); };
  const back = () => setScreen('list');
  const addPto = (id, w) => {
    setPeople((ps) => ps.map((p) => p.id === id ? { ...p, suppressions: [...p.suppressions, { id: 's' + Date.now(), ...w }] } : p));
    showToast('PTO window added');
  };
  const removePto = (id, sid) => setPeople((ps) => ps.map((p) => p.id === id ? { ...p, suppressions: p.suppressions.filter((s) => s.id !== sid) } : p));

  const person = people.find((p) => p.id === sel);

  return (
    <window.IOSDevice>
      <div className="m-app">
        <div className={'m-screen' + (screen === 'detail' ? ' pushed' : '')}>
          <window.MobileList people={people} onOpen={open} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
        </div>
        <div className={'m-screen m-over' + (screen === 'detail' ? ' active' : '')}>
          {person && <DetailScreen person={person} people={people} onBack={back} onAddPto={addPto} onRemovePto={removePto} />}
        </div>
        {toast && <div className="m-toast">{toast}</div>}
      </div>
    </window.IOSDevice>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<MobileApp />);
