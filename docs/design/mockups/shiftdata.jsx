// shiftdata.jsx — Shift Builder substrate: auto-formed shifts, COI seats, horizon.
const S_TODAY = new Date('2026-06-03T08:00:00');
const HORIZON_DAYS = 7; // staffing horizon: asks fire when a locked shift is within this window

function sDate(s) { return new Date(s + 'T00:00:00'); }
function sDaysOut(s) { return Math.round((sDate(s) - S_TODAY) / 86400000); }
function insideHorizon(s) { const d = sDaysOut(s); return d >= 0 && d <= HORIZON_DAYS; }
function sDateLabel(s) { return sDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
function sDayLong(s) { return sDate(s).toLocaleDateString('en-US', { weekday: 'long' }); }

const S_BOATS = [
  { id: 'mt', name: 'Mash Tun', coiMax: 6 },   // COI: 1 captain + 1 mate, max 6 pax
  { id: 'tw', name: 'Tidewater', coiMax: 12 },
];
const sBoat = (id) => S_BOATS.find((b) => b.id === id) || {};

// seat: { role:'captain'|'mate', kind:'required'|'hand'|'super', state, who }
// seat states: Open → Asked → Claimed → Confirmed → Bailed
function reqSeats() {
  return [
    { id: 'cap', role: 'captain', kind: 'required', state: 'Open', who: null },
    { id: 'mate', role: 'mate', kind: 'required', state: 'Open', who: null },
  ];
}

const SHIFTS = [
  {
    id: 'sh1', boatId: 'tw', date: '2026-06-05',
    trips: [{ time: '17:00', label: '5:00 PM', pax: 10, res: 1, note: 'corporate charter' }],
    seats: [
      { id: 'cap', role: 'captain', kind: 'required', state: 'Confirmed', who: 'Will Stearns' },
      { id: 'mate', role: 'mate', kind: 'required', state: 'Open', who: null, reopened: 'Cody Ahn bailed' },
    ],
    crewState: 'At-Risk', locked: true, changedSinceReview: false, isNew: false,
  },
  {
    id: 'sh2', boatId: 'mt', date: '2026-06-06',
    trips: [
      { time: '11:00', label: '11:00 AM', pax: 6, res: 2 },
      { time: '13:00', label: '1:00 PM', pax: 2, res: 1 },
      { time: '15:00', label: '3:00 PM', pax: 6, res: 3 },
    ],
    seats: [
      { id: 'cap', role: 'captain', kind: 'required', state: 'Confirmed', who: 'Dale Toomey' },
      { id: 'mate', role: 'mate', kind: 'required', state: 'Confirmed', who: 'Petra Lindqvist' },
    ],
    crewState: 'Crewed', locked: true, changedSinceReview: true, isNew: false,
    changeNote: '3:00 PM trip time changed in Event Admin after lock',
  },
  {
    id: 'sh3', boatId: 'tw', date: '2026-06-06',
    trips: [
      { time: '12:00', label: '12:00 PM', pax: 9, res: 3 },
      { time: '16:00', label: '4:00 PM', pax: 11, res: 4, note: 'sunset — near capacity' },
    ],
    seats: [
      { id: 'cap', role: 'captain', kind: 'required', state: 'Asked', who: 'Marisol Vega' },
      { id: 'mate', role: 'mate', kind: 'required', state: 'Open', who: null },
    ],
    crewState: 'Filling', locked: false, changedSinceReview: false, isNew: false,
  },
  {
    id: 'sh4', boatId: 'mt', date: '2026-06-07',
    trips: [{ time: '13:00', label: '1:00 PM', pax: 4, res: 2 }],
    seats: reqSeats(),
    crewState: 'Pending', locked: false, changedSinceReview: false, isNew: false,
  },
  {
    id: 'sh5', boatId: 'tw', date: '2026-06-07',
    trips: [{ time: '14:00', label: '2:00 PM', pax: 6, res: 1, note: 'added by phone' }],
    seats: reqSeats(),
    crewState: 'Pending', locked: false, changedSinceReview: false, isNew: true,
  },
  {
    id: 'sh6', boatId: 'tw', date: '2026-06-13',
    trips: [
      { time: '13:00', label: '1:00 PM', pax: 5, res: 2 },
      { time: '16:00', label: '4:00 PM', pax: 8, res: 3 },
    ],
    seats: reqSeats(),
    crewState: 'Pending', locked: false, changedSinceReview: false, isNew: false,
  },
];

const RANGES = [
  { id: 'this', label: 'This weekend', sub: 'Jun 5–7', test: (d) => d >= '2026-06-05' && d <= '2026-06-07' },
  { id: 'next', label: 'Next weekend', sub: 'Jun 13–14', test: (d) => d >= '2026-06-12' && d <= '2026-06-14' },
  { id: 'all', label: 'All', sub: '', test: () => true },
];

// ---- derivations ----
const requiredSeats = (sh) => sh.seats.filter((s) => s.kind === 'required' || s.kind === 'hand');
const superSeats = (sh) => sh.seats.filter((s) => s.kind === 'super');
const gateMet = (sh) => requiredSeats(sh).every((s) => s.state === 'Confirmed');
const shiftPax = (sh) => sh.trips.reduce((s, t) => s + t.pax, 0);
const effMaxPax = (sh) => sBoat(sh.boatId).coiMax - superSeats(sh).length;

window.ShiftData = {
  S_TODAY, HORIZON_DAYS, S_BOATS, SHIFTS, RANGES,
  sBoat, sDate, sDaysOut, insideHorizon, sDateLabel, sDayLong, reqSeats,
  requiredSeats, superSeats, gateMet, shiftPax, effMaxPax,
};
