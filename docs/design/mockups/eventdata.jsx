// eventdata.jsx — Event Admin substrate: boats, events, reservations + import sim.
const E_TODAY = new Date('2026-06-03T08:00:00');

function eDate(s) { return new Date(s + 'T00:00:00'); }
function dateLabel(s) {
  const d = eDate(s);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function dayName(s) { return eDate(s).toLocaleDateString('en-US', { weekday: 'long' }); }

const BOATS = [
  { id: 'mt', name: 'Mash Tun', cap: 6 },
  { id: 'tw', name: 'Tidewater', cap: 12 },
];
const boatName = (id) => (BOATS.find((b) => b.id === id) || {}).name || id;

// reservation: { id, customer, pax, phone, source:'csv'|'manual', status:'active'|'cancelled', conflict? }
// event: { id, boatId, date, time(24h), label, capacity, source, shift:{label,state}|null,
//          editedAfterShift, reservations:[...] }
const EVENTS = [
  {
    id: 'e1', boatId: 'tw', date: '2026-06-05', time: '17:00', label: '5:00 PM', capacity: 12,
    source: 'csv', shift: { label: 'Tidewater · Fri Jun 5', state: 'Crewed' }, editedAfterShift: false,
    reservations: [
      { id: 'r1', customer: 'Halvorsen (corporate)', pax: 10, phone: '(206) 555-0310', source: 'csv', status: 'active' },
    ],
  },
  {
    id: 'e2', boatId: 'mt', date: '2026-06-06', time: '11:00', label: '11:00 AM', capacity: 6,
    source: 'csv', shift: { label: 'Mash Tun · Sat Jun 6', state: 'Crewed' }, editedAfterShift: false,
    reservations: [
      { id: 'r2', customer: 'Smith', pax: 4, phone: '(206) 555-0118', source: 'csv', status: 'active' },
      { id: 'r3', customer: 'Alvarez', pax: 2, phone: '(360) 555-0145', source: 'csv', status: 'active' },
    ],
  },
  {
    id: 'e3', boatId: 'mt', date: '2026-06-06', time: '13:00', label: '1:00 PM', capacity: 6,
    source: 'csv', shift: { label: 'Mash Tun · Sat Jun 6', state: 'Crewed' }, editedAfterShift: false,
    reservations: [
      { id: 'r4', customer: 'Nguyen', pax: 2, phone: '(425) 555-0166', source: 'csv', status: 'active' },
      { id: 'r5', customer: 'Okafor', pax: 1, phone: '(206) 555-0151', source: 'csv', status: 'cancelled' },
    ],
  },
  {
    id: 'e4', boatId: 'mt', date: '2026-06-06', time: '15:00', label: '3:00 PM', capacity: 6,
    source: 'csv', shift: { label: 'Mash Tun · Sat Jun 6', state: 'Crewed' }, editedAfterShift: true,
    reservations: [
      { id: 'r6', customer: 'Brewer', pax: 2, phone: '(253) 555-0190', source: 'csv', status: 'active' },
      { id: 'r7', customer: 'Cole', pax: 2, phone: '(206) 555-0172', source: 'csv', status: 'active' },
      { id: 'r8', customer: 'Patel', pax: 2, phone: '(360) 555-0133', source: 'manual', status: 'active', conflict: true },
    ],
  },
  {
    id: 'e5', boatId: 'tw', date: '2026-06-06', time: '12:00', label: '12:00 PM', capacity: 12,
    source: 'csv', shift: { label: 'Tidewater · Sat Jun 6', state: 'Filling' }, editedAfterShift: false,
    reservations: [
      { id: 'r9', customer: 'Donnelly', pax: 4, phone: '(206) 555-0201', source: 'csv', status: 'active' },
      { id: 'r10', customer: 'Reyes', pax: 2, phone: '(425) 555-0188', source: 'csv', status: 'active' },
      { id: 'r11', customer: 'Whitlock', pax: 3, phone: '(360) 555-0119', source: 'csv', status: 'active' },
    ],
  },
  {
    id: 'e6', boatId: 'tw', date: '2026-06-06', time: '16:00', label: '4:00 PM (sunset)', capacity: 12,
    source: 'csv', shift: { label: 'Tidewater · Sat Jun 6', state: 'Filling' }, editedAfterShift: false,
    reservations: [
      { id: 'r12', customer: 'Kowalski', pax: 2, phone: '(206) 555-0144', source: 'csv', status: 'active' },
      { id: 'r13', customer: 'Ferreira', pax: 4, phone: '(253) 555-0177', source: 'csv', status: 'active' },
      { id: 'r14', customer: 'Lind', pax: 2, phone: '(360) 555-0162', source: 'csv', status: 'active' },
      { id: 'r15', customer: 'Abara', pax: 3, phone: '(206) 555-0129', source: 'csv', status: 'active' },
    ],
  },
  {
    id: 'e7', boatId: 'mt', date: '2026-06-07', time: '13:00', label: '1:00 PM', capacity: 6,
    source: 'csv', shift: { label: 'Mash Tun · Sun Jun 7', state: 'Pending' }, editedAfterShift: false,
    reservations: [
      { id: 'r16', customer: 'Tran', pax: 2, phone: '(425) 555-0103', source: 'csv', status: 'active' },
      { id: 'r17', customer: 'Mercer', pax: 2, phone: '(206) 555-0156', source: 'csv', status: 'active' },
    ],
  },
  {
    id: 'e8', boatId: 'tw', date: '2026-06-07', time: '14:00', label: '2:00 PM', capacity: 12,
    source: 'manual', shift: null, editedAfterShift: false,
    reservations: [
      { id: 'r18', customer: 'Petersen (added by phone)', pax: 6, phone: '(360) 555-0114', source: 'manual', status: 'active' },
    ],
  },
];

// ---- derivations ----
const paxTotal = (ev) => ev.reservations.filter((r) => r.status === 'active').reduce((s, r) => s + r.pax, 0);
const resCount = (ev) => ev.reservations.filter((r) => r.status === 'active').length;
function fillState(ev) {
  const p = paxTotal(ev);
  if (p >= ev.capacity) return 'full';
  if (p >= ev.capacity * 0.75) return 'high';
  return 'open';
}

// Simulated re-import result against a real-ish Xola export.
const IMPORT_FILE = { name: 'xola_export_2026-06-03.csv', rows: 1204 };
const IMPORT_RESULT = {
  addedEvents: 4,
  addedRes: 9,
  updatedRes: 3,      // changed party size / time — reconciled in place
  cancelledRes: 2,    // cancelled in Xola
  unchanged: 51,
  manualPreserved: 1, // hand-added entries kept
  conflicts: 1,       // manual vs incoming — manual wins, flagged
  unparseable: [
    { row: 1187, raw: 'Tidewater,2026-06-13,"4 PM",,Garcia,(206)555-0210', reason: 'Missing party size' },
    { row: 1192, raw: 'Mash Tun,06/14/26,1:00 PM,2,Boyd,5550199', reason: 'Unrecognized date format' },
  ],
  // New events injected on Apply (so re-import is visibly reconciled, not duplicated).
  newEvents: [
    {
      id: 'e9', boatId: 'tw', date: '2026-06-07', time: '11:00', label: '11:00 AM', capacity: 12,
      source: 'csv', shift: null, editedAfterShift: false,
      reservations: [
        { id: 'r19', customer: 'Underwood', pax: 4, phone: '(206) 555-0224', source: 'csv', status: 'active' },
        { id: 'r20', customer: 'Sosa', pax: 2, phone: '(360) 555-0231', source: 'csv', status: 'active' },
      ],
    },
    {
      id: 'e10', boatId: 'mt', date: '2026-06-07', time: '15:00', label: '3:00 PM', capacity: 6,
      source: 'csv', shift: null, editedAfterShift: false,
      reservations: [
        { id: 'r21', customer: 'Daley', pax: 3, phone: '(425) 555-0240', source: 'csv', status: 'active' },
      ],
    },
  ],
};

window.EventData = {
  E_TODAY, BOATS, EVENTS, boatName, dateLabel, dayName, eDate,
  paxTotal, resCount, fillState, IMPORT_FILE, IMPORT_RESULT,
};
