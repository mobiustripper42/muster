/**
 * Day·Grid reservation calendar (task 12.11, #464) — drives /admin/calendar end to end.
 * Read-only slice: one day as fleet-vessel columns × a fixed 8:00–21:30 axis, each computed
 * departure a duration-spanning block (deriveVirtualAvailability, DEC-125).
 *
 * The `reservation` seed builds a LIVE offering + owned days (the 10th–16th of NEXT month, #646)
 * on Brew 3 with two booked trips: 13:30 on the 12th Marcus Webb (party 8), 15:30 on the 13th
 * Dana Cho. So on the booked day Brew 3 shows one BOOKED block (Marcus Webb) + two OPEN (15:30, 17:30
 * — the offering's other departures). The Booked filter hides the opens, keeps the booking.
 * Runs desktop + 375px (the grid scrolls; the booked block stays present).
 */
import {
  test,
  expect,
  plantPayment,
  reopenEvent,
  resetAndSeed,
  signInAsAdmin,
} from "./fixtures.js";
import { shortTime as shortLabel } from "../src/reservations/calendar-grid.js";
import { xolaFixture } from "../src/reservations/seed-xola.js";
import {
  BOOKED,
  BOOKED_2,
  DEMO,
  OPEN_TIME,
  TODAY,
  demoReservationId,
  monthDay,
} from "./reservation-demo.js";

/** The xola fixture's days, derived from the SAME clock read the seed subprocess gets (#646). */
const XOLA = xolaFixture(TODAY);

