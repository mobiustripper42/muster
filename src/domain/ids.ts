/**
 * Branded ID types.
 *
 * Each entity gets a nominal string ID so the compiler refuses to pass a
 * `ShiftId` where a `SeatId` is wanted, even though both are strings at runtime.
 * The `__brand` phantom field never exists at runtime — it is erased by tsc.
 */

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type VesselId = Brand<string, "VesselId">;
export type CrewMemberId = Brand<string, "CrewMemberId">;
export type CredentialId = Brand<string, "CredentialId">;
export type PtoWindowId = Brand<string, "PtoWindowId">;
export type EventId = Brand<string, "EventId">;
export type ReservationId = Brand<string, "ReservationId">;
export type ShiftId = Brand<string, "ShiftId">;
export type SeatId = Brand<string, "SeatId">;
export type AskId = Brand<string, "AskId">;
export type ReliabilityEventId = Brand<string, "ReliabilityEventId">;

/**
 * Cast a raw string into a branded ID. The single sanctioned entry point —
 * persistence adapters and tests mint IDs here; domain code never casts inline.
 */
export const asId = <B extends string>(raw: string): Brand<string, B> =>
  raw as Brand<string, B>;
