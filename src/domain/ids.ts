/**
 * Branded ID types.
 *
 * Each entity gets a nominal string ID so the compiler refuses to pass a
 * `ShiftId` where a `SeatId` is wanted, even though both are strings at runtime.
 * The `__brand` phantom field never exists at runtime — it is erased by tsc.
 */

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type RoleTypeId = Brand<string, "RoleTypeId">;
export type VesselId = Brand<string, "VesselId">;
export type CrewMemberId = Brand<string, "CrewMemberId">;
export type CredentialId = Brand<string, "CredentialId">;
export type PtoWindowId = Brand<string, "PtoWindowId">;
export type EventId = Brand<string, "EventId">;
export type ReservationId = Brand<string, "ReservationId">;
export type OfferingId = Brand<string, "OfferingId">;
export type LocationId = Brand<string, "LocationId">;
export type BlockId = Brand<string, "BlockId">;
export type PaymentId = Brand<string, "PaymentId">;
export type ShiftId = Brand<string, "ShiftId">;
export type SeatId = Brand<string, "SeatId">;
export type SmsConsentId = Brand<string, "SmsConsentId">;
export type AskId = Brand<string, "AskId">;
export type ReliabilityEventId = Brand<string, "ReliabilityEventId">;
export type AuditEventId = Brand<string, "AuditEventId">;
export type MagicTokenId = Brand<string, "MagicTokenId">;
export type OutboxEntryId = Brand<string, "OutboxEntryId">;
export type RingOutboxEntryId = Brand<string, "RingOutboxEntryId">;
export type NoticeOutboxEntryId = Brand<string, "NoticeOutboxEntryId">;
export type ImportRunId = Brand<string, "ImportRunId">;
export type ImportRunItemId = Brand<string, "ImportRunItemId">;
export type ThreadId = Brand<string, "ThreadId">;
export type ParticipantId = Brand<string, "ParticipantId">;
export type MessageId = Brand<string, "MessageId">;

/**
 * Cast a raw string into a branded ID. The single sanctioned entry point —
 * persistence adapters and tests mint IDs here; domain code never casts inline.
 */
export const asId = <B extends string>(raw: string): Brand<string, B> =>
  raw as Brand<string, B>;
