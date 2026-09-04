// roster.jsx — left pane: pool-health strip, filters, and the crew list.
const { personHealth, poolEligible, effectiveScore } = window.MusterData;

// Top-of-pane summary — the pool-health view Eric keeps in his head.
function PoolHealth({ people }) {
  const active = people.filter((p) => p.status === 'active');
  const expired = active.filter((p) => personHealth(p) === 'expired').length;
  const soon = active.filter((p) => personHealth(p) === 'soon').length;
  const caps = active.filter((p) => poolEligible(p, 'captain')).length;
  const mates = active.filter((p) => poolEligible(p, 'mate')).length;
  const onPto = active.filter((p) => p.suppressions.length > 0).length;
  const stat = (n, label, tone) => (
    <div className={'ph-stat' + (tone ? ' ph-' + tone : '')}>
      <span className="ph-n">{n}</span>
      <span className="ph-l">{label}</span>
    </div>
  );
  return (
    <div className="pool-health">
      {stat(active.length, 'active crew')}
      <div className="ph-sep" />
      {stat(caps, 'in captain pool')}
      {stat(mates, 'in mate pool')}
      <div className="ph-sep" />
      {stat(soon, 'expiring', soon ? 'warn' : null)}
      {stat(expired, 'expired', expired ? 'bad' : null)}
      {stat(onPto, 'on PTO')}
    </div>
  );
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'captain', label: 'Captains' },
  { id: 'mate', label: 'Mates' },
  { id: 'issues', label: 'Needs attention' },
  { id: 'inactive', label: 'Inactive' },
];

function RosterRow({ p, people, selected, onSelect, display }) {
  const health = personHealth(p);
  const inactive = p.status === 'inactive';
  const issue = health === 'expired' || health === 'soon';
  const seat = p.ratings.includes('captain') ? 'captain' : p.ratings.includes('mate') ? 'mate' : null;
  return (
    <button
      className={'row' + (selected ? ' row-sel' : '') + (inactive ? ' row-inactive' : '')}
      onClick={() => onSelect(p.id)}
    >
      <div className="row-main">
        <div className="row-name">
          {p.name}
          {inactive && <span className="tag-inactive">inactive</span>}
        </div>
        <div className="row-ratings">
          {p.ratings.length === 0
            ? <window.TraineeChip />
            : p.ratings.map((r) => <window.RatingChip key={r} rating={r} />)}
          {p.suppressions.length > 0 && <span className="chip chip-pto">PTO</span>}
        </div>
      </div>
      <div className="row-standing">
        {p.ratings.length > 0
          ? <window.Standing person={p} people={people} seat={seat} display={display} />
          : <window.Standing person={p} people={people} display="band" />}
      </div>
      <div className="row-flag">
        <window.HealthFlag state={health} />
      </div>
    </button>
  );
}

function Roster({ people, selectedId, onSelect, query, setQuery, filter, setFilter, display, onAdd, density }) {
  const matchesFilter = (p) => {
    if (filter === 'all') return p.status === 'active';
    if (filter === 'inactive') return p.status === 'inactive';
    if (filter === 'captain') return p.status === 'active' && p.ratings.includes('captain');
    if (filter === 'mate') return p.status === 'active' && p.ratings.includes('mate');
    if (filter === 'issues') return p.status === 'active' && personHealth(p) !== 'valid';
    return true;
  };
  const q = query.trim().toLowerCase();
  const list = people
    .filter(matchesFilter)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.phone.includes(q))
    .sort((a, b) => {
      // issues to top, then by effective standing
      const ah = personHealth(a) !== 'valid' ? 1 : 0;
      const bh = personHealth(b) !== 'valid' ? 1 : 0;
      if (filter === 'issues' && ah !== bh) return bh - ah;
      return effectiveScore(b) - effectiveScore(a);
    });

  return (
    <div className={'roster density-' + density}>
      <div className="roster-top">
        <PoolHealth people={people} />
        <div className="roster-tools">
          <div className="search">
            <span className="search-i">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search crew or phone…"
            />
            {query && <button className="search-x" onClick={() => setQuery('')}>✕</button>}
          </div>
          <window.Btn variant="primary" onClick={onAdd}>+ Add crew</window.Btn>
        </div>
        <div className="filters">
          {FILTERS.map((f) => {
            const count = f.id === 'issues'
              ? people.filter((p) => p.status === 'active' && personHealth(p) !== 'valid').length
              : null;
            return (
              <button
                key={f.id}
                className={'filter' + (filter === f.id ? ' filter-on' : '')}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {count ? <span className="filter-badge">{count}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="roster-head">
        <span>Crew · ratings</span>
        <span>Standing</span>
        <span>Credentials</span>
      </div>
      <div className="roster-list">
        {list.length === 0 && <div className="roster-empty">No crew match this view.</div>}
        {list.map((p) => (
          <RosterRow
            key={p.id} p={p} people={people}
            selected={p.id === selectedId} onSelect={onSelect} display={display}
          />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Roster });
