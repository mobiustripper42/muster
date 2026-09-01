import { afterEach, describe, expect, it, vi } from "vitest";
import { markDirty, retainBackTrap } from "./dirty-state";

/**
 * The Back/Forward trap's sentinel outlives the guard that pushed it (#835).
 *
 * `retainBackTrap` pushes a duplicate history entry so a Back press lands on it with the form
 * still intact. **It cannot remove that entry on unmount** — taking it out means calling
 * `history.back()` from an effect cleanup, which on the submit path races the server action's own
 * `redirect()`, on surfaces that include the payroll-feeding time clock. That trade is deliberate
 * and recorded in DEC-160 §7.
 *
 * So the entry is left behind, and the question is only who consumes it. While a guard is mounted
 * the handler consents (nothing dirty) and re-issues the step, so a Back press still goes back one
 * page. The defect was that the release ALSO removed the listener — so a sentinel left by a
 * guarded page you have since navigated away from had nobody listening, the URL did not change,
 * and the press appeared to do nothing.
 *
 * **Node environment, no jsdom** (`vitest.config.ts`), so `window` is stubbed. Its sibling
 * `form-dirty.ts` dodged this by taking `[name, value]` pairs instead of a DOM node; this module
 * cannot — `history` and `popstate` are the subject, not an implementation detail.
 */

type Listener = (e: Event) => void;

function stubWindow() {
  const listeners = new Map<string, Set<Listener>>();
  const fire = (type: string) => {
    const e = new Event(type);
    for (const fn of listeners.get(type) ?? []) fn(e);
  };
  const stack: unknown[] = [{}];
  const win = {
    history: {
      state: {} as Record<string, unknown>,
      pushState: (state: Record<string, unknown>) => {
        stack.push(state);
        win.history.state = state;
      },
      // Fires `popstate`, as a browser does. Not decoration: the module clears its `traversing`
      // latch on the pop its own `back()` causes, so a stub that only records the call leaves
      // that latch set and every later pop is swallowed as "ours". The first draft of this test
      // did exactly that and the second case failed for a reason that was not the code's.
      back: vi.fn(() => fire("popstate")),
    },
    location: { href: "https://example.test/admin/vessels" },
    confirm: vi.fn(() => true),
    addEventListener: (type: string, fn: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn);
    },
  };
  (globalThis as { window?: unknown }).window = win;
  return {
    win,
    popCount: () => listeners.get("popstate")?.size ?? 0,
    firePop: () => fire("popstate"),
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("retainBackTrap", () => {
  it("keeps listening after the last guard unmounts, so a stale sentinel is still consumed", () => {
    const { win, firePop } = stubWindow();

    // A guarded page mounts and unmounts — the operator visited it and navigated away. The
    // sentinel it pushed is still in the back stack; it cannot be removed (DEC-160 §7).
    retainBackTrap()();

    // Now a Back press on some other, unguarded page lands on that sentinel. Nothing is dirty,
    // so the trap must consent and re-issue the step the operator asked for.
    firePop();
    expect(win.history.back).toHaveBeenCalledTimes(1);
  });

  it("still asks when something is dirty", () => {
    const { win, firePop } = stubWindow();
    const release = retainBackTrap();
    markDirty(Symbol("a-form"), true);
    win.confirm.mockReturnValue(false);

    firePop();

    // Declined — the step is not taken, and the sentinel is replaced so the next press asks again.
    expect(win.confirm).toHaveBeenCalledTimes(1);
    expect(win.history.back).not.toHaveBeenCalled();
    release();
  });
});