test.describe("admin /admin/calendar", () => {
  test.beforeEach(async () => {
    await resetAndSeed("reservation"); // live offering + owned days + 2 booked trips on Brew 3
  });

  test("Day·Grid renders the day; Booked filter hides opens", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);

    // Brew 3 has a column header.
    await expect(page.getByText("Brew 3", { exact: true })).toBeVisible();

    // The 13:30 booking renders as a booked block: customer + "1:30 · 8".
    const booked = page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" });
    await expect(booked).toBeVisible();
    await expect(booked).toContainText("1:30");
    await expect(booked).toContainText("8");

    // The offering's other two departures show as OPEN blocks (15:30, 17:30).
    await expect(page.getByText("open · 3:30")).toBeVisible();
    await expect(page.getByText("open · 5:30")).toBeVisible();

    // Filter → Booked: opens vanish, the booking stays.
    await page.getByTestId("filter-booked").click();
    await page.waitForURL(/filter=booked/);
    await expect(page.getByText("open · 3:30")).toHaveCount(0);
    await expect(page.getByText("open · 5:30")).toHaveCount(0);
    await expect(page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" })).toBeVisible();
  });

  /**
   * The detail pane (12.11 continued) — read-only, NO actions in this slice. The seeded
   * booking carries no payments and no gratuities, so the money block is the pure derivation:
   * fare 54900 (the event's price; the seed freezes no extras) + 7.25% tax = 3980 ⇒ a 58880
   * balance still due, nothing paid. No gratuity section renders at all.
   */
  test("a booked block opens its reservation detail; money derives from fare + tax", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);

    await page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" }).click();
    await page.waitForURL(/\/admin\/calendar\/resv-demo/);

    const pane = page.getByTestId("reservation-detail");
    await expect(pane).toBeVisible();
    // The page heading names the reservation; the pane deliberately doesn't repeat it.
    await expect(page.getByRole("heading", { name: "Marcus Webb", level: 1 })).toBeVisible();

    // Guests against the boat's COI cap — "8 of 12", never a seat count.
    await expect(pane).toContainText("8");
    await expect(pane).toContainText("of 12");

    // The three rows the model can't source the mockup's way.
    await expect(pane).toContainText("Waiver");
    await expect(pane).toContainText("Not on file"); // one consent record, not "7 of 7"
    await expect(pane).toContainText("Updated"); // updatedAt, never "Booked"
    await expect(pane).not.toContainText("Add-on"); // no per-reservation add-ons exist

    // Money: fare + tax, nothing paid, balance still due. No service fee (Xola's, unmodelled).
    await expect(pane).toContainText("$549.00");
    await expect(pane).toContainText("$39.80");
    await expect(pane).toContainText("$588.80");
    await expect(pane).not.toContainText("Service fee");

    // The mockup's remaining actions are still deferred — message waits on #119 (a customer
    // must never reach the crew line), guests and change-time on their own tasks. Narrowed
    // twice now: once when the balance link shipped (11.2b) and again at #616, which built
    // cancel / refund / resend. The list names what is deferred rather than counting buttons,
    // precisely so it has to be edited — deliberately — each time that scope moves.
    for (const action of ["Message", "Guests", "Change time"]) {
      await expect(pane.getByRole("button", { name: action })).toHaveCount(0);
    }
    // Refund is absent here for a DIFFERENT reason than deferral: this booking has no
    // payments, so there is nothing to give back and the box would be a trap.
    await expect(pane.getByTestId("refund-form")).toHaveCount(0);
    await expect(pane.getByTestId("cancel-start")).toBeVisible();

    // One route, two native layouts (no client JS): the grid sits BESIDE the pane on desktop
    // and is hidden on mobile, where the pane is the whole page. It's hidden rather than
    // omitted because a server render can't know the viewport — the markup ships either way.
    const grid = page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" });
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) await expect(grid).toBeVisible();
    else await expect(grid).toBeHidden();

    // Back returns to the day you came from.
    await page.getByRole("link", { name: "Back to calendar" }).click();
    await page.waitForURL(new RegExp(`/admin/calendar\\?date=${BOOKED.date}`));
    await expect(page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" })).toBeVisible();
  });

  /** A direct link with no ?date must land on the reservation's OWN day, not today's grid. */
  test("deep link with no date resolves the reservation's own day", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar/${demoReservationId(BOOKED_2.date, BOOKED_2.time)}`);

    const pane = page.getByTestId("reservation-detail");
    await expect(page.getByRole("heading", { name: "Dana Cho", level: 1 })).toBeVisible();
    await expect(pane).toContainText(monthDay(BOOKED_2.date));
    await expect(pane).toContainText("3:30 PM");
    // Dana's fare is 43900 → tax 3183 → 47083 due.
    await expect(pane).toContainText("$439.00");
    await expect(pane).toContainText("$470.83");
  });

  /**
   * The balance link (11.2b, DEC-107) — the operator door for a service that shipped tested
   * with no caller. The seeded booking has no payments, so the whole fare is outstanding and
   * the action offers itself. The Stripe MINT itself isn't exercised here (it needs a live
   * Stripe session); this drives the two states the action redirects back into, which is
   * where the UI logic actually lives.
   */
  test("balance link: offered when money is owed, hidden once settled", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar/${encodeURIComponent(demoReservationId(BOOKED.date, BOOKED.time))}?date=${BOOKED.date}`);

    const pane = page.getByTestId("reservation-detail");
    await expect(pane).toContainText("$588.80"); // balance due
    await expect(pane.getByRole("button", { name: "Create balance link" })).toBeVisible();

    // The minted link renders with a copy affordance, and the button gives way to it.
    await page.goto(
      `/admin/calendar/${encodeURIComponent(demoReservationId(BOOKED.date, BOOKED.time))}?date=${BOOKED.date}&balanceUrl=https%3A%2F%2Fcheckout.stripe.com%2Fc%2Fpay%2Ftest123`,
    );
    await expect(pane.getByTestId("balance-link")).toContainText("checkout.stripe.com/c/pay/test123");
    await expect(pane.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(pane.getByRole("button", { name: "Create balance link" })).toHaveCount(0);

    // A refusal explains itself in operator language, not a reason code.
    await page.goto(
      `/admin/calendar/${encodeURIComponent(demoReservationId(BOOKED.date, BOOKED.time))}?date=${BOOKED.date}&balanceErr=stripe_not_configured`,
    );
    await expect(pane).toContainText("Stripe isn’t configured");
    await expect(pane).not.toContainText("stripe_not_configured");
  });

  test("an unknown reservation 404s rather than rendering an empty pane", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    const res = await page.goto("/admin/calendar/resv-does-not-exist");
    expect(res?.status()).toBe(404);
  });

  /**
   * Hold a single departure from the calendar (#703) — the write the registry's "make a hold on
   * the calendar" copy has been promising since 12.10 with nothing able to produce one.
   *
   * The round trip is the test: hold it, see it dark, see the row the registry renders for it,
   * release it from the same place, see it back on sale. Asserting only the hold would pass with
   * a one-way door, which is the version of this feature nobody can undo.
   */
  test("an open slot is blocked from the calendar, lands in the registry, and is unblocked", async ({
    page,
  }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);

    // Addressed by SCOPE, not by label: both dark cards read "Blocked", and only the slot-scoped
    // one is undoable here. A `hasText` filter would match either.
    const slotBlock = page.locator('[data-testid="cal-block"][data-blocked-by="slot"]');

    // 3:30 is open (the offering's second departure; nobody has taken it).
    await expect(page.getByText(`open · ${shortLabel(OPEN_TIME)}`)).toBeVisible();

    // Clicking it asks first — a misclick on a busy grid must not silently unsell a departure.
    await page.getByText(`open · ${shortLabel(OPEN_TIME)}`).click();
    const confirm = page.getByTestId("hold-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Brew 3");
    await expect(confirm).toContainText(shortLabel(OPEN_TIME));
    // Still on sale until the second click — the confirm is a question, not a receipt.
    await expect(page.getByText(`open · ${shortLabel(OPEN_TIME)}`)).toBeVisible();

    await confirm.getByRole("button", { name: "Block it" }).click();
    await expect(page.getByTestId("hold-confirm")).toHaveCount(0);
    await expect(page.getByText(`open · ${shortLabel(OPEN_TIME)}`)).toHaveCount(0);
    await expect(slotBlock).toBeVisible();
    await expect(slotBlock).toContainText("Blocked");
    // The chip's COUNT, not just its label. Renaming this chip dropped the number once already
    // — the lookup was cast to `keyof typeof counts`, so the stale key read `undefined` and
    // rendered as nothing. A label-only assertion would have passed through that.
    await expect(page.getByTestId("filter-blocked")).toHaveText("Blocked 1");
    await expect(page.getByTestId("filter-open")).toHaveText("Open 1");

    // One block family, one list: the registry renders the row it already knew how to render.
    await page.goto("/admin/blocks?kind=slot");
    const row = page.getByTestId("block-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Slot");
    await expect(row).toContainText("Brew 3");
    await expect(row).toContainText("one departure · opens on the calendar");
    await expect(row).toContainText("1");

    // The row IS the forward link — one click to the block's own day, no read-only aside in
    // between (#703). Clicking it must not select it into the editor.
    await row.click();
    await page.waitForURL(new RegExp(`/admin/calendar\\?date=${BOOKED.date}`));

    // Unblocked from the calendar, the slot comes back on sale (DEC-125, reversible-in-spirit).
    await slotBlock.click();
    const release = page.getByTestId("hold-confirm");
    await expect(release).toContainText("back on sale");
    await release.getByRole("button", { name: "Unblock it" }).click();

    await expect(page.getByText(`open · ${shortLabel(OPEN_TIME)}`)).toBeVisible();
    await expect(slotBlock).toHaveCount(0);
  });

  /**
   * A slot block is PHYSICAL — one boat, one clock time — so it removes every offering that
   * proposes that boat-time, not the one card the operator happened to click (#702, #703).
   *
   * The xola seed's fleet offering sells Brew 3 at the demo offering's own departure times, so
   * `days.onGrid` draws TWO open cards on one slot. That doubling is the whole test: with a
   * single offering per boat the href could be keyed on the offering and nothing would notice.
   */
  test("blocking one card takes the boat-time off the market for every offering selling it", async ({
    page,
  }) => {
    await resetAndSeed("reservation", "xola");
    await signInAsAdmin(page, "spink");
    await page.goto(`/admin/calendar?date=${XOLA.days.onGrid}&filter=open`);

    // Two offerings, one boat-time: two open cards at 3:30 on Brew 3 before anything is blocked.
    const opens = page
      .getByTestId("cal-block")
      .filter({ hasText: `open · ${shortLabel(OPEN_TIME)}` })
      .and(page.locator(`[data-vessel="${DEMO.vesselId}"]`));
    await expect(opens).toHaveCount(2);

    // Both cards lead to the SAME confirm — the href is the boat-time, not the offering. This
    // is the assertion the doubling exists for; clicking can only ever reach one of them,
    // because the two cards are drawn exactly on top of each other (#702's collision layout is
    // not this task). So the last one in DOM order is the one painted on top and clickable.
    const hrefs = await opens.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(new Set(hrefs).size).toBe(1);

    await opens.last().click();
    const confirm = page.getByTestId("hold-confirm");
    // The scope is said out loud, because the row this writes cannot show it.
    await expect(confirm).toContainText("2 offerings");
    await confirm.getByRole("button", { name: "Block it" }).click();

    // BOTH are gone from the open filter — one physical boat, one block.
    await expect(
      page
        .getByTestId("cal-block")
        .filter({ hasText: `open · ${shortLabel(OPEN_TIME)}` })
        .and(page.locator(`[data-vessel="${DEMO.vesselId}"]`)),
    ).toHaveCount(0);
    // And the registry attributes both to the one block it wrote.
    await page.goto("/admin/blocks?kind=slot");
    await expect(page.getByTestId("block-row")).toHaveCount(1);
    await expect(page.getByTestId("block-row")).toContainText("2");
  });
});

