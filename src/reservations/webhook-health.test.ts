/**
 * The webhook-endpoint check (15.16) — the three ways a registered endpoint stops delivering
 * without producing a single failed delivery for Stripe to email about.
 */
import { describe, expect, it, vi } from "vitest";
import type { WebhookEndpointInfo } from "../ports/payment.js";
import { checkWebhookEndpoint, monitorWebhookEndpoint } from "./webhook-health.js";

const OURS = "https://muster.example/api/webhooks/stripe";
/** The nine `parseEvent` branches on (`stripe-payment.ts:434-544`, `HANDLED_EVENT_TYPES`). */
const EVENTS = [
  "checkout.session.completed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.processing",
  "payment_intent.canceled",
];
const EXPECTED = { url: OURS, events: EVENTS };

const endpoint = (over: Partial<WebhookEndpointInfo> = {}): WebhookEndpointInfo => ({
  url: OURS,
  enabled: true,
  enabledEvents: EVENTS,
  ...over,
});

describe("checkWebhookEndpoint — the endpoint is registered, live, and subscribed", () => {
  it("ours, enabled, all nine events → healthy", () => {
    expect(checkWebhookEndpoint([endpoint()], EXPECTED)).toEqual({ ok: true });
  });

  it('["*"] satisfies the event check — the commonest real configuration', () => {
    // Stripe's wildcard. Treating it as a literal event name would alert on a working endpoint,
    // which is how an alert channel stops being read.
    expect(checkWebhookEndpoint([endpoint({ enabledEvents: ["*"] })], EXPECTED)).toEqual({ ok: true });
  });

  it("a trailing slash in the Dashboard still matches — no false alarm", () => {
    // `appBaseUrl()` strips trailing slashes; Stripe stores what the operator typed. Alerting
    // "endpoint is MISSING" about a working endpoint is the failure mode that gets a monitor muted.
    expect(checkWebhookEndpoint([endpoint({ url: `${OURS}/` })], EXPECTED)).toEqual({ ok: true });
  });

  it("an endpoint at a DIFFERENT url is not ours — missing", () => {
    // Seeded with a real endpoint rather than an empty list, so this fails for the right reason:
    // the account has webhooks, just not one pointing here. That is what a repointed deploy URL
    // or a stale preview registration actually looks like.
    const out = checkWebhookEndpoint(
      [endpoint({ url: "https://old-deploy.example/api/webhooks/stripe" })],
      EXPECTED,
    );
    expect(out).toMatchObject({ ok: false, problem: "missing" });
  });

  it("no endpoints at all — missing", () => {
    expect(checkWebhookEndpoint([], EXPECTED)).toMatchObject({ ok: false, problem: "missing" });
  });

  it("ours, but disabled — disabled, not missing", () => {
    // Stripe disables an endpoint after persistent failures, and a person can too. Distinct from
    // `missing` because the fix is different: re-enable, versus create and re-copy the secret.
    const out = checkWebhookEndpoint([endpoint({ enabled: false })], EXPECTED);
    expect(out).toMatchObject({ ok: false, problem: "disabled" });
  });

  it("subscribed to everything EXCEPT payment_intent.succeeded — events, and the detail names it", () => {
    // **The case this whole task is for.** Refunds, disputes and failures all keep flowing, so
    // every other signal looks healthy — and no booking is ever confirmed by webhook again.
    const out = checkWebhookEndpoint(
      [endpoint({ enabledEvents: EVENTS.filter((e) => e !== "payment_intent.succeeded") })],
      EXPECTED,
    );
    expect(out).toMatchObject({ ok: false, problem: "events" });
    if (out.ok) return;
    expect(out.detail).toContain("payment_intent.succeeded");
  });

  it("names EVERY missing event, not just the first", () => {
    // An operator who re-subscribes only the event the alert named gets a second alert four hours
    // later. Say all of it the first time.
    const out = checkWebhookEndpoint(
      [endpoint({ enabledEvents: ["checkout.session.completed", "payment_intent.succeeded"] })],
      EXPECTED,
    );
    expect(out).toMatchObject({ ok: false, problem: "events" });
    if (out.ok) return;
    expect(out.detail).toContain("charge.refunded");
    expect(out.detail).toContain("charge.dispute.created");
  });

  it("two ENABLED endpoints share our url and one is under-subscribed → events", () => {
    // **`@code-review`'s finding, and it was right.** The first cut took the first enabled match
    // and called it "the one delivering". Nothing here knows which one that is: the shape carries
    // no signing secret, Stripe delivers to every enabled endpoint at a URL, and only the one
    // matching the deployed `STRIPE_WEBHOOK_SECRET` verifies. Reporting off the wrong twin means
    // reporting healthy while the endpoint we actually accept is missing an event — this check
    // producing the exact failure it exists to catch. So every enabled twin must pass.
    const out = checkWebhookEndpoint(
      [
        endpoint(), // fully subscribed — the first one `find` would have picked
        endpoint({ enabledEvents: EVENTS.filter((e) => e !== "payment_intent.succeeded") }),
      ],
      EXPECTED,
    );
    expect(out).toMatchObject({ ok: false, problem: "events" });
    if (out.ok) return;
    expect(out.detail).toContain("2 enabled endpoints share that URL");
  });

  it("a DISABLED twin beside a healthy one is still ignored", () => {
    // The other direction: a leftover disabled registration delivers nothing and harms nothing.
    // Alerting on it would be crying wolf about a working system.
    expect(
      checkWebhookEndpoint([endpoint({ enabled: false }), endpoint()], EXPECTED),
    ).toEqual({ ok: true });
  });

  it("picks OUR endpoint out of several, ignoring healthy strangers", () => {
    // An account can carry up to 16 endpoints. A disabled one belonging to something else must
    // not be reported as our problem, and must not mask ours either.
    const out = checkWebhookEndpoint(
      [
        endpoint({ url: "https://other.example/hook", enabled: false }),
        endpoint({ enabled: false }),
      ],
      EXPECTED,
    );
    expect(out).toMatchObject({ ok: false, problem: "disabled" });
  });
});

