import { describe, expect, it } from "vitest";
import { answeredNoticeCode } from "./answered-code.js";

describe("answeredNoticeCode (#161 Yes/No feedback)", () => {
  it("a winning accept → in", () => {
    expect(
      answeredNoticeCode("accepted", { claimed: true, seatState: "Confirmed" }),
    ).toBe("in");
  });
  it("a decline → out (whatever the seat does)", () => {
    expect(
      answeredNoticeCode("declined", { claimed: false, seatState: "Open" }),
    ).toBe("out");
  });
  it("an accept that lost the CAS race → filled (the silent-vanish bug)", () => {
    expect(
      answeredNoticeCode("accepted", {
        claimed: false,
        reason: "already_filled",
        seatState: "Claimed",
      }),
    ).toBe("filled");
  });
  it("a double-booked accept → booked, not filled", () => {
    expect(
      answeredNoticeCode("accepted", {
        claimed: false,
        reason: "double_booked",
        seatState: "Asked",
      }),
    ).toBe("booked");
  });
  it("a re-tap of an already-answered ask → already, not filled (#145)", () => {
    expect(
      answeredNoticeCode("accepted", {
        claimed: false,
        reason: "already_answered",
        seatState: "Confirmed",
      }),
    ).toBe("already");
  });
});
