/**
 * Pilot crew seed — the REAL BrewBoat crew + ratings (Session 22 roster).
 *
 * Run db:seed:fleet FIRST (it creates the captain/mate roles these ratings
 * reference). Idempotent (upserts on id) — re-run freely after edits.
 *
 * **MMC is a deliberate placeholder (DEC-044), not invented data.** BrewBoat keeps
 * no MMC records today — Muster is the tool that will start capturing them. But MMC
 * is a UNIVERSAL hard gate (src/oracle/eligibility.ts → HARD_CREDENTIAL_TYPES): no
 * valid MMC → eligible for NOTHING. So until real credential tracking lands, every
 * crew member gets a far-future sentinel MMC (`PLACEHOLDER_MMC_EXPIRY`) to keep the
 * gate open. Replace per person with a real `mmcExpiry: "YYYY-MM-DD"` as records
 * are collected — a real (or lapsed) date then overrides the sentinel.
 *
 * `ratings` are REAL (Drew's captain/mate split). Captains are rated
 * `[captain, mate]` — any captain can fill a mate seat (it happens, sometimes the
 * owner himself). Mates are mate-only: a mate can't captain.
 *
 * PILOT_GUIDES env (optional): comma-separated tokens — a crew member seeds
 * `active` if any token (case-insensitive) matches their id or name, else
 * `inactive`. Unset → everyone active. e.g. PILOT_GUIDES="mcgovern,stoffer,berger".
 *
 * Dev tooling, not app code. Uses the same Postgres adapter the app runs on.
 *   DATABASE_URL="<prod-neon-direct>" npm run db:seed:crew:pilot
 */
import { PostgresRepository } from "../src/adapters/postgres-repository.js";
import { asId } from "../src/domain/ids.js";
import type { RoleTypeId } from "../src/domain/ids.js";
import { DEFAULT_DATABASE_URL } from "./migrate.js";

const CAPTAIN = asId<"RoleTypeId">("role-captain");
const MATE = asId<"RoleTypeId">("role-mate");
const ratingId = (r: "captain" | "mate"): RoleTypeId => (r === "captain" ? CAPTAIN : MATE);

/** Far-future sentinel MMC expiry (DEC-044) — keeps the universal MMC gate open
 * until BrewBoat tracks real credentials. Obviously not a real date, by design. */
const PLACEHOLDER_MMC_EXPIRY = "2099-12-31";

interface CrewSeed {
  id: string;
  name: string;
  email: string;
  phone: string;
  ratings: ("captain" | "mate")[];
  /** Real MMC expiry, "YYYY-MM-DD", when collected — overrides the placeholder. */
  mmcExpiry?: string;
}

