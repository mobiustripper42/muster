// app.jsx — top-level: layout, state, tweaks, modals.
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#2f5d86",
  "density": "comfortable",
  "standingDisplay": "score"
}/*EDITMODE-END*/;

const ACCENTS = ['#2f5d86', '#3f7d72', '#9a5b3b', '#7a4a52'];

function App() {
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const [people, setPeople] = React.useState(() =>
    window.MusterData.SEED.map((p) => ({ ...p }))
  );
  const [selectedId, setSelectedId] = React.useState('c10'); // Will Stearns — shows the deactivation case
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [adding, setAdding] = React.useState(false);
  const [deactivating, setDeactivating] = React.useState(null);
  const [toast, setToast] = React.useState(null);

  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', t.accent);
  }, [t.accent]);

  const showToast = (msg) => { setToast(msg); clearTimeout(window.__tt); window.__tt = setTimeout(() => setToast(null), 2600); };

  const update = (id, patch) => setPeople((ps) => ps.map((p) => p.id === id ? { ...p, ...patch } : p));

  const createCrew = (data) => {
    const id = 'c' + Date.now();
    const np = {
      id, name: data.name, phone: data.phone, email: data.email,
      ratings: data.ratings,
      credentials: [], manualThumb: { kind: 'none' }, suppressions: [],
      protocol: 'default', status: 'active',
      reliability: { history: false, score: null, reasons: [] },
      futureAssignments: [],
    };
    setPeople((ps) => [...ps, np]);
    setSelectedId(id);
    setAdding(false);
    showToast(`${data.name} added · neutral “no history” standing`);
  };

  const confirmDeactivate = () => {
    const p = deactivating;
    update(p.id, { status: 'inactive', futureAssignments: [] });
    setDeactivating(null);
    showToast(p.futureAssignments.length
      ? `${p.name} deactivated · ${p.futureAssignments.length} seat${p.futureAssignments.length > 1 ? 's' : ''} reopened`
      : `${p.name} deactivated`);
  };

  const selected = people.find((p) => p.id === selectedId);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Muster</span>
          <span className="brand-sep">/</span>
          <span className="brand-surface">Crew Roster</span>
        </div>
        <nav className="surface-nav">
          <span className="surface-nav-on">Crew Roster</span>
          <a href="Event Admin.html">Event Admin</a>
        </nav>
        <div className="topbar-r">
          <span className="tenant">BrewBoat</span>
          <span className="today">Wed · Jun 3, 2026</span>
        </div>
      </header>

      <main className="panes">
        <window.Roster
          people={people}
          selectedId={selectedId}
          onSelect={setSelectedId}
          query={query} setQuery={setQuery}
          filter={filter} setFilter={setFilter}
          display={t.standingDisplay}
          density={t.density}
          onAdd={() => setAdding(true)}
        />
        <div className="detail-pane">
          {selected
            ? <window.PersonDetail
                person={selected} people={people} update={update}
                onDeactivateClick={(p) => setDeactivating(p)} />
            : <div className="detail-empty">
                <div className="detail-empty-mark">—</div>
                <p>Select a crew member to see their record.</p>
              </div>}
        </div>
      </main>

      {adding && <window.AddCrewModal onClose={() => setAdding(false)} onCreate={createCrew} />}
      {deactivating && <window.DeactivateModal person={deactivating} onClose={() => setDeactivating(null)} onConfirm={confirmDeactivate} />}
      {toast && <div className="toast">{toast}</div>}

      <window.TweaksPanel>
        <window.TweakSection label="Surface" />
        <window.TweakColor label="Accent" value={t.accent} options={ACCENTS} onChange={(v) => setTweak('accent', v)} />
        <window.TweakRadio label="Density" value={t.density} options={['compact', 'comfortable']} onChange={(v) => setTweak('density', v)} />
        <window.TweakSection label="Standing" />
        <window.TweakRadio label="List display" value={t.standingDisplay} options={['band', 'rank', 'score']} onChange={(v) => setTweak('standingDisplay', v)} />
      </window.TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
