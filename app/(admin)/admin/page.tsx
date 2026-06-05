/**
 * Admin surface group (Spink) — route-group skeleton (DEC-020). The roster,
 * event admin, shift builder, assignment view, and at-risk board (SPEC §2.1–2.5)
 * fill this group in later tasks. Grouped under (admin) so it can carry its own
 * layout/auth without affecting the URL.
 */
export default function AdminHome() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>Admin</h1>
      <p>Spink&apos;s surfaces land here (roster, builder, assignment, at-risk).</p>
    </main>
  );
}
