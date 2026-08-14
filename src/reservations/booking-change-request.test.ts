import { describe, expect, it } from "vitest";
import { bookingChangeRequestEmail } from "./booking-change-request.js";

describe("bookingChangeRequestEmail", () => {
  const base = {
    reservationId: "resv-1",
    customerName: "Jordan Ellis",
    tripLabel: "Sat, Jul 18 · 1:30 PM · Brew Boat Party",
    phone: "+12165550148",
    email: "jordan@example.com",
    manageUrl: "https://app.example.com/b/K3F9QZ2MX7RN4P",
  };

  it("composes a cancellation email naming the trip, contact, and manage link", () => {
    const mail = bookingChangeRequestEmail({ ...base, kind: "cancel" });
    expect(mail.subject).toBe("Cancellation request — Jordan Ellis (Sat, Jul 18 · 1:30 PM · Brew Boat Party)");
    expect(mail.text).toContain("requested a cancellation");
    expect(mail.text).toContain("Booking: resv-1");
    expect(mail.text).toContain("+12165550148 · jordan@example.com");
    expect(mail.text).toContain(base.manageUrl);
  });

  it("frames a change request as a date/time change", () => {
    const mail = bookingChangeRequestEmail({ ...base, kind: "change" });
    expect(mail.subject).toContain("Change request");
    expect(mail.text).toContain("date/time change");
  });

  it("includes the customer note when present and omits the block when not", () => {
    expect(bookingChangeRequestEmail({ ...base, kind: "change", note: "Prefer the 5:30 slot" }).text).toContain(
      "Prefer the 5:30 slot",
    );
    expect(bookingChangeRequestEmail({ ...base, kind: "change" }).text).not.toContain("Their note:");
  });

  it("falls back gracefully when no contact is on file", () => {
    const mail = bookingChangeRequestEmail({
      kind: "cancel",
      reservationId: "resv-1",
      customerName: "Jordan Ellis",
      tripLabel: "Sat, Jul 18",
      manageUrl: "https://x/y",
    });
    expect(mail.text).toContain("no contact on file");
  });
});
