/**
 * Crew surface group — route-group skeleton (DEC-020). The three crew-app
 * surfaces (the ask, my-shifts, the shift card — SPEC §2.6) and the magic-link
 * landing fill this group in 1.5b (#12). Grouped under (crew) so it carries
 * magic-link auth separately from the admin group.
 */
export default function CrewHome() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>Crew</h1>
      <p>The ask, my-shifts, and the shift card land here.</p>
    </main>
  );
}
