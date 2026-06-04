// detail.jsx — right pane: the full per-person record + editing controls.
const { fmtDate, fmtShort, poolBlockReason, effectiveBand, effectiveScore, poolRank, BANDS } = window.MusterData;

// Manual thumb — Spink's editable reliability control (boost or floor band).
function ManualThumb({ person, onChange }) {
  const t = person.manualThumb;
  return (
    <div className="thumb">
      <div className="thumb-modes">
        <button className={'thumb-mode' + (t.kind === 'none' ? ' on' : '')} onClick={() => onChange({ kind: 'none' })}>None</button>
        <button className={'thumb-mode' + (t.kind === 'boost' ? ' on' : '')} onClick={() => onChange({ kind: 'boost' })}>▲ Boost</button>
        <button className={'thumb-mode' + (t.kind === 'floor' ? ' on' : '')} onClick={() => onChange({ kind: 'floor', band: t.band || 'High' })}>Floor</button>
      </div>
      {t.kind === 'floor' && (
        <div className="thumb-floor">
          <span className="thumb-floor-l">Never ranks below</span>
          <div className="seg seg-sm">
            {['Med', 'High'].map((b) => (
              <button key={b} className={'seg-b' + (t.band === b ? ' seg-on' : '')} onClick={() => onChange({ kind: 'floor', band: b })}>{b}</button>
            ))}
          </div>
        </div>
      )}
      <div className="thumb-hint">
        {t.kind === 'none' && 'Standing follows the computed score only.'}
        {t.kind === 'boost' && 'Nudged up the pool — gets more asks while you watch the trend.'}
        {t.kind === 'floor' && `Pinned: never ranks below ${t.band} in any pool, regardless of score dips.`}
      </div>
    </div>
  );
}

