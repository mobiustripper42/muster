// mobileapp.jsx — Muster mobile, read-first. "Check the pool from the dock."
// Reuses all logic from data.jsx (MusterData). Editing of records stays on desktop;
// the phone affords scanning + the two things you'd actually do from a dock:
// call/text a crew member, and log a PTO window when someone says they're out.
const M = window.MusterData;
const { fmtDate, fmtShort, personHealth, credHealth, poolEligible, poolBlockReason,
        effectiveBand, effectiveScore, poolRank, parseD } = M;

const tel = (p) => 'tel:' + p.replace(/[^0-9+]/g, '');
const sms = (p) => 'sms:' + p.replace(/[^0-9+]/g, '');

// Short issue label for a list row, e.g. "Medical expired" / "MMC expires 26d".
function issueLabel(p) {
  let worst = null;
  for (const c of p.credentials) {
    const h = credHealth(c);
    if (h.state === 'expired') return { tone: 'bad', text: `${c.type} expired` };
    if (h.state === 'soon' && (!worst || h.days < worst.days)) worst = { type: c.type, days: h.days };
  }
  if (worst) return { tone: 'warn', text: `${worst.type} expires ${worst.days}d` };
  return null;
}

function Band({ p }) {
  const band = effectiveBand(p);
  const cls = band === 'New' ? 'new' : band.toLowerCase();
  const pinned = p.manualThumb.kind === 'floor';
  return (
    <span className={'m-band m-band-' + cls}>
      {pinned && <span className="m-pin">▲</span>}{band}
    </span>
  );
}

function Flag({ state }) {
  const label = { valid: 'Current', soon: 'Expiring', expired: 'Expired' }[state];
  return <span className={'m-flag m-flag-' + state}><i /></span>;
}

function RatingChips({ p }) {
  if (p.ratings.length === 0) return <span className="m-chip m-chip-trainee">trainee</span>;
  return p.ratings.map((r) => <span key={r} className={'m-chip m-chip-' + r}>{r}</span>);
}

// ---- List screen --------------------------------------------------
function PoolHealth({ people }) {
  const active = people.filter((p) => p.status === 'active');
  const caps = active.filter((p) => poolEligible(p, 'captain')).length;
  const mates = active.filter((p) => poolEligible(p, 'mate')).length;
  const soon = active.filter((p) => personHealth(p) === 'soon').length;
  const expired = active.filter((p) => personHealth(p) === 'expired').length;
  const pto = active.filter((p) => p.suppressions.length > 0).length;
  return (
    <div className="m-pool">
      <div className="m-pool-counts">
        <div className="m-pc"><b>{caps}</b><span>captains</span></div>
        <div className="m-pc"><b>{mates}</b><span>mates</span></div>
        <div className="m-pc"><b>{active.length}</b><span>active</span></div>
      </div>
      {(soon || expired || pto) > 0 && (
        <div className="m-pool-issues">
          {expired > 0 && <span className="m-pi m-pi-bad">{expired} expired</span>}
          {soon > 0 && <span className="m-pi m-pi-warn">{soon} expiring</span>}
          {pto > 0 && <span className="m-pi m-pi-flat">{pto} PTO</span>}
        </div>
      )}
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

function ListScreen({ people, onOpen, query, setQuery, filter, setFilter }) {
  const match = (p) => {
    if (filter === 'all') return p.status === 'active';
    if (filter === 'inactive') return p.status === 'inactive';
    if (filter === 'captain') return p.status === 'active' && p.ratings.includes('captain');
    if (filter === 'mate') return p.status === 'active' && p.ratings.includes('mate');
    if (filter === 'issues') return p.status === 'active' && personHealth(p) !== 'valid';
    return true;
  };
  const q = query.trim().toLowerCase();
  const list = people.filter(match)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.phone.includes(q))
    .sort((a, b) => {
      const ai = personHealth(a) !== 'valid' ? 1 : 0;
      const bi = personHealth(b) !== 'valid' ? 1 : 0;
      if (ai !== bi) return bi - ai;
      return effectiveScore(b) - effectiveScore(a);
    });
  const issueCount = people.filter((p) => p.status === 'active' && personHealth(p) !== 'valid').length;

  return (
    <div className="m-scroll">
      <header className="m-head">
        <div className="m-head-top">
          <div>
            <div className="m-eyebrow">BrewBoat · Wed Jun 3</div>
            <h1>Crew</h1>
          </div>
          <span className="m-mark" />
        </div>
        <PoolHealth people={people} />
        <div className="m-search">
          <span className="m-search-i">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search crew or phone" />
          {query && <button onClick={() => setQuery('')}>✕</button>}
        </div>
        <div className="m-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={'m-filter' + (filter === f.id ? ' on' : '')} onClick={() => setFilter(f.id)}>
              {f.label}{f.id === 'issues' && issueCount ? <span className="m-fbadge">{issueCount}</span> : null}
            </button>
          ))}
        </div>
      </header>

      <div className="m-list">
        {list.length === 0 && <div className="m-empty">No crew in this view.</div>}
        {list.map((p) => {
          const issue = issueLabel(p);
          return (
            <button key={p.id} className={'m-row' + (p.status === 'inactive' ? ' inactive' : '')} onClick={() => onOpen(p.id)}>
              <div className="m-row-l">
                <div className="m-row-name">
                  {p.name}
                  {p.status === 'inactive' && <span className="m-tag">inactive</span>}
                </div>
                <div className="m-row-meta">
                  <RatingChips p={p} />
                  {p.suppressions.length > 0 && <span className="m-chip m-chip-pto">PTO</span>}
                </div>
                {issue && <div className={'m-row-issue m-' + issue.tone}>{issue.text}</div>}
              </div>
              <div className="m-row-r">
                <Band p={p} />
                <Flag state={personHealth(p)} />
              </div>
              <svg className="m-chev" width="8" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          );
        })}
      </div>
      <div className="m-foot-note">Read-only here. Edit records — credentials, ratings, status — on the desktop roster.</div>
    </div>
  );
}

window.MobileList = ListScreen;
window.MobileBits = { Band, Flag, RatingChips, issueLabel };