describe("monitorWebhookEndpoint — asks, compares, and only speaks when something is wrong", () => {
  const deps = (endpoints: readonly WebhookEndpointInfo[] | Error) => {
    const alert = vi.fn(async (_m: string) => {});
    return {
      alert,
      deps: {
        alert,
        payments: {
          listWebhookEndpoints: async () => {
            if (endpoints instanceof Error) throw endpoints;
            return endpoints;
          },
        },
      },
    };
  };

  it("a disabled endpoint texts the admins once, naming what is wrong", async () => {
    const { deps: d, alert } = deps([endpoint({ enabled: false })]);
    const out = await monitorWebhookEndpoint(d, EXPECTED);
    expect(out).toEqual({ checked: true, healthy: false });
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0]![0]).toContain("DISABLED");
    // The consequence, not just the fault. An operator who reads "endpoint disabled" at 40
    // characters of SMS preview needs to know it is about money.
    expect(alert.mock.calls[0]![0]).toContain("paid and never confirmed");
  });

  it("a HEALTHY endpoint says nothing at all", async () => {
    // **The abort path, and the one that decides whether this channel stays readable.** Six runs a
    // day that each report "still fine" is how the seventh, which is not fine, gets ignored.
    const { deps: d, alert } = deps([endpoint()]);
    expect(await monitorWebhookEndpoint(d, EXPECTED)).toEqual({ checked: true, healthy: true });
    expect(alert).not.toHaveBeenCalled();
  });

  it("a Stripe read that THROWS is unknown, not broken — logged, no alert", async () => {
    // Texting every admin because Stripe's API had a bad minute is an alert about their outage on
    // our schedule. The next run asks again.
    const { deps: d, alert } = deps(new Error("stripe unreachable"));
    expect(await monitorWebhookEndpoint(d, EXPECTED)).toEqual({ checked: false, healthy: false });
    expect(alert).not.toHaveBeenCalled();
  });
});