function PoolMembership({ person, people }) {
  if (person.ratings.length === 0) {
    return (
      <div className="pool-mem">
        <div className="pool-mem-row pool-mem-train">
          <window.TraineeChip />
          <span className="pool-mem-note">Rides a supernumerary seat to build hours. Not in any required-seat pool until rated.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="pool-mem">
      {person.ratings.map((seat) => {
        const block = poolBlockReason(person, seat);
        const r = !block ? poolRank(people, person, seat) : null;
        return (
          <div key={seat} className={'pool-mem-row' + (block ? ' pool-mem-out' : '')}>
            <span className={'chip chip-rating chip-' + seat}>{seat}</span>
            {block
              ? <span className="pool-mem-block">⊘ {block}</span>
              : <span className="pool-mem-note">In the {seat} pool{r ? <> · ranked <b>#{r.rank}</b> of {r.of}</> : ''}</span>}
          </div>
        );
      })}
    </div>
  );
}

function PersonDetail(props) {
  const { person, people, update, onDeactivateClick } = props;
  const [addingCred, setAddingCred] = React.useState(false);
  const [addingPto, setAddingPto] = React.useState(false);
  const band = effectiveBand(person);
  const cold = !person.reliability.history;

  const setField = (patch) => update(person.id, patch);
  const toggleRating = (r) => {
    const has = person.ratings.includes(r);
    setField({ ratings: has ? person.ratings.filter((x) => x !== r) : [...person.ratings, r] });
  };

  return (
    <div className={'detail' + (person.status === 'inactive' ? ' detail-inactive' : '')}>
      {/* Header */}
      <div className="d-head">
        <div className="d-head-l">
          <div className="d-name-row">
            <h2>{person.name}</h2>
            {person.status === 'inactive' && <span className="tag-inactive lg">inactive</span>}
          </div>
          <div className="d-contact">
            <window.Mono>{person.phone}</window.Mono>
            {person.email && <><span className="d-dot">·</span><window.Mono>{person.email}</window.Mono></>}
          </div>
        </div>
        <div className="d-head-r">
          <button
            className={'status-toggle' + (person.status === 'active' ? ' on' : '')}
            onClick={() => person.status === 'active' ? onDeactivateClick(person) : setField({ status: 'active' })}
          >
            <span className="status-knob" />
            {person.status === 'active' ? 'Active' : 'Inactive'}
          </button>
        </div>
      </div>

      <div className="d-scroll">
        {/* Ratings */}
        <window.Section title="Ratings">
          <div className="rate-edit">
            {['captain', 'mate'].map((r) => (
              <button key={r} className={'rate-b rate-' + r + (person.ratings.includes(r) ? ' on' : '')} onClick={() => toggleRating(r)}>
                <span className="rate-check">{person.ratings.includes(r) ? '✓' : '+'}</span>{r}
              </button>
            ))}
            {person.ratings.length === 0 && <span className="rate-train-note">No rating yet — trainee on a supernumerary seat. Add a rating to put them in that pool going forward.</span>}
          </div>
          <PoolMembership person={person} people={people} />
        </window.Section>

        {/* Reliability standing */}
        <window.Section title="Reliability standing">
          <div className="standing-block">
            <div className="standing-big">
              <window.Standing person={person} people={people} display={person.reliability.history ? 'score' : 'band'} />
              {cold
                ? <span className="standing-cold">No history yet — seated at neutral, mid-pool so they get tried.</span>
                : <span className="standing-sub">Computed from claim &amp; confirm history · read-only</span>}
            </div>
            {!cold && (
              <ul className="reasons">
                {person.reliability.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
          <window.Field label="Spink's thumb" hint="The score itself isn't hand-edited — this is your manual override on top of it.">
            <ManualThumb person={person} onChange={(mt) => setField({ manualThumb: mt })} />
          </window.Field>
        </window.Section>

        {/* Credentials */}
        <window.Section
          title="Credentials"
          action={!addingCred && <window.Btn size="s" onClick={() => setAddingCred(true)}>+ Add credential</window.Btn>}
        >
          <div className="creds">
            {person.credentials.length === 0 && <div className="empty-line">No credentials on file.</div>}
            {person.credentials.map((c, i) => (
              <window.CredRow key={i} cred={c}
                onRemove={() => setField({ credentials: person.credentials.filter((_, j) => j !== i) })} />
            ))}
            {addingCred && (
              <window.AddCredForm
                onCancel={() => setAddingCred(false)}
                onAdd={(c) => { setField({ credentials: [...person.credentials, c] }); setAddingCred(false); }}
              />
            )}
          </div>
          <div className="creds-foot">MMC gates captain seats (5-yr renewal). Medical &amp; TWIC are tenant-configurable — BrewBoat runs MMC + Medical, TWIC where a facility demands it.</div>
        </window.Section>

        {/* Availability suppressions */}
        <window.Section
          title="Availability"
          action={!addingPto && <window.Btn size="s" onClick={() => setAddingPto(true)}>+ Add PTO / blackout</window.Btn>}
        >
          <div className="supp">
            {person.suppressions.length === 0 && (
              <div className="empty-line">No suppressions — available by default. Muster never asks crew to keep a calendar; absence of a blackout means available.</div>
            )}
            {person.suppressions.map((s) => (
              <div key={s.id} className="supp-row">
                <span className="supp-dates"><window.Mono>{fmtShort(s.start)} – {fmtShort(s.end)}</window.Mono></span>
                <span className="supp-reason">{s.reason || 'PTO'}</span>
                <button className="cred-x" title="Remove window"
                  onClick={() => setField({ suppressions: person.suppressions.filter((x) => x.id !== s.id) })}>✕</button>
              </div>
            ))}
            {addingPto && (
              <window.AddPtoForm
                onCancel={() => setAddingPto(false)}
                onAdd={(w) => { setField({ suppressions: [...person.suppressions, { id: 's' + Date.now(), ...w }] }); setAddingPto(false); }}
              />
            )}
          </div>
        </window.Section>

        {/* Protocol override */}
        <window.Section title="Assignment protocol">
          <div className="seg seg-wide">
            {[
              { id: 'default', label: 'Role default' },
              { id: 'ask-then-assign', label: 'Ask, then assign' },
              { id: 'assign-then-confirm', label: 'Assign, then confirm' },
            ].map((o) => (
              <button key={o.id} className={'seg-b' + (person.protocol === o.id ? ' seg-on' : '')} onClick={() => setField({ protocol: o.id })}>{o.label}</button>
            ))}
          </div>
          <div className="field-hint">Per-person override of the role default. Lives on the person because it's a per-person trait.</div>
        </window.Section>
      </div>
    </div>
  );
}

Object.assign(window, { PersonDetail });
