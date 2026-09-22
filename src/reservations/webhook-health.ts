/**
 * Is the webhook endpoint still doing its job? (15.16, issue #984)
 *
 * **Stripe tells you deliveries FAILED. Nothing tells you deliveries STOPPED.** A rotated signing
 * secret, a handler returning 500, a TLS problem — each produces failed deliveries, and Stripe
 * both retries them for three days and emails about them. But an endpoint that was deleted,
 * disabled, or left pointing at a previous deploy URL attempts no delivery at all, so there is no
 * failure to report and no email to receive. Below Stripe's Advanced support tier nothing on their
 * side covers that, and the symptom is a paid customer with no confirmation.
 *
 * **Why this asks the provider rather than watching our own traffic.** The tempting design is a
 * heartbeat — record when a webhook last verified, alert when that goes stale. It cannot work for
 * a single-operator charter business: three quiet days in April is an ordinary week, so silence
 * and failure are the same observation. Either the alert fires constantly or it is tuned so loose
 * it never fires. Asking what is registered works at any volume, including zero.
 *
 * Pure: the endpoint list and the expectation both arrive as arguments. The expectation's URL is
 * the edge's to compute (it needs `APP_BASE_URL`), and its event list is the adapter's, exported
 * beside the `parseEvent` branches that switch on those strings.
 */
import { logSwallowed } from "../log.js";
import type { PaymentPort, WebhookEndpointInfo } from "../ports/payment.js";

/**
 * `problem` is a narrow enum rather than a message so the caller can decide register per case, and
 * so a test asserts the finding rather than prose. `detail` is what goes to a person.
 */
export type WebhookHealth =
  | { ok: true }
  | { ok: false; problem: "missing" | "disabled" | "events"; detail: string };

/** Stripe's own wildcard: *"`['*']` indicates that all events are enabled"*. */
const ALL_EVENTS = "*";

/**
 * Compared with a trailing slash stripped from both sides. `appBaseUrl()` already strips them
 * (`app/lib/base-url.ts:42`), but Stripe stores whatever was typed into the Dashboard — and an
 * operator who typed one would otherwise get "endpoint is MISSING" about an endpoint that is
 * working. A monitor's first duty is not to cry wolf.
 */
const sameUrl = (a: string, b: string): boolean => trimTrailingSlashes(a) === trimTrailingSlashes(b);

/**
 * A loop rather than `/\/+$/`, because `sonarjs/super-linear-regex` flags that pattern for
 * backtracking — fairly, on a string the provider supplies. Linear, and it handles any number of
 * slashes, which matches what `appBaseUrl()` strips on our side.
 */
function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end -= 1;
  return s.slice(0, end);
}

export function checkWebhookEndpoint(
  endpoints: readonly WebhookEndpointInfo[],
  expected: { url: string; events: readonly string[] },
): WebhookHealth {
  const mine = endpoints.filter((e) => sameUrl(e.url, expected.url));
  if (mine.length === 0) {
    // Deliberately reports how many endpoints DO exist. "No endpoint for this URL" and "this
    // account has no webhooks at all" are the same finding with very different first moves, and
    // the operator reading this on a phone should not have to open the Dashboard to tell them
    // apart.
    return {
      ok: false,
      problem: "missing",
      detail: `no webhook endpoint registered for ${expected.url} (${endpoints.length} other endpoint(s) on the account)`,
    };
  }
  const live = mine.filter((e) => e.enabled);
  if (live.length === 0) {
    return {
      ok: false,
      problem: "disabled",
      detail: `the webhook endpoint for ${expected.url} is DISABLED - no events are being delivered`,
    };
  }
  // **Every enabled endpoint at our URL must be adequately subscribed, not merely one of them
  // (`@code-review`).** The first cut took `mine.find(e => e.enabled)` and called it "the one
  // delivering" — a claim this function cannot make. `WebhookEndpointInfo` carries no signing
  // secret, Stripe delivers to EVERY enabled endpoint at a URL, and only the one whose secret
  // matches the deployed `STRIPE_WEBHOOK_SECRET` actually verifies here. So with two enabled twins,
  // picking either one and reporting on it can report healthy off the endpoint that is NOT the one
  // whose deliveries we accept — the exact failure this check exists to catch, produced by the
  // check. A leftover DISABLED twin is still ignored: it delivers nothing and harms nothing.
  for (const e of live) {
    const missing = e.enabledEvents.includes(ALL_EVENTS)
      ? []
      : expected.events.filter((want) => !e.enabledEvents.includes(want));
    // Every missing event, not the first. An operator who re-subscribes only what the alert named
    // gets the same alert four hours later.
    if (missing.length > 0) {
      const which = live.length > 1 ? ` (${live.length} enabled endpoints share that URL)` : "";
      return {
        ok: false,
        problem: "events",
        detail: `the webhook endpoint for ${expected.url}${which} is not subscribed to ${missing.length} event(s) we handle: ${missing.join(", ")}`,
      };
    }
  }
  return { ok: true };
}

export interface WebhookMonitorDeps {
  payments: Pick<PaymentPort, "listWebhookEndpoints">;
  /** The money-alert lane — SMS to every active admin. Must not throw (`alertMoneyProblem`). */
  alert: (message: string) => Promise<void>;
}

/**
 * Ask the provider, compare, alert if something is wrong (15.16).
 *
 * **A provider read that throws is `unknown`, never `broken`.** Alerting on a failed
 * `listWebhookEndpoints` would text every admin about Stripe's outage rather than ours, on a
 * schedule, and the endpoint is almost certainly fine. Logged and dropped: the next run in four
 * hours asks again, and a fault that persists through Stripe's recovery is caught then.
 *
 * **Silent on healthy, and that is the load-bearing half.** A check that reports every four hours
 * whether or not anything is wrong trains the reader to ignore it, at which point the one that
 * matters arrives in a stream of noise. Nothing is sent unless something is wrong.
 */
export async function monitorWebhookEndpoint(
  deps: WebhookMonitorDeps,
  expected: { url: string; events: readonly string[] },
): Promise<{ checked: boolean; healthy: boolean }> {
  let endpoints: readonly WebhookEndpointInfo[];
  try {
    endpoints = await deps.payments.listWebhookEndpoints();
  } catch (e) {
    logSwallowed(
      "reservations:webhookMonitor",
      e,
      "could not read the account's webhook endpoints - endpoint health is UNKNOWN this run, not broken",
    );
    return { checked: false, healthy: false };
  }
  const health = checkWebhookEndpoint(endpoints, expected);
  if (health.ok) return { checked: true, healthy: true };
  // Routed through the money lane deliberately, despite reading as configuration rather than
  // money: while this is wrong, a paying customer's booking is never confirmed by webhook. The
  // operator's decision (2026-09-21) was SMS over email for exactly that reason.
  await deps.alert(`WEBHOOK NOT DELIVERING - ${health.detail}. Bookings may be paid and never confirmed.`);
  return { checked: true, healthy: false };
}
