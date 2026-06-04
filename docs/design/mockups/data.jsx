// data.jsx — Muster Crew Roster seed substrate + derivations.
// "Today" is pinned so credential health is deterministic in the demo.
const TODAY = new Date('2026-06-03T08:00:00');

// ---- date helpers -------------------------------------------------
function parseD(s) { return new Date(s + 'T00:00:00'); }
function daysBetween(a, b) { return Math.round((a - b) / 86400000); }
function fmtDate(s) {
  if (!s) return '—';
  const d = parseD(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShort(s) {
  const d = parseD(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Credential health relative to TODAY. soon = within 45 days.
const SOON_WINDOW = 45;
function credHealth(cred) {
  const exp = parseD(cred.expiry);
  const d = daysBetween(exp, TODAY);
  if (d < 0) return { state: 'expired', days: d };
  if (d <= SOON_WINDOW) return { state: 'soon', days: d };
  return { state: 'valid', days: d };
}
// Worst health across a person's credentials → the list-level flag.
function personHealth(p) {
  let worst = 'valid';
  const order = { valid: 0, soon: 1, expired: 2 };
  for (const c of p.credentials) {
    const h = credHealth(c).state;
    if (order[h] > order[worst]) worst = h;
  }
  return worst;
}
// Does this person currently hold a valid (non-expired) credential of type?
function hasValid(p, type) {
  const c = p.credentials.find((c) => c.type === type);
  return c && credHealth(c).state !== 'expired';
}

// Eligibility for a seat-type's pool, at list level (ignores per-date suppression).
// captain seat → rated captain + valid MMC. mate seat → rated mate + valid Medical.
function poolEligible(p, seat) {
  if (p.status !== 'active') return false;
  if (!p.ratings.includes(seat)) return false;
  if (seat === 'captain' && !hasValid(p, 'MMC')) return false;
  if (seat === 'mate' && !hasValid(p, 'Medical')) return false;
  return true;
}
// Human reason a rated person is NOT in a pool (for the detail panel).
function poolBlockReason(p, seat) {
  if (p.status !== 'active') return 'Inactive — held out of all future pools';
  if (seat === 'captain' && !hasValid(p, 'MMC')) return 'MMC lapsed — out of the captain pool';
  if (seat === 'mate' && !hasValid(p, 'Medical')) return 'Medical lapsed — out of the mate pool';
  return null;
}

// Band from score; floor pins it up. New crew (history:false) → 'New'.
const BANDS = ['Low', 'Med', 'High'];
function rawBand(score) { return score >= 78 ? 'High' : score >= 55 ? 'Med' : 'Low'; }
function effectiveBand(p) {
  if (!p.reliability.history) return 'New';
  let b = rawBand(p.reliability.score);
  const floor = p.manualThumb.kind === 'floor' ? p.manualThumb.band : null;
  if (floor && BANDS.indexOf(floor) > BANDS.indexOf(b)) return floor;
  return b;
}
// Effective sort score: boost adds, floor lifts to its band minimum.
function effectiveScore(p) {
  if (!p.reliability.history) return 64; // neutral mid-pool — gets tried
  let s = p.reliability.score;
  if (p.manualThumb.kind === 'boost') s = Math.min(100, s + 12);
  if (p.manualThumb.kind === 'floor') {
    const floorMin = { High: 78, Med: 55, Low: 0 }[p.manualThumb.band] ?? 0;
    s = Math.max(s, floorMin + 1);
  }
  return s;
}
// Ordering within a seat pool, e.g. "#2 of captains".
function poolRank(people, person, seat) {
  const pool = people
    .filter((p) => poolEligible(p, seat))
    .sort((a, b) => effectiveScore(b) - effectiveScore(a));
  const idx = pool.findIndex((p) => p.id === person.id);
  return idx < 0 ? null : { rank: idx + 1, of: pool.length };
}

// ---- seed crew ----------------------------------------------------
// Salty BrewBoat crew. Ratings: captain / mate / both / [] (trainee).
const SEED = [
  {
    id: 'c01', name: 'Dale Toomey', phone: '(206) 555-0142', email: 'dale.toomey@brewboat.co',
    ratings: ['captain', 'mate'],
    credentials: [
      { type: 'MMC', id: 'MMC-4471902', expiry: '2029-03-31' },
      { type: 'Medical', id: 'MED-88321', expiry: '2027-11-12' },
    ],
    manualThumb: { kind: 'none' },
    suppressions: [],
    protocol: 'default',
    status: 'active',
    reliability: { history: true, score: 94, reasons: ['Confirmed 23 of last 24 asks', 'Never bailed this season', 'Usually claims within the hour'] },
    futureAssignments: [],
  },
  {
    id: 'c02', name: 'Marisol Vega', phone: '(206) 555-0188', email: 'mvega@brewboat.co',
    ratings: ['captain'],
    credentials: [
      { type: 'MMC', id: 'MMC-5523117', expiry: '2028-08-19' },
      { type: 'Medical', id: 'MED-90114', expiry: '2026-07-10' }, // expiring soon
    ],
    manualThumb: { kind: 'none' },
    suppressions: [],
    protocol: 'ask-then-assign',
    status: 'active',
    reliability: { history: true, score: 81, reasons: ['Confirmed 11 of last 12 asks', 'Fast to claim weekend trips'] },
    futureAssignments: [],
  },
  {
    id: 'c03', name: 'Gus Hallman', phone: '(360) 555-0107', email: 'gus.hallman@brewboat.co',
    ratings: ['captain'],
    credentials: [
      { type: 'MMC', id: 'MMC-3310874', expiry: '2026-05-20' }, // EXPIRED — out of captain pool
      { type: 'Medical', id: 'MED-77450', expiry: '2027-02-28' },
    ],
    manualThumb: { kind: 'none' },
    suppressions: [],
    protocol: 'default',
    status: 'active',
    reliability: { history: true, score: 72, reasons: ['Solid when aboard', 'MMC renewal not yet filed'] },
    futureAssignments: [],
  },
  {
    id: 'c04', name: 'Hank Brouwer', phone: '(206) 555-0150', email: 'hbrouwer@brewboat.co',
    ratings: ['captain', 'mate'],
    credentials: [
      { type: 'MMC', id: 'MMC-2298140', expiry: '2027-06-30' },
      { type: 'Medical', id: 'MED-66120', expiry: '2027-06-30' },
    ],
    manualThumb: { kind: 'floor', band: 'High' }, // Spink's thumb: veteran, pin high
    suppressions: [],
    protocol: 'assign-then-confirm',
    status: 'active',
    reliability: { history: true, score: 68, reasons: ['30 years on this water', 'Slower to reply by text'] },
    futureAssignments: [],
  },
  {
    id: 'c05', name: 'Junior Okafor', phone: '(425) 555-0119', email: 'junior.okafor@brewboat.co',
    ratings: ['captain'],
    credentials: [
      { type: 'MMC', id: 'MMC-6640231', expiry: '2030-01-15' },
      { type: 'Medical', id: 'MED-51277', expiry: '2028-04-02' },
    ],
    manualThumb: { kind: 'none' },
    suppressions: [],
    protocol: 'default',
    status: 'active',
    reliability: { history: true, score: 63, reasons: ['2 late claims in last 30 days', 'No bails'] },
    futureAssignments: [],
  },
  {
    id: 'c06', name: 'Petra Lindqvist', phone: '(206) 555-0166', email: 'petra.l@brewboat.co',
    ratings: ['mate'],
    credentials: [
      { type: 'Medical', id: 'MED-44890', expiry: '2028-09-21' },
    ],
    manualThumb: { kind: 'none' },
    suppressions: [{ id: 's1', start: '2026-07-18', end: '2026-07-19', reason: 'Wedding' }],
    protocol: 'default',
    status: 'active',
    reliability: { history: true, score: 88, reasons: ['Confirmed 18 of last 19 asks', 'First to volunteer for doubles'] },
    futureAssignments: [],
  },
  {
    id: 'c07', name: 'Cody Ahn', phone: '(253) 555-0173', email: 'cody.ahn@brewboat.co',
    ratings: ['mate'],
    credentials: [
      { type: 'Medical', id: 'MED-33102', expiry: '2026-06-29' }, // expiring soon
    ],
    manualThumb: { kind: 'none' },
    suppressions: [{ id: 's2', start: '2026-06-08', end: '2026-06-14', reason: 'PTO — out of town' }],
    protocol: 'default',
    status: 'active',
    reliability: { history: true, score: 60, reasons: ['Reliable on short notice', '1 late claim this month'] },
    futureAssignments: [],
  },
  {
    id: 'c08', name: 'Theo Marsh', phone: '(206) 555-0191', email: 'theo.marsh@brewboat.co',
    ratings: ['mate'],
    credentials: [
      { type: 'Medical', id: 'MED-22781', expiry: '2027-12-05' },
    ],
    manualThumb: { kind: 'boost' }, // Spink's thumb: trending up, give him more asks
    suppressions: [],
    protocol: 'default',
    status: 'active',
    reliability: { history: true, score: 66, reasons: ['Improving — 5 confirms in a row', 'New to the crew this spring'] },
    futureAssignments: [],
  },
  {
    id: 'c09', name: 'Nadia Calloway', phone: '(360) 555-0128', email: 'nadia.c@brewboat.co',
    ratings: ['mate'],
    credentials: [
      { type: 'Medical', id: 'MED-19004', expiry: '2026-04-30' }, // EXPIRED — out of mate pool
    ],
    manualThumb: { kind: 'none' },
    suppressions: [],
    protocol: 'default',
    status: 'active',
    reliability: { history: true, score: 57, reasons: ['Medical lapsed in April', '1 bail in last 30 days'] },
    futureAssignments: [],
  },
  {
    id: 'c10', name: 'Will Stearns', phone: '(206) 555-0134', email: 'will.stearns@brewboat.co',
    ratings: ['captain', 'mate'],
    credentials: [
      { type: 'MMC', id: 'MMC-7781560', expiry: '2028-02-28' },
      { type: 'Medical', id: 'MED-15567', expiry: '2027-08-15' },
      { type: 'TWIC', id: 'TWIC-009214', expiry: '2029-05-01' },
    ],
    manualThumb: { kind: 'none' },
    suppressions: [],
    protocol: 'default',
    status: 'active',
    reliability: { history: true, score: 79, reasons: ['Confirmed 9 of last 10 asks', 'Carries TWIC — clears the fuel-dock route'] },
    // Assigned to future shifts → drives the deactivation-stranding flow.
    futureAssignments: [
      { id: 'a1', shift: 'BrewBoat', date: '2026-06-06', seat: 'captain', label: 'Sat Jun 6 · 3:00pm' },
      { id: 'a2', shift: 'BrewBoat', date: '2026-06-14', seat: 'mate', label: 'Sun Jun 14 · 1:00pm' },
    ],
  },
  {
    id: 'c11', name: 'Eli Park', phone: '(206) 555-0205', email: '',
    ratings: [], // trainee — rides a supernumerary seat, not yet rated
    credentials: [
      { type: 'Medical', id: 'MED-10880', expiry: '2028-06-01' },
    ],
    manualThumb: { kind: 'none' },
    suppressions: [],
    protocol: 'default',
    status: 'active',
    reliability: { history: false, score: null, reasons: [] }, // cold start
    futureAssignments: [],
  },
  {
    id: 'c12', name: 'Renata Dia', phone: '(425) 555-0162', email: 'renata.dia@brewboat.co',
    ratings: ['captain', 'mate'],
    credentials: [
      { type: 'MMC', id: 'MMC-4409912', expiry: '2027-10-10' },
      { type: 'Medical', id: 'MED-09921', expiry: '2027-10-10' },
    ],
    manualThumb: { kind: 'none' },
    suppressions: [],
    protocol: 'default',
    status: 'inactive', // kept for history, out of future pools
    reliability: { history: true, score: 83, reasons: ['Moved to Portland — kept for records', 'Strong history aboard'] },
    futureAssignments: [],
  },
];

window.MusterData = {
  TODAY, SEED, fmtDate, fmtShort, credHealth, personHealth, hasValid,
  poolEligible, poolBlockReason, effectiveBand, effectiveScore, poolRank,
  daysBetween, parseD, BANDS,
};
