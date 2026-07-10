"use client";

/**
 * The manifest's guest Text button (#345). The server builds the `sms:` href with
 * the intro message preloaded (Part A); this thin client wrapper adds the "we texted
 * them" record on tap (Part B) — a best-effort `keepalive` POST fired right before
 * the browser hands off to the Messages app, so it survives the navigation.
 *
 * Progressive enhancement: with no JS the plain `<a href="sms:…">` still opens
 * Messages with the preloaded text — it just isn't recorded. The tap is never gated
 * on the record succeeding.
 */
export function GuestTextButton({
  href,
  phone,
  reservationId,
  shiftId,
  className,
}: {
  href: string;
  phone: string;
  reservationId: string;
  shiftId: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      title={phone}
      className={className}
      onClick={() => {
        void fetch("/api/guest-contact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reservationId, shiftId }),
          keepalive: true,
        }).catch(() => {});
      }}
    >
      <span aria-hidden="true">✉&nbsp;</span>Text
    </a>
  );
}
