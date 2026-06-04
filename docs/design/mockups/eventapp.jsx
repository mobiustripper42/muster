// eventapp.jsx — Event Admin shell: layout, state, import apply.
function EventApp() {
  const [events, setEvents] = React.useState(() => window.EventData.EVENTS.map((e) => ({ ...e, reservations: e.reservations.map((r) => ({ ...r })) })));
  const [selectedId, setSelectedId] = React.useState('e4'); // 3pm Sat — shows edited-after-shift + manual + conflict
  const [boat, setBoat] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const [lastSync, setLastSync] = React.useState('Mon Jun 1, 7:02 AM');
  const [toast, setToast] = React.useState(null);

  const showToast = (m) => { setToast(m); clearTimeout(window.__et); window.__et = setTimeout(() => setToast(null), 2800); };
  const update = (id, patch) => setEvents((es) => es.map((e) => e.id === id ? { ...e, ...patch } : e));

  const applyImport = (R) => {
    setEvents((es) => {
      const have = new Set(es.map((e) => e.id));
      const adds = R.newEvents.filter((e) => !have.has(e.id)); // reconcile: no duplicates
      return [...es, ...adds.map((e) => ({ ...e, reservations: e.reservations.map((r) => ({ ...r })) }))];
    });
    setLastSync('Wed Jun 3, 8:14 AM');
    setImporting(false);
    showToast(`Imported · +${R.addedEvents} events, +${R.addedRes} reservations · ${R.unparseable.length} rows need fixing`);
  };

  const selected = events.find((e) => e.id === selectedId);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Muster</span>
          <span className="brand-sep">/</span>
          <span className="brand-surface">Event Admin</span>
        </div>
        <nav className="surface-nav">
          <a href="Crew Roster.html">Crew Roster</a>
          <span className="surface-nav-on">Event Admin</span>
        </nav>
        <div className="topbar-r">
          <span className="tenant">BrewBoat</span>
          <span className="today">Wed · Jun 3, 2026</span>
        </div>
      </header>

      <main className="panes">
        <window.EventList
          events={events} selectedId={selectedId} onSelect={setSelectedId}
          boat={boat} setBoat={setBoat} query={query} setQuery={setQuery}
          onImport={() => setImporting(true)} lastSync={lastSync}
        />
        <div className="detail-pane">
          {selected
            ? <window.EventDetail ev={selected} update={update} />
            : <div className="detail-empty"><div className="detail-empty-mark">—</div><p>Select an event to see its reservations.</p></div>}
        </div>
      </main>

      {importing && <window.ImportModal onClose={() => setImporting(false)} onApply={applyImport} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<EventApp />);
