// riskdata.jsx — At-Risk Board substrate. The bar to land here is HIGH:
// only Tiers-1–2-exhausted, regressions, or credential lapses. Warming never lands here.
const R_NOW = new Date('2026-06-03T08:00:00');

function hoursToTrip(iso) { return Math.round((new Date(iso) - R_NOW) / 3600000); }
function ttLabel(h) {
  if (h < 24) return `${h}h to trip`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d}d ${r}h to trip`;
}

// kind: 'regression' | 'atrisk' | 'credential'
const RISK_SHIFTS = [
  {
    id: 'tw-thu', kind: 'regression',
    boat: 'Mash Tun', boatId: 'mt', tripISO: '2026-06-04T17:00:00',
    dayLabel: 'Thu · Jun 4', trips: ['5:00 PM'],
    missing: [{ role: 'mate' }],
    lostCrew: { name: 'Cody Ahn', role: 'mate', when: 'bailed 11:04 PM last night' },
    fillsBy: 'Thu 9:00 AM',
    trail: { asked: 3, declined: 2, silent: 1, widened: true, nudged: [], exhausted: true,
      note: 'Overnight refill failed — pool too thin at this hour.' },
    available: [{ name: 'Theo Marsh', band: 'Med', note: 'not yet asked · improving' }],
    reservations: [
      { customer: 'Brewer', pax: 2 }, { customer: 'Cole', pax: 2 }, { customer: 'Patel', pax: 2 },
    ],
    refund: 'full refund (>24h policy)',
  },
  {
    id: 'tw-sat', kind: 'atrisk',
    boat: 'Tidewater', boatId: 'tw', tripISO: '2026-06-06T12:00:00',
    dayLabel: 'Sat · Jun 6', trips: ['12:00 PM', '4:00 PM'],
    missing: [{ role: 'captain' }],
    fillsBy: 'Fri 6:00 PM',
    trail: { asked: 5, declined: 3, silent: 1, widened: true, nudged: ['Hank Brouwer'], exhausted: true,
      note: 'Captain pool is small and fickle — every eligible name asked.' },
    available: [],
    reservations: [
      { customer: 'Donnelly', pax: 4 }, { customer: 'Reyes', pax: 2 }, { customer: 'Whitlock', pax: 3 },
      { customer: 'Kowalski', pax: 2 }, { customer: 'Ferreira', pax: 4 }, { customer: 'Lind', pax: 2 },
      { customer: 'Abara', pax: 3 },
    ],
    refund: 'full refund (>24h policy)',
  },
  {
    id: 'mt-sun', kind: 'atrisk',
    boat: 'Mash Tun', boatId: 'mt', tripISO: '2026-06-07T13:00:00',
    dayLabel: 'Sun · Jun 7', trips: ['1:00 PM'],
    missing: [{ role: 'mate' }],
    fillsBy: 'Sat 1:00 PM',
    trail: { asked: 4, declined: 2, silent: 2, widened: false, nudged: [], exhausted: true,
      note: 'Two mates went silent — pool exhausted for now.' },
    available: [{ name: 'Will Stearns', band: 'High', note: 'frees up if Sat captaining resolves' }],
    reservations: [{ customer: 'Tran', pax: 2 }, { customer: 'Mercer', pax: 2 }],
    refund: 'full refund (>24h policy)',
  },
  {
    id: 'tw-jun13', kind: 'credential',
    boat: 'Tidewater', boatId: 'tw', tripISO: '2026-06-13T13:00:00',
    dayLabel: 'Sat · Jun 13', trips: ['1:00 PM', '4:00 PM'],
    missing: [{ role: 'captain', reason: 'assignment invalidated' }],
    credLapse: { name: 'Gus Hallman', cred: 'MMC', detail: 'expires before trip date — not date-valid' },
    fillsBy: 'Fri Jun 12, 6:00 PM',
    trail: { asked: 0, declined: 0, silent: 0, widened: false, nudged: [], exhausted: false,
      note: 'Caught early by the date-valid check — plenty of runway to re-crew.' },
    available: [{ name: 'Marisol Vega', band: 'High', note: 'eligible · not yet asked' }, { name: 'Will Stearns', band: 'High', note: 'eligible' }],
    reservations: [{ customer: 'Underwood', pax: 4 }, { customer: 'Sosa', pax: 2 }, { customer: 'Daley', pax: 3 }],
    refund: 'full refund (>24h policy)',
  },
];

// reschedule candidate slots (crewable shown distinctly)
const RESLOTS = {
  'tw-thu': [
    { label: 'Fri Jun 5 · 5:00 PM', crewable: true, note: 'mate pool open' },
    { label: 'Sat Jun 6 · 11:00 AM', crewable: true, note: 'mate available' },
    { label: 'Thu Jun 4 · 7:00 PM', crewable: false, note: 'same thin pool' },
  ],
  'tw-sat': [
    { label: 'Sun Jun 7 · 12:00 PM', crewable: true, note: 'captain available' },
    { label: 'Sat Jun 6 · 6:00 PM', crewable: false, note: 'still no captain' },
  ],
  'mt-sun': [
    { label: 'Mon Jun 8 · 1:00 PM', crewable: true, note: 'mate available' },
  ],
  'tw-jun13': [
    { label: 'Sun Jun 14 · 1:00 PM', crewable: true, note: 'captain eligible' },
  ],
};

// urgency: regression rockets to top; else time-to-trip dominates, severity tiebreak, thin pool bonus
function urgency(s) {
  const sev = s.missing.some((m) => m.role === 'captain') ? 3 : 2;
  const thin = s.available.length === 0 ? 6 : 0;
  const base = -hoursToTrip(s.tripISO) + sev + thin;
  return (s.kind === 'regression' ? 100000 : 0) + base;
}

window.RiskData = { R_NOW, RISK_SHIFTS, RESLOTS, hoursToTrip, ttLabel, urgency };
