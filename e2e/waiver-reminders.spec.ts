/**
 * Waiver reminders from the real cron route (Phase 18.7, issue #1121). Every rule — the reminder
 * day, the send hours, the stop, never twice — is tested in `src/checkin/reminders.test.ts`; this
 * proves the wiring: `/api/cron/tick` reaches the reminders, they read the real database, and what
 * they did lands on the booking's trail.
 *
 * The e2e server has no Twilio and no Resend keys (`playwright.config.ts` blanks them), so the text
 * goes to the log channel. A logged message told nobody (DEC-170): the run reports it failed, and
 * the trail says so — which is also what makes this safe to run.
 */
import { addDays, vesselDateOf } from "../src/config/tenant.js";
import {
  test,
  expect,
  plantBookedReservation,
  plantTripLink,
  plantWaiverTemplate,
  readTrailFor,
  resetAndSeed,
} from "./fixtures.js";

const CRON = { Authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret"}` };

test.describe("waiver reminders on the cron tick", () => {
  test.beforeEach(async () => {
    await resetAndSeed("crew"); // vessel-hops
  });

  test("a party still signing, seven days out, is reminded on the tick — and a logged text is not a reminder sent", async ({
    request,
  }) => {
    await plantWaiverTemplate({
      id: "wt-e2e",
      version: "brewboat-2026-v1",
      body: "I accept the risks.",
      effectiveFrom: "2026-01-01T05:00:00.000Z",
    });
    const tripDate = addDays(vesselDateOf(new Date()), 7);
    await plantTripLink({ code: "RM7DAYS0", date: tripDate, time: "15:00" });
    await plantBookedReservation({
      id: "resv-reminder-e2e",
      eventId: "evt-trip-RM7DAYS0",
      customerName: "Amy Nowak",
      partySize: 4,
      phone: "+15555550142",
    });

    const res = await request.get("/api/cron/tick", { headers: CRON });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.remindersFailed).toBeGreaterThanOrEqual(1);

    expect(await readTrailFor("resv-reminder-e2e")).toContainEqual({
      type: "waiver_reminder_failed",
      reason: "email=absent sms=logged",
    });

    // A second tick tries the window again and fails the same way; the trail still says it once.
    const again = await (await request.get("/api/cron/tick", { headers: CRON })).json();
    expect(again.remindersFailed).toBeGreaterThanOrEqual(1);
    expect((await readTrailFor("resv-reminder-e2e")).filter((t) => t.type === "waiver_reminder_failed")).toHaveLength(1);
  });
});