/**
 * Cancel, refund and resend (#616) — the operator toolkit that did not exist. Before this the
 * whole toolkit was one action: mint a balance link and copy it by hand.
 */
test.describe("admin reservation actions (#616)", () => {
  const RESV = demoReservationId(BOOKED.date, BOOKED.time);
  /**
   * The cancel confirm's commit button, either label.
   *
   * It reads "Cancel and refund" when the booking has refundable money and "Cancel this booking"
   * when it does not — one press does both now. Tests that are ABOUT the label assert it
   * literally (the unpaid case below, and the one-press test); every other test just needs to
   * press the thing, and hardcoding one label there made five tests fail for a reason that had
   * nothing to do with what they were checking.
   */
  const CANCEL_BUTTON = /^Cancel (this booking|and refund)$/;
  const detail = (extra = "") =>
    `/admin/calendar/${encodeURIComponent(RESV)}?date=${BOOKED.date}${extra}`;

  test.beforeEach(async () => {
    await resetAndSeed("reservation");
  });

  test("cancelling frees the boat, and the freed slot goes back on sale", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(detail());
    const pane = page.getByTestId("reservation-detail");

    // The confirm step quotes BOTH outcomes side by side. It has to: with no client JS a
    // single figure could not follow the radio, and the operator is choosing an amount.
    await pane.getByTestId("cancel-start").click();
    const confirm = page.getByTestId("cancel-confirm");
    await expect(confirm).toContainText("The customer asked");
    await expect(confirm).toContainText("We cancelled");
    // Nothing has been paid on this booking, so both quotes are zero — and the screen says so
    // rather than leaving the operator to infer it.
    await expect(confirm).toContainText("$0.00");

    // Unpaid booking ⇒ nothing to refund ⇒ the button stays single-purpose.
    await expect(confirm.getByRole("button", { name: "Cancel this booking" })).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel this booking" }).click();
    await page.waitForURL(/cancelled=/);

    await expect(pane).toContainText("Cancelled");
    await expect(page.getByTestId("action-done")).toContainText("The boat is free again");
    // The balance link must be GONE. `createBalanceCheckout` refuses a cancelled booking
    // (`not_active`), so leaving the button up is a control whose only outcome is an error.
    await expect(pane.getByRole("button", { name: "Create balance link" })).toHaveCount(0);
    // Cancelling twice is not offered.
    await expect(pane.getByTestId("cancel-start")).toHaveCount(0);

    // The point of all of it: that departure is sellable again on the public calendar.
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);
    await expect(
      page.getByTestId("cal-block").filter({ hasText: "Marcus Webb" }),
    ).toHaveCount(0);
    await expect(page.getByText(`open · ${shortLabel(BOOKED.time)}`)).toBeVisible();
  });

  test("the two cancellation quotes differ by the fee, and no copy points at a position", async ({
    page,
  }) => {
    // Two things, both reported from the rendered page rather than the code.
    //
    // (a) The quotes only differ when money has actually been paid. On the bare seed both read
    //     $0.00, which is correct and was also why the original test plan's "check they differ
    //     by $50" step could not be run — no dev command could record a payment. `npm run db:pay`
    //     exists now; this test plants one the same way.
    //
    // (b) **No action copy may say "above" or "below".** It did, and the #718 fix — reordering so
    //     the destructive block renders last — silently turned every one of those into a wrong
    //     direction: "refund below, afterwards" pointed down at a refund box that had moved up,
    //     and on an unpaid booking pointed at one that does not exist at all. Position is the
    //     property of a layout most likely to be changed by an unrelated later fix, so the copy
    //     must not depend on it.
    await plantPayment({
      id: "pay-e2e-3",
      reservationId: RESV,
      amountCents: 58880,
      taxCents: 3980,
    });
    await signInAsAdmin(page, "spink");
    await page.goto(detail("&cancel=1"));

    const confirm = page.getByTestId("cancel-confirm");
    await expect(confirm).toContainText("$538.80"); // customer asked — less the $50 fee
    await expect(confirm).toContainText("$588.80"); // we cancelled — everything paid

    const actionsText = (await page.getByTestId("reservation-actions").innerText()).toLowerCase();
    expect(actionsText).not.toMatch(/\b(above|below)\b/);

    // And after cancelling, the outcome copy is equally position-free. The button is the
    // compound one here — this booking has a payment, so the press cancels AND refunds.
    await confirm.getByRole("button", { name: "Cancel and refund" }).click();
    await page.waitForURL(/cancelled=/);
    // Either outcome is legitimate: with no Stripe intent planted the refund half is refused, and
    // the cancel half still committed. What must hold is that whichever one renders is
    // position-free and talks about MONEY rather than about a box being filled in for later.
    const outcome = page.getByTestId("action-done").or(page.getByTestId("action-error"));
    const text = (await outcome.innerText()).toLowerCase();
    expect(text).not.toMatch(/\b(above|below)\b/);
    expect(text).not.toContain("filled in");
  });

  test("an unpaid booking says there is nothing to refund, rather than promising a refund step", async ({
    page,
  }) => {
    // The state the operator was actually looking at: the seeded booking has no payments, so
    // both quotes are $0.00 and there is no refund box. The copy has to say so — "refund below,
    // afterwards" on this screen is an instruction to do something impossible.
    await signInAsAdmin(page, "spink");
    await page.goto(detail("&cancel=1"));

    // The explanatory sentence was cut (operator: too many words). What says "nothing to
    // refund" now is the data itself — both reasons quote $0.00, there is no amount field, and
    // the button is single-purpose. Assert those rather than prose, which is the more durable
    // thing to pin anyway.
    const confirm = page.getByTestId("cancel-confirm");
    await expect(confirm).toContainText("$0.00");
    await expect(confirm.locator('input[name="amount"]')).toHaveCount(0);
    await expect(confirm.getByRole("button", { name: "Cancel this booking" })).toBeVisible();
    await expect(page.getByTestId("refund-form")).toHaveCount(0);

    await page.getByRole("button", { name: CANCEL_BUTTON }).click();
    await page.waitForURL(/cancelled=/);
    await expect(page.getByTestId("action-done")).toContainText("nothing to refund");
  });

  test("the refund box caps at what was actually paid, and carries the double-submit token", async ({
    page,
  }) => {
    // A real refund needs Stripe, so what is driven here is the part that decides how much
    // money moves: the ceiling, the prefill, and the compare-and-swap token the form posts.
    await plantPayment({
      id: "pay-e2e-1",
      reservationId: RESV,
      amountCents: 58880,
      taxCents: 3980,
      stripePaymentIntentId: "pi_e2e_1",
    });
    await signInAsAdmin(page, "spink");
    await page.goto(detail());
    const pane = page.getByTestId("reservation-detail");

    const form = pane.getByTestId("refund-form");
    await expect(form).toContainText("Refund up to $588.80");
    await expect(form.locator('input[name="amount"]')).toHaveValue("588.80");

    // Refunding is TWO steps (operator, 2026-08-10): the first press opens a confirm that states
    // the figure back, because this is the only control here that moves real money in one press
    // and a wrong amount leaves nothing behind that looks wrong.
    await form.getByRole("button", { name: "Refund" }).click();
    await page.waitForURL(/refundConfirm=58880/);
    const confirm = pane.getByTestId("refund-confirm");
    // The question names the amount and the destination; that is the confirm. The
    // irreversibility sentence that used to sit under it was cut (operator: too many words) —
    // a red button on a screen asking "refund $X?" carries it.
    await expect(confirm).toContainText("Refund $588.80 to the card it came from?");
    // The CAS token rides the CONFIRM form — it is what makes a second post refuse rather than
    // refund twice, so it has to be on the form that actually moves money.
    await expect(confirm.locator('input[name="expectedRefunded"]')).toHaveValue("0");

    // The escape backs out and moves nothing. Named for the action it declines, not "Keep it" —
    // on a screen with two money controls, "keep" does not say keep WHAT (operator).
    await confirm.getByRole("link", { name: "Do Not Refund" }).click();
    await expect(pane.getByTestId("refund-confirm")).toHaveCount(0);
    await expect(pane.getByTestId("refund-form")).toBeVisible();
  });

  test("the confirm step refuses an over-ask before asking you to confirm it", async ({ page }) => {
    // Validation belongs on the FIRST press. Being told "that isn't a valid amount" after
    // confirming is being asked to confirm something the system had already rejected — and the
    // ceiling is re-derived server-side, because the box is a text input and the posted value is
    // whatever the client sent.
    await plantPayment({
      id: "pay-e2e-4",
      reservationId: RESV,
      amountCents: 10000,
      stripePaymentIntentId: "pi_e2e_4",
    });
    await signInAsAdmin(page, "spink");
    await page.goto(detail());

    const form = page.getByTestId("refund-form");
    await form.locator('input[name="amount"]').fill("500.00");
    await form.getByRole("button", { name: "Refund" }).click();

    await expect(page.getByTestId("action-error")).toContainText("more than this booking can give back");
    await expect(page.getByTestId("refund-confirm")).toHaveCount(0);
  });

  test("a refund that Stripe rejected says so, and says nothing moved", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(detail("&refundErr=exceeds_refundable"));
    await expect(page.getByTestId("action-error")).toContainText("more than this booking can give back");

    // The stale case is the double-submit landing. It must be unmistakable that no second
    // refund happened, or the operator reconciles against a number that never moved.
    await page.goto(detail("&refundErr=stale"));
    await expect(page.getByTestId("action-error")).toContainText("Nothing was refunded");
  });

  /**
   * The #718 defect, in the two places here that would cost money (DEC-152).
   *
   * Pressing a button that then VANISHES leaves whatever reflows into its coordinates sitting
   * under a thumb that is still there. On `/crew/time` that cost a crew member a clock-out and
   * an immediate clock-in; here the two destructive presses are "Cancel this booking" and
   * "Yes, refund $X", and what lands underneath must not be able to do anything.
   *
   * **The invariant is no ENABLED control, not no control.** Resend sits below the cancel block
   * at the operator's request, so after a cancel it genuinely does reflow into the press point —
   * measured at 3.5px. It is rendered `disabled` there (it is refused server-side on a cancelled
   * booking anyway), which is DEC-152's own answer: make the thing under the thumb inert rather
   * than move it somewhere else and hope. A version that asserted "no overlap at all" would
   * force a layout the operator does not want, to solve a problem `disabled` already solves.
   *
   * Measured, not eyeballed — 46px looked fine in a screenshot on #718 and is a thumb's width
   * in the hand.
   */
  test("after a destructive press, nothing that COMMITS sits where the button was", async ({
    page,
  }) => {
    // NO `stripePaymentIntentId` on purpose. Cancel-and-refund is ONE press now, so a test
    // that clicks it against a refundable PaymentIntent makes a REAL call to Stripe — the
    // suite jumped to 16s a test and logged `No such payment_intent`. With no intent id
    // `refundReservation` refuses before touching the network: fast, deterministic, and it
    // still exercises what these tests are about — the cancel commits, the refund does not,
    // and the failure is reported rather than swallowed.
    await plantPayment({
      id: "pay-e2e-2",
      reservationId: RESV,
      amountCents: 58880,
      taxCents: 3980,
    });

    await signInAsAdmin(page, "spink");

    /**
     * Every enabled control in the actions block that **COMMITS in a single press**, with its
     * page coordinates.
     *
     * The invariant was briefly "nothing enabled may reflow into the press point", and holding
     * that line forced a blank reserved gap on screen the operator asked to remove. It was
     * over-strict: what makes a stray second tap dangerous is not that a control is *there*, it
     * is that the control *does something irreversible*. Refund is a two-step now — the button
     * that lands in the cancel press point opens a confirm the operator reads and can back out
     * of, so it is harmless there.
     *
     * `data-commits` marks the ones that are not. Matching on that rather than on visible labels
     * is deliberate: labels change for copy reasons ("Keep it" → "Do Not Cancel" in this very
     * commit) and a name-matching test stops matching in silence.
     */
    const enabledBoxes = async () =>
      page
        .getByTestId("reservation-actions")
        .locator("button[data-commits]")
        .evaluateAll((els) =>
          els
            .filter((e) => !(e as HTMLButtonElement).disabled)
            .map((e) => {
              const r = e.getBoundingClientRect();
              return {
                name: (e.textContent ?? "").trim(),
                top: r.top + window.scrollY,
                bottom: r.bottom + window.scrollY,
              };
            }),
        );

    const assertClear = async (
      pressed: { y: number; height: number },
      label: string,
    ): Promise<void> => {
      // Anti-vacuity is checked on the BLOCK, not on the committing set. An empty committing set
      // is the strongest possible result — after a cancel, resend is disabled and refund is a
      // two-step, so genuinely nothing there can commit — and asserting it be non-empty made the
      // test demand a hazard in order to prove there wasn't one.
      const rendered = await page
        .getByTestId("reservation-actions")
        .getByRole("button")
        .count();
      expect(rendered, `${label}: the actions block rendered nothing at all`).toBeGreaterThan(0);

      const after = await enabledBoxes();
      for (const b of after) {
        const overlap = Math.min(pressed.y + pressed.height, b.bottom) - Math.max(pressed.y, b.top);
        expect(
          overlap,
          `after ${label}, "${b.name}" COMMITS in one press and overlaps the press point by ${Math.round(overlap)}px`,
        ).toBeLessThanOrEqual(0);
      }
    };

    // (a) The refund confirm's destructive button. Both outcomes land back on this page, so the
    // post-press layout is the same either way — drive the plain page rather than a real refund
    // (which needs Stripe).
    await page.goto(detail("&refundConfirm=58880"));
    const refundPress = await page.getByRole("button", { name: /Yes, refund/ }).boundingBox();
    await page.goto(detail());
    await assertClear(refundPress!, "the refund confirm");

    // (b) The cancel confirm's destructive button — the one that actually collapses its block.
    await page.goto(detail("&cancel=1"));
    const cancelPress = await page.getByRole("button", { name: CANCEL_BUTTON }).boundingBox();
    await page.getByRole("button", { name: CANCEL_BUTTON }).click();
    await page.waitForURL(/cancelled=/);
    await assertClear(cancelPress!, "the cancel confirm");

    // And the control that DOES land there is inert rather than absent — if resend ever stops
    // being disabled on a cancelled booking, the assertion above starts failing, which is the
    // point. This pins why it passes.
    await expect(
      page.getByRole("button", { name: /Resend confirmation/ }),
    ).toBeDisabled();
  });

  test("a confirm screen shows only its own two buttons, and the press leaves you where you were", async ({
    page,
  }) => {
    // Two operator reports, one test — they are the same screen.
    //
    // (a) With the cancel confirm open, the refund box used to still be armed underneath it:
    //     two money controls live at once, one mid-question, nothing saying which the red
    //     button belonged to.
    // (b) Every action `redirect()`s, which is a full navigation, so each press dropped you at
    //     the TOP of the page and you scrolled back down to find the confirm you just opened.
    //     `AppLink`'s `scroll={false}` (the #690 fix on /book) cannot reach a form POST; the
    //     `#booking-actions` fragment can.
    // NO `stripePaymentIntentId` on purpose. Cancel-and-refund is ONE press now, so a test
    // that clicks it against a refundable PaymentIntent makes a REAL call to Stripe — the
    // suite jumped to 16s a test and logged `No such payment_intent`. With no intent id
    // `refundReservation` refuses before touching the network: fast, deterministic, and it
    // still exercises what these tests are about — the cancel commits, the refund does not,
    // and the failure is reported rather than swallowed.
    await plantPayment({
      id: "pay-e2e-5",
      reservationId: RESV,
      amountCents: 58880,
      taxCents: 3980,
    });

    await signInAsAdmin(page, "spink");
    await page.goto(detail());

    // Open the cancel confirm by pressing the real control, from the bottom of a scrolled page.
    await page.getByTestId("cancel-start").scrollIntoViewIfNeeded();
    await page.getByTestId("cancel-start").click();
    await page.waitForURL(/cancel=1/);

    // (b) Landed at the controls, not the top of the page.
    const afterOpen = await page.evaluate(() => window.scrollY);
    expect(afterOpen, "opening the confirm scrolled back to the top of the page").toBeGreaterThan(0);
    await expect(page.getByTestId("cancel-confirm")).toBeInViewport();

    // (a) Only the confirm's own controls are operable. The refund box keeps its SPACE (so the
    // confirm cannot drift — see the #718 test) but must not be usable or reachable.
    const enabled = await page
      .getByTestId("reservation-actions")
      .getByRole("button")
      .evaluateAll((els) =>
        els.filter((e) => !(e as HTMLButtonElement).disabled).map((e) => (e.textContent ?? "").trim()),
      );
    // "Cancel and refund" when there is money to give back; "Cancel this booking" when there
    // isn't. This booking has a planted payment, so it is the compound label.
    expect(enabled).toEqual(["Cancel and refund"]);
    await expect(page.getByTestId("refund-form").getByRole("button")).toBeHidden();

    // And the same on the way out of the action itself.
    await page.getByRole("button", { name: CANCEL_BUTTON }).click();
    await page.waitForURL(/cancelled=/);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // Either outcome — the refund half is refused without a Stripe intent, the cancel committed.
    await expect(
      page.getByTestId("action-done").or(page.getByTestId("action-error")),
    ).toBeInViewport();
  });

  test("cancel and refund happen in one press, and the amount is an OVERRIDE not a prefill", async ({
    page,
  }) => {
    // The operator's report: the two figures on the cancel confirm "don't really mean anything
    // here" because the money decision happened on a different screen afterwards. They mean
    // something now — this is the press that spends them.
    //
    // The amount box is deliberately EMPTY. A prefill cannot follow a radio without client JS, so
    // picking "We cancelled" and not retyping would refund at the customer rate from a field that
    // looked already-correct. Blank means the server computes the figure for the reason actually
    // posted, so the two cannot disagree.
    // NO `stripePaymentIntentId` on purpose. Cancel-and-refund is ONE press now, so a test
    // that clicks it against a refundable PaymentIntent makes a REAL call to Stripe — the
    // suite jumped to 16s a test and logged `No such payment_intent`. With no intent id
    // `refundReservation` refuses before touching the network: fast, deterministic, and it
    // still exercises what these tests are about — the cancel commits, the refund does not,
    // and the failure is reported rather than swallowed.
    await plantPayment({
      id: "pay-e2e-6",
      reservationId: RESV,
      amountCents: 58880,
      taxCents: 3980,
    });

    await signInAsAdmin(page, "spink");
    await page.goto(detail("&cancel=1"));

    const confirm = page.getByTestId("cancel-confirm");
    const amount = confirm.locator('input[name="amount"]');
    await expect(confirm).toContainText("$538.80"); // customer asked
    await expect(confirm).toContainText("$588.80"); // we cancelled

    // WITH JS: the island fills the box to match the chosen reason, and FOLLOWS a change. This
    // is the whole reason it is allowed to exist (DEC-147 rule 2) — a server round-trip cannot
    // update a text input from a radio without an extra click.
    await expect(amount).toHaveValue("538.80");
    await confirm.getByRole("radio").nth(1).check();
    await expect(amount).toHaveValue("588.80");

    // …and it backs off permanently once the operator types. Overwriting a hand-entered refund
    // because a radio moved is the worst thing this island could do.
    await amount.fill("25.00");
    await confirm.getByRole("radio").nth(0).check();
    await expect(amount).toHaveValue("25.00");
    await amount.fill("");
    await confirm.getByRole("radio").nth(1).check();
    // The button says what the press will actually do — both halves of it.
    await expect(confirm.getByRole("button", { name: "Cancel and refund" })).toBeVisible();

    await confirm.getByRole("button", { name: "Cancel and refund" }).click();
    await page.waitForURL(/cancelled=/);

    // Cancelled, and the outcome reports the MONEY, not a promise that a box has been filled in.
    // Stripe is not configured in e2e, so the refund itself cannot land — what this pins is that
    // the cancel committed anyway and the failure is reported rather than swallowed. Freeing the
    // boat is the urgent half and is correct on its own.
    await expect(page.getByTestId("reservation-detail")).toContainText("Cancelled");
    const outcome = page.getByTestId("action-done").or(page.getByTestId("action-error"));
    await expect(outcome).toBeVisible();
    await expect(outcome).not.toContainText("filled in");
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("the blank amount box still refunds the right figure — the server computes it", async ({
      page,
    }) => {
      // **The progressive-enhancement half of DEC-147 rule 2, proven rather than asserted.**
      //
      // The island fills the amount box so the operator can see what they are about to send.
      // With JS off it cannot, and the box posts EMPTY — which is exactly why empty means "use
      // the figure for the reason posted", computed server-side from the same `quoteCancelRefund`
      // the radio labels were rendered from. A prefilled box would have had nothing to fall back
      // to here, and picking "We cancelled" would have refunded at the customer rate.
      await plantPayment({
        id: "pay-e2e-nojs",
        reservationId: RESV,
        amountCents: 58880,
        taxCents: 3980,
      });
      await signInAsAdmin(page, "spink");
      await page.goto(detail("&cancel=1"));

      const confirm = page.getByTestId("cancel-confirm");
      // Empty with JS off — which is the whole contract: empty means "server computes the figure
      // for the reason posted". The label no longer spells that out (operator: too many words),
      // so this assertion is now the only place the contract is stated.
      await expect(confirm.locator('input[name="amount"]')).toHaveValue("");

      // Post it blank, having chosen the NON-default reason — the case a prefill would get wrong.
      await confirm.getByRole("radio").nth(1).check();
      await confirm.getByRole("button", { name: CANCEL_BUTTON }).click();
      await page.waitForURL(/cancelled=operator/);

      // The cancel landed with no JS at all, which is the property that matters most here.
      await expect(page.getByTestId("reservation-detail")).toContainText("Cancelled");
    });
  });

  test("cancelling with 0 in the box frees the boat and moves no money", async ({ page }) => {
    // Inside the 14-day window the published terms owe nothing, and an operator may simply
    // decide not to refund. Zero has to be an outcome rather than a validation error, or the
    // only way to cancel-without-refunding is to fail the form on purpose.
    await plantPayment({
      id: "pay-e2e-7",
      reservationId: RESV,
      amountCents: 58880,
      taxCents: 3980,
      stripePaymentIntentId: "pi_e2e_7",
    });
    await signInAsAdmin(page, "spink");
    await page.goto(detail("&cancel=1"));

    await page.getByTestId("cancel-confirm").locator('input[name="amount"]').fill("0");
    await page.getByRole("button", { name: "Cancel and refund" }).click();
    await page.waitForURL(/cancelled=/);

    await expect(page.getByTestId("action-done")).toContainText("No refund was sent");
    // The boat is free regardless — that half never depended on the money.
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);
    await expect(page.getByText(`open · ${shortLabel(BOOKED.time)}`)).toBeVisible();
  });

  test("a resend that sent nothing says so, instead of a green Sent (#686)", async ({ page }) => {
    // The suite blanks Twilio (`playwright.config.ts`) and the seed booking is phone-only, so
    // this deployment has no channel for this booking's contact and NOTHING goes out. The old
    // action redirected `resent=1` regardless and the pane printed "Confirmation and manage link
    // sent again." — a green success over a send that never happened, on screen every time this
    // suite ran. The first cut of the replacement reported it as "Link sent again." for the same
    // reason; this test is what caught that.
    //
    // The per-channel copy (which address, which number, which one failed) is pinned in
    // `action-message.test.ts`, where every outcome can be driven directly. This asserts the one
    // end-to-end fact only a running deployment decides.
    await signInAsAdmin(page, "spink");
    await page.goto(detail());

    await page.getByRole("button", { name: /Resend confirmation/ }).click();
    await page.waitForURL(/resent=|resendErr=/);

    // Asserts the PROPERTY, not one deployment's phrasing. Which refusal fires depends on how
    // the runner happens to be configured — CI has no APP_BASE_URL or RESERVATION_LINK_SECRET so
    // it lands on `not_configured` ("…so nothing was sent"), while a dev box with those set but
    // no channels lands on `no_channels` ("Nothing was sent — …"). The first cut pinned the exact
    // capitalised string and so passed locally and failed in CI: a test that asserts the copy of
    // whichever branch the author's machine takes is testing the machine.
    //
    // What must hold on every one of them: an error is shown, it says nothing went out, and there
    // is no green success line beside it.
    await expect(page.getByTestId("action-error")).toContainText(/nothing was sent/i);
    await expect(page.getByTestId("action-done")).toHaveCount(0);
  });

  test("a half-applied cancel offers a repair instead of stranding the boat", async ({ page }) => {
    // The state a crash between `cancelReservation`'s two writes leaves: reservation Cancelled,
    // event still scheduled — so the hull is still held, the crew were never told, and the pane
    // reads "Cancelled" with nothing indicating a repair is owed. The core self-heals on a
    // re-run and its comment says so, but the first cut hid the cancel control the moment the
    // reservation flipped, making the re-run unreachable. Security review.
    await signInAsAdmin(page, "spink");
    await page.goto(detail());
    await page.getByTestId("cancel-start").click();
    await page.getByRole("button", { name: CANCEL_BUTTON }).click();
    await page.waitForURL(/cancelled=/);

    // Put the event back to `scheduled` behind the app's back — exactly the half-written state.
    await reopenEvent(BOOKED.date, BOOKED.time);
    await page.goto(detail());

    const repair = page.getByTestId("release-repair");
    await expect(repair).toContainText("never released");
    await repair.getByRole("button", { name: "Release the boat" }).click();
    await page.waitForURL(/cancelled=|cancelErr=/);

    // Repaired: the slot is back on sale and the repair prompt is gone.
    await expect(page.getByTestId("release-repair")).toHaveCount(0);
    await page.goto(`/admin/calendar?date=${BOOKED.date}`);
    await expect(page.getByText(`open · ${shortLabel(BOOKED.time)}`)).toBeVisible();
  });

  test("resend is offered when there is somewhere to send, and reports back", async ({ page }) => {
    await signInAsAdmin(page, "spink");
    await page.goto(detail());
    const pane = page.getByTestId("reservation-detail");

    await pane.getByRole("button", { name: "Resend confirmation + manage link" }).click();
    await page.waitForURL(/resent=1|resendErr=/);
    // Either outcome is legitimate in a test deployment (no channel is configured), but it
    // must SAY which — the failure this replaces was a button that reported nothing at all.
    await expect(page.getByTestId("action-done").or(page.getByTestId("action-error"))).toBeVisible();
  });
});
