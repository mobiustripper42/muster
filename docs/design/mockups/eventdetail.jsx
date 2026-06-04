// eventdetail.jsx — right pane: the per-event reservation manifest + edits.
const EDD = window.EventData;
const { boatName, dateLabel, dayName, paxTotal, resCount, fillState } = EDD;

const shiftStateClass = (s) => 'ss-' + (s || '').toLowerCase().replace(/[^a-z]/g, '');

function AddResForm({ onAdd, onCancel }) {
  const [customer, setCustomer] = React.useState('');
  const [pax, setPax] = React.useState('2');
  const [phone, setPhone] = React.useState('');
  const ok = customer.trim() && +pax > 0;
  return (
    <div className="inline-form">
      <input className="inp inp-sm" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name" autoFocus />
      <input className="inp inp-sm pax-inp" type="number" min="1" value={pax} onChange={(e) => setPax(e.target.value)} title="Party size" />
      <input className="inp inp-sm" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
      <button className="btn btn-primary btn-s" disabled={!ok} onClick={() => onAdd({ customer: customer.trim(), pax: +pax, phone: phone.trim() })}>Add</button>
      <button className="btn btn-s" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function EditEventForm({ ev, onSave, onCancel }) {
  const [label, setLabel] = React.useState(ev.label);
  const [cap, setCap] = React.useState(String(ev.capacity));
  return (
    <div className="inline-form edit-event">
      <label className="mini-label">time</label>
      <input className="inp inp-sm" value={label} onChange={(e) => setLabel(e.target.value)} />
      <label className="mini-label">capacity</label>
      <input className="inp inp-sm pax-inp" type="number" min="1" value={cap} onChange={(e) => setCap(e.target.value)} />
      <button className="btn btn-primary btn-s" onClick={() => onSave({ label: label.trim(), capacity: +cap })}>Save</button>
      <button className="btn btn-s" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function EventDetail({ ev, update }) {
  const [addingRes, setAddingRes] = React.useState(false);
  const [editingEv, setEditingEv] = React.useState(false);
  const pax = paxTotal(ev);
  const st = fillState(ev);
  const setEv = (patch) => update(ev.id, patch);

  const addRes = (r) => {
    setEv({ reservations: [...ev.reservations, { id: 'r' + Date.now(), source: 'manual', status: 'active', ...r }] });
    setAddingRes(false);
  };
  const cancelRes = (rid) => setEv({ reservations: ev.reservations.map((r) => r.id === rid ? { ...r, status: 'cancelled' } : r) });
  const restoreRes = (rid) => setEv({ reservations: ev.reservations.map((r) => r.id === rid ? { ...r, status: 'active' } : r) });
  const saveEvent = (patch) => {
    // Editing a formed event flags its shift for re-review (propagation nudge).
    setEv({ ...patch, editedAfterShift: ev.shift ? true : ev.editedAfterShift });
    setEditingEv(false);
  };

  return (
    <div className="edetail">
      <div className="ed-head">
        <div>
          <div className="ed-eyebrow">
            <span className="erow-boat-dot lg" data-boat={ev.boatId} />
            {boatName(ev.boatId)} · {dayName(ev.date)}
            {ev.source === 'manual' && <span className="etag etag-manual">manual event</span>}
          </div>
          <h2>{ev.label}</h2>
          <div className="ed-sub">{dateLabel(ev.date)}</div>
        </div>
        <div className="ed-cap">
          <div className={'ed-cap-n cf-text-' + st}>{pax}<span>/{ev.capacity}</span></div>
          <div className="ed-cap-l">{st === 'full' ? 'at capacity' : 'pax booked'}</div>
        </div>
      </div>

      <div className="ed-scroll">
        {/* Shift link + edited nudge */}
        <div className="ed-shiftbar">
          {ev.shift ? (
            <div className="ed-shift">
              <span className="ed-shift-l">Rolls into</span>
              <span className="ed-shift-name">{ev.shift.label}</span>
              <span className={'shift-state ' + shiftStateClass(ev.shift.state)}>{ev.shift.state}</span>
            </div>
          ) : (
            <div className="ed-shift muted"><span className="ed-shift-l">Not yet rolled into a shift</span></div>
          )}
          <button className="btn btn-s" onClick={() => setEditingEv((v) => !v)}>Edit event</button>
        </div>

        {editingEv && <EditEventForm ev={ev} onSave={saveEvent} onCancel={() => setEditingEv(false)} />}

        {ev.editedAfterShift && (
          <div className="ed-nudge">
            <span className="ed-nudge-i">!</span>
            This event changed after its shift was built — <b>{ev.shift ? ev.shift.label : 'the shift'}</b> is flagged for re-review in the shift builder.
          </div>
        )}

        {/* Manifest */}
        <section className="ed-section">
          <div className="ed-section-head">
            <h3>Reservations <span className="ed-count">{resCount(ev)} active · {pax} pax</span></h3>
            {!addingRes && <button className="btn btn-s" onClick={() => setAddingRes(true)}>+ Add reservation</button>}
          </div>

          <div className="manifest-head">
            <span>Customer</span><span>Party</span><span>Phone</span><span></span>
          </div>
          <div className="manifest">
            {ev.reservations.length === 0 && <div className="empty-line">No reservations on this event.</div>}
            {ev.reservations.map((r) => (
              <div key={r.id} className={'mres' + (r.status === 'cancelled' ? ' mres-cancelled' : '')}>
                <div className="mres-cust">
                  {r.customer}
                  {r.source === 'manual' && <span className="etag etag-manual">manual</span>}
                  {r.conflict && <span className="etag etag-conflict" title="Differs from latest Xola import — manual kept, conflict flagged">merge conflict</span>}
                  {r.status === 'cancelled' && <span className="etag etag-cancelled">cancelled</span>}
                </div>
                <div className="mres-pax"><b>{r.pax}</b></div>
                <div className="mres-phone mono">{r.phone}</div>
                <div className="mres-act">
                  {r.status === 'active'
                    ? <button className="mini-x" title="Cancel reservation" onClick={() => cancelRes(r.id)}>Cancel</button>
                    : <button className="mini-x restore" title="Restore" onClick={() => restoreRes(r.id)}>Restore</button>}
                </div>
              </div>
            ))}
            {addingRes && <AddResForm onAdd={addRes} onCancel={() => setAddingRes(false)} />}
          </div>
          <div className="manifest-foot">This is the manifest the crew shift card reads (§2.6) — name &amp; phone only; no waiver field is needed for crew.</div>
        </section>
      </div>
    </div>
  );
}

window.EventDetail = EventDetail;
