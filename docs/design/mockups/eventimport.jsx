// eventimport.jsx — CSV import / reconcile modal with result report.
const EID = window.EventData;

function ImportModal({ onClose, onApply }) {
  const [stage, setStage] = React.useState('ready'); // ready → reconciling → result
  const R = EID.IMPORT_RESULT;
  const F = EID.IMPORT_FILE;

  React.useEffect(() => {
    if (stage === 'reconciling') {
      const t = setTimeout(() => setStage('result'), 900);
      return () => clearTimeout(t);
    }
  }, [stage]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Import events &amp; reservations</h2>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {stage !== 'result' && (
            <>
              <p className="modal-note">Bulk import from the Xola CSV bridge (~1–2×/week). Existing events &amp; reservations are reconciled in place — changed rows update, cancellations mark cancelled, nothing duplicates. Hand-added entries are preserved (manual wins; conflicts flagged).</p>
              <div className="file-chip">
                <span className="file-ic">CSV</span>
                <div className="file-meta">
                  <div className="file-name">{F.name}</div>
                  <div className="file-rows">{F.rows.toLocaleString()} rows</div>
                </div>
                <span className="file-x">change</span>
              </div>
            </>
          )}

          {stage === 'reconciling' && (
            <div className="reconciling"><span className="spinner" /> Reconciling against existing events…</div>
          )}

          {stage === 'result' && (
            <div className="import-result">
              <div className="ir-grid">
                <div className="ir-card ir-add"><b>+{R.addedEvents}</b><span>events added</span></div>
                <div className="ir-card ir-add"><b>+{R.addedRes}</b><span>reservations added</span></div>
                <div className="ir-card ir-upd"><b>{R.updatedRes}</b><span>updated in place</span></div>
                <div className="ir-card ir-cancel"><b>{R.cancelledRes}</b><span>cancelled in Xola</span></div>
                <div className="ir-card ir-skip"><b>{R.unchanged}</b><span>unchanged</span></div>
                <div className="ir-card ir-manual"><b>{R.manualPreserved}</b><span>manual kept</span></div>
              </div>

              <div className="ir-merge">
                <span className="ir-merge-i">⚑</span>
                <div>
                  <b>{R.conflicts} merge conflict</b> — a hand-added reservation differs from the incoming row.
                  Per the merge rule, the <b>manual entry wins</b> and the conflict is flagged on the event for you to reconcile. <span className="ir-open-q">Final merge policy is still open (default: manual wins).</span>
                </div>
              </div>

              <div className="ir-unparsed">
                <div className="ir-unparsed-head">
                  <span className="ir-warn-dot" />
                  {R.unparseable.length} rows couldn't be parsed — fix and re-import (not dropped)
                </div>
                {R.unparseable.map((u) => (
                  <div key={u.row} className="ir-badrow">
                    <span className="ir-rownum mono">row {u.row}</span>
                    <span className="ir-raw mono">{u.raw}</span>
                    <span className="ir-reason">{u.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {stage === 'ready' && (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setStage('reconciling')}>Reconcile &amp; import</button>
            </>
          )}
          {stage === 'reconciling' && <button className="btn" disabled>Working…</button>}
          {stage === 'result' && (
            <>
              <button className="btn" onClick={onClose}>Close without applying</button>
              <button className="btn btn-primary" onClick={() => onApply(R)}>Apply import</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

window.ImportModal = ImportModal;
