// crewdata.jsx — Crew App substrate. Protagonist: Cody Ahn, mate.
// Everything the crew member's three surfaces read: own standing (non-comparative),
// own credential expiry, confirmed shifts, pending asks, per-event manifests.
const ME = {
  name: 'Cody', full: 'Cody Ahn', rating: 'mate',
  standing: {
    band: 'Med',
    // INDIVIDUAL reasons — never a ranking against other crew
    reasons: ['Confirmed 4 of your last 6 asks', 'No bails this season', 'One late reply last month'],
    blurb: 'Solid. Quick replies keep you near the front of the line.',
  },
  credential: { type: 'Medical cert', expiresISO: '2026-06-29', daysLeft: 26 }, // expiring-soon nudge
};

// Co-crew contacts come from the roster (§2.1)
const CO = {
  dale:    { name: 'Dale Toomey', role: 'captain', phone: '(206) 555-0142' },
  marisol: { name: 'Marisol Vega', role: 'captain', phone: '(206) 555-0188' },
};

// Confirmed upcoming shifts. callTime ≠ departTime is the load-bearing distinction.
const SHIFTS = [
  {
    id: 'sat6', boat: 'Mash Tun', boatId: 'mt', dateISO: '2026-06-06',
    dayLabel: 'Sat · Jun 6', tripType: 'Brewery harbor tour',
    callTime: '11:00 AM', departTime: '11:30 AM',
    dock: 'Lake Union — Pier 3', dockMap: 'Lake Union Pier 3, Seattle',
    coCrew: ['dale'],
    // LIVE UPDATE: card changed since last viewed → indicator + ping (§3.1)
    changed: true, changeNote: 'Departure moved 11:00 → 11:30 AM. Your call time is now 11:00.',
    notes: 'Cooler restocked Friday night. Life vests counted — all 12 aboard.',
    // per-event manifest — separate guest list per trip occurrence
    events: [
      { time: '11:30 AM', pax: 6, parties: [{ name: 'Smith', n: 4, phone: '(206) 555-0118' }, { name: 'Alvarez', n: 2, phone: '(360) 555-0145' }] },
      { time: '1:00 PM', pax: 2, parties: [{ name: 'Nguyen', n: 2, phone: '(425) 555-0166' }] },
      { time: '3:00 PM', pax: 6, parties: [{ name: 'Brewer', n: 2, phone: '(253) 555-0190' }, { name: 'Cole', n: 2, phone: '(206) 555-0172' }, { name: 'Patel', n: 2, phone: '(360) 555-0133' }] },
    ],
  },
  {
    id: 'sat21', boat: 'Tidewater', boatId: 'tw', dateISO: '2026-06-21',
    dayLabel: 'Sat · Jun 21', tripType: 'Sunset cruise',
    callTime: '4:00 PM', departTime: '4:30 PM',
    dock: 'Elliott Bay — Pier 56', dockMap: 'Pier 56, Seattle',
    coCrew: ['marisol'],
    changed: false, changeNote: '',
    notes: 'Bring a layer — it cools off fast after sundown.',
    events: [
      { time: '4:30 PM', pax: 8, parties: [{ name: 'Donnelly', n: 4, phone: '(206) 555-0201' }, { name: 'Reyes', n: 2, phone: '(425) 555-0188' }, { name: 'Lind', n: 2, phone: '(360) 555-0162' }] },
    ],
  },
];

// Pending asks — answerable in/out in ~3 seconds. One open, one already-contested.
const ASKS = [
  {
    id: 'ask-jun20', boat: 'Tidewater', boatId: 'tw', dayLabel: 'Sat · Jun 20',
    rating: 'mate', callTime: '4:30 PM', backAround: '~9 PM', tripType: 'sunset',
    line: 'Sat Jun 20 · Tidewater · mate · call 4:30, back ~9 (sunset).',
    filled: false,
  },
  {
    id: 'ask-jun18', boat: 'Mash Tun', boatId: 'mt', dayLabel: 'Thu · Jun 18',
    rating: 'mate', callTime: '12:30 PM', backAround: '~4 PM', tripType: 'day tour',
    line: 'Thu Jun 18 · Mash Tun · mate · call 12:30, back ~4.',
    filled: true, filledBy: 'Petra', // contested first-yes-wins demo
  },
];

window.CrewData = { ME, CO, SHIFTS, ASKS };