// ── The real roster + ratings (Henry Billingsley omitted — no phone yet). ────────
const CREW: CrewSeed[] = [
  { id: "crew-sarah-angelone", name: "Sarah Angelone", email: "slangelone81@yahoo.com", phone: "+14406688922", ratings: ["mate"] },
  { id: "crew-emma-beer", name: "Emma Beer", email: "ejbeer99@gmail.com", phone: "+12603509680", ratings: ["mate"] },
  { id: "crew-kevin-berger", name: "Kevin Berger", email: "bergerk714@gmail.com", phone: "+14405548393", ratings: ["mate"] },
  { id: "crew-gerald-czarnecki", name: "Gerald Czarnecki", email: "mc5thchapter@yahoo.com", phone: "+12162106255", ratings: ["captain", "mate"] },
  { id: "crew-mackenzie-gerl", name: "Mackenzie Gerl", email: "mgerl325@gmail.com", phone: "+14404138094", ratings: ["mate"] },
  { id: "crew-darrell-hughes", name: "Darrell Hughes", email: "dlhughes1999@gmail.com", phone: "+14235570989", ratings: ["mate"] },
  { id: "crew-drew-johnson", name: "Drew Johnson", email: "drew@brewcle.com", phone: "+12169658160", ratings: ["mate"] },
  { id: "crew-tiffany-kay", name: "Tiffany Kay", email: "kaytiffy92@gmail.com", phone: "+14405210317", ratings: ["mate"] },
  { id: "crew-kelsey-kelly", name: "Kelsey Kelly", email: "kelseykelly1992@gmail.com", phone: "+14404651813", ratings: ["mate"] },
  { id: "crew-paul-learman", name: "Paul Learman", email: "paul.learman@gmail.com", phone: "+14407286189", ratings: ["captain", "mate"] },
  { id: "crew-ashley-londrico", name: "Ashley Londrico", email: "ashleylondrico58@gmail.com", phone: "+12163232188", ratings: ["mate"] },
  { id: "crew-brendan-mcgovern", name: "Brendan McGovern", email: "brendan@brewcle.com", phone: "+14407992482", ratings: ["mate"] },
  { id: "crew-liam-mchale", name: "Liam McHale", email: "liamamchale@gmail.com", phone: "+13306086957", ratings: ["captain", "mate"] },
  { id: "crew-melissa-montague", name: "Melissa Montague", email: "missy.m.montague@gmail.com", phone: "+14408649007", ratings: ["mate"] },
  { id: "crew-calli-neumann", name: "Calli Neumann", email: "callineumann@gmail.com", phone: "+13305540120", ratings: ["mate"] },
  { id: "crew-sheila-ogden", name: "Sheila Ogden", email: "smogden7@gmail.com", phone: "+17249921092", ratings: ["mate"] },
  { id: "crew-francine-pate", name: "Francine Pate", email: "francinepate@icloud.com", phone: "+12163124342", ratings: ["captain", "mate"] },
  { id: "crew-michael-scaffide", name: "Michael Scaffide", email: "scaffcoservices@gmail.com", phone: "+14403421575", ratings: ["captain", "mate"] },
  { id: "crew-eric-stoffer", name: "Eric Stoffer", email: "eric@stoffer.net", phone: "+14403631599", ratings: ["captain", "mate"] },
  { id: "crew-brandon-suarez", name: "Brandon Suarez", email: "brandonsuar@gmail.com", phone: "+14405962424", ratings: ["mate"] },
  { id: "crew-william-whalen", name: "William Whalen", email: "william.a.whalen@gmail.com", phone: "+12166327395", ratings: ["captain", "mate"] },
];

const tokens = (process.env.PILOT_GUIDES ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const isActive = (c: CrewSeed): boolean =>
  tokens.length === 0 ||
  tokens.some((t) => c.id.toLowerCase().includes(t) || c.name.toLowerCase().includes(t));

const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const repo = PostgresRepository.fromConnectionString(url);

try {
  let active = 0;
  let placeholderMmc = 0;
  for (const c of CREW) {
    const activeNow = isActive(c);
    if (activeNow) active++;
    await repo.saveCrewMember({
      id: asId<"CrewMemberId">(c.id),
      name: c.name,
      phone: c.phone,
      email: c.email,
      ratings: c.ratings.map(ratingId),
      status: activeNow ? "active" : "inactive",
      reliabilityScore: null,
    });
    const expiry = c.mmcExpiry ?? PLACEHOLDER_MMC_EXPIRY;
    if (!c.mmcExpiry) placeholderMmc++;
    await repo.saveCredential({
      id: asId<"CredentialId">(`cred-${c.id}-mmc`),
      crewMemberId: asId<"CrewMemberId">(c.id),
      type: "MMC",
      expiry,
    });
  }
  const captains = CREW.filter((c) => c.ratings.includes("captain")).length;
  console.log(
    `Seeded ${CREW.length} pilot crew (${active} active; ${captains} captain, ${CREW.length - captains} mate).`,
  );
  if (placeholderMmc > 0) {
    console.warn(
      `\nℹ ${placeholderMmc}/${CREW.length} crew on the placeholder MMC (${PLACEHOLDER_MMC_EXPIRY}, DEC-044) —\n` +
        `  BrewBoat keeps no MMC records yet. Replace with real mmcExpiry dates as collected.`,
    );
  }
} finally {
  await repo.close();
}
