// eventlist.jsx — left pane: boat filter, week summary, events grouped by date.
const ED = window.EventData;
const { boatName, dateLabel, paxTotal, resCount, fillState } = ED;

function CapBar({ ev }) {
  const p = paxTotal(ev);
  const pct = Math.min(100, (p / ev.capacity) * 100);
  const st = fillState(ev);
  return (
    <div className="capbar" title={`${p} of ${ev.capacity} seats`}>
      <div className="capbar-track">
        <div className={'capbar-fill cf-' + st} style={{ width: pct + '%' }} />
      </div>
      <span className="capbar-num"><b>{p}</b>/{ev.capacity}</span>
    </div>
  );
}

function EventRow({ ev, selected, onSelect }) {
  const cancelledCt = ev.reservations.filter((r) => r.status === 'cancelled').length;
  return (
    <button className={'erow' + (selected ? ' erow-sel' : '')} onClick={() => onSelect(ev.id)}>
      <div className="erow-time">
        <span className="erow-boat-dot" data-boat={ev.boatId} />
        <span className="erow-t">{ev.label}</span>
      </div>
      <div className="erow-mid">
        <div className="erow-boat">{boatName(ev.boatId)}</div>
        <div className="erow-tags">
          {ev.source === 'manual' && <span className="etag etag-manual">manual</span>}
          {ev.editedAfterShift && <span className="etag etag-edited">edited · review</span>}
          {!ev.shift && ev.source !== 'manual' && <span className="etag etag-new">no shift yet</span>}
        </div>
      </div>
      <div className="erow-res">
        <span className="erow-res-n">{resCount(ev)}</span>
        <span className="erow-res-l">{resCount(ev) === 1 ? 'res' : 'res'}{cancelledCt ? ` · ${cancelledCt}✕` : ''}</span>
      </div>
      <CapBar ev={ev} />
    </button>
  );
}

function EventList({ events, selectedId, onSelect, boat, setBoat, query, setQuery, onImport, lastSync }) {
  const q = query.trim().toLowerCase();
  const filtered = events
    .filter((ev) => boat === 'all' || ev.boatId === boat)
    .filter((ev) => !q
      || boatName(ev.boatId).toLowerCase().includes(q)
      || ev.label.toLowerCase().includes(q)
      || ev.reservations.some((r) => r.customer.toLowerCase().includes(q)));

  // group by date
  const byDate = {};
  filtered.forEach((ev) => { (byDate[ev.date] = byDate[ev.date] || []).push(ev); });
  const dates = Object.keys(byDate).sort();
  dates.forEach((d) => byDate[d].sort((a, b) => a.time.localeCompare(b.time)));

  const totEvents = filtered.length;
  const totRes = filtered.reduce((s, ev) => s + resCount(ev), 0);
  const totPax = filtered.reduce((s, ev) => s + paxTotal(ev), 0);

  return (
    <div className="elist">
      <div className="elist-top">
        <div className="elist-summary">
          <div className="es-stat"><b>{totEvents}</b><span>events</span></div>
          <div className="es-stat"><b>{totRes}</b><span>reservations</span></div>
          <div className="es-stat"><b>{totPax}</b><span>pax booked</span></div>
          <div className="es-sync">
            <span className="es-sync-dot" />
            Last Xola sync · {lastSync}
          </div>
        </div>
        <div className="elist-tools">
          <div className="search">
            <span className="search-i">⌕</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search boat, time, or customer…" />
            {query && <button className="search-x" onClick={() => setQuery('')}>✕</button>}
          </div>
          <button className="btn btn-primary" onClick={onImport}>↑ Import CSV</button>
        </div>
        <div className="boat-filter">
          <button className={'bf' + (boat === 'all' ? ' on' : '')} onClick={() => setBoat('all')}>All boats</button>
          {ED.BOATS.map((b) => (
            <button key={b.id} className={'bf' + (boat === b.id ? ' on' : '')} onClick={() => setBoat(b.id)}>
              <span className="bf-dot" data-boat={b.id} />{b.name}
            </button>
          ))}
        </div>
      </div>

      <div className="elist-scroll">
        {dates.length === 0 && <div className="elist-empty">No events match this view.</div>}
        {dates.map((d) => (
          <div key={d} className="edate-group">
            <div className="edate-head">
              <span className="edate-label">{dateLabel(d)}</span>
              <span className="edate-meta">{byDate[d].length} {byDate[d].length === 1 ? 'event' : 'events'} · {byDate[d].reduce((s, ev) => s + paxTotal(ev), 0)} pax</span>
            </div>
            {byDate[d].map((ev) => (
              <EventRow key={ev.id} ev={ev} selected={ev.id === selectedId} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

window.EventList = EventList;
