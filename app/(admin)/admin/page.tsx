import Link from "next/link";

/**
 * Admin surface group (Spink) — route-group skeleton (DEC-020). The roster,
 * event admin, and shift builder (SPEC §2.1–2.3) fill this group in later
 * tasks; the At-Risk board (§2.5) is live. Grouped under (admin) so it can
 * carry its own layout/auth without affecting the URL.
 */
export default function AdminHome() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Admin</h1>
      <Link
        href="/admin/at-risk"
        className="rounded-card border border-line bg-card px-4 py-3 font-semibold text-accent shadow-sm"
      >
        At-Risk board →
      </Link>
      <p className="text-sm text-muted">
        Roster, event admin, and shift builder land here in later tasks.
      </p>
    </main>
  );
}
