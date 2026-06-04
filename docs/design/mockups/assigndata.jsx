// assigndata.jsx — Assignment View substrate: one focus shift, eligible pools.
// Pools are derived against the SAME crew the roster shows — exclusions (expired
// MMC, lapsed medical, inactive, double-booked, PTO) are real, not decorative.
const A_NOW = new Date('2026-06-03T08:00:00');

// staffing-horizon deadline this shift "fills by" (when Tier escalation must resolve)
const FILLS_BY = new Date('2026-06-04T18:00:00'); // ~34h out

// --- crew reliability snapshot (mirrors roster §2.1) ---
// band: High/Med/Low ; score shown to operator on demand (resolved: don't hide it)
const CREW = {
  dale:    { name: 'Dale Toomey',      band: 'High', score: 94, ratings: ['captain', 'mate'] },
  marisol: { name: 'Marisol Vega',     band: 'High', score: 81, ratings: ['captain'] },
  junior:  { name: 'Junior Okafor',    band: 'Med',  score: 63, ratings: ['captain'] },
  hank:    { name: 'Hank Brouwer',     band: 'High', score: 68, ratings: ['captain', 'mate'], floor: 'High' },
  will:    { name: 'Will Stearns',     band: 'High', score: 79, ratings: ['captain', 'mate'] },
  petra:   { name: 'Petra Lindqvist',  band: 'High', score: 88, ratings: ['mate'] },
  theo:    { name: 'Theo Marsh',       band: 'Med',  score: 66, ratings: ['mate'], boosted: true },
  cody:    { name: 'Cody Ahn',         band: 'Med',  score: 60, ratings: ['mate'] },
  // excluded-from-pool people, surfaced under "why not eligible"
  gus:     { name: 'Gus Hallman',      band: 'Med',  score: 72, ratings: ['captain'] },
  nadia:   { name: 'Nadia Calloway',   band: 'Low',  score: 57, ratings: ['mate'] },
  renata:  { name: 'Renata Dia',       band: 'High', score: 83, ratings: ['captain', 'mate'] },
};

// The eligible pool the oracle would compute for each seat, pre-ranked by reliability.
// askState: available | asked | in | declined | silent   (silent = asked + timed out)
const SEED_SHIFT = {
  id: 'tw-sat', boat: 'Tidewater', boatId: 'tw', date: '2026-06-06', dayLabel: 'Sat · Jun 6',
  coiMax: 12,
  trips: [
    { label: '12:00 PM', pax: 9 },
    { label: '4:00 PM', pax: 11, note: 'sunset' },
  ],
  seats: [
    {
      id: 'cap', role: 'captain', protocol: 'assign-then-confirm',
      state: 'Confirmed', who: 'dale', askedAt: null,
      pool: [
        { who: 'dale',    askState: 'in',        replyMins: 4 },
        { who: 'hank',    askState: 'available' },
        { who: 'will',    askState: 'available' },
        { who: 'marisol', askState: 'available' },
        { who: 'junior',  askState: 'available' },
      ],
      excluded: [
        { who: 'gus',    reason: 'MMC expired May 20 — not date-valid' },
        { who: 'renata', reason: 'Inactive on roster' },
      ],
    },
    {
      id: 'mate', role: 'mate', protocol: 'ask-then-assign',
      state: 'Open', who: null, askedAt: null,
      pool: [
        { who: 'petra', askState: 'available' },
        { who: 'will',  askState: 'available' },
        { who: 'theo',  askState: 'available' },
        { who: 'cody',  askState: 'available' },
      ],
      excluded: [
        { who: 'nadia', reason: 'Medical cert lapsed Apr 30 — not date-valid' },
      ],
    },
  ],
  // Tier activity log (what the autonomous system has done)
  activity: [
    { t: 'Tier 1', when: '2h ago', text: 'Named Dale Toomey to the captain seat (assign-then-confirm).' },
    { t: 'Tier 1', when: '1h 54m ago', text: 'Dale confirmed — captain seat locked.' },
    { t: 'Tier 1', when: '40m ago', text: 'Broadcast mate ask queued — holds until you lock / inside horizon.' },
  ],
};

// band → rank order for re-ask "next candidate" logic (higher score first, floor lifts)
function effScore(c) {
  let s = c.score;
  if (c.boosted) s += 12;
  if (c.floor === 'High') s = Math.max(s, 79);
  return s;
}

window.AssignData = { A_NOW, FILLS_BY, CREW, SEED_SHIFT, effScore };
