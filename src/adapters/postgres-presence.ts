/**
 * Postgres PresencePort adapter (#112, DEC-047). Persists the coarse activity
 * signal in the `presence` table (composite PK `(subject_kind, subject_id)` —
 * DEC-058). Shares the app's pg pool. The realtime swap (DEC-047) would be a
 * sibling adapter on the same port, not a change here.
 */
import pg from "pg";
import type { AuthSubjectKind, Subject } from "../domain/entities.js";
import { subjectKey } from "../domain/subject.js";
import type { PresencePort } from "../ports/presence.js";

export class PostgresPresence implements PresencePort {
  readonly #pool: pg.Pool;

  // No fromConnectionString/close: the app constructs this from the shared pool
  // (getPresence), and the tests own their pool — a close() here would end the
  // shared app pool the Repository also uses. The realtime swap (DEC-047) is a
  // sibling adapter, so this one never owns a connection lifecycle.
  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async recordActivity(subject: Subject, at: string): Promise<void> {
    await this.#pool.query(
      `insert into presence(subject_kind, subject_id, last_active_at) values ($1,$2,$3)
       on conflict (subject_kind, subject_id) do update set last_active_at=excluded.last_active_at`,
      [subject.kind, subject.id, at],
    );
  }

  async lastActiveFor(subjects: Subject[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (subjects.length === 0) return out;
    // Batched read: pair the (kind, id) inputs element-wise via unnest and join —
    // one round-trip, parameterized, no dynamic SQL. Matches the composite PK.
    const { rows } = await this.#pool.query<{
      subject_kind: string;
      subject_id: string;
      last_active_at: string;
    }>(
      `select p.subject_kind, p.subject_id, p.last_active_at
         from presence p
         join unnest($1::text[], $2::text[]) as q(kind, id)
           on p.subject_kind = q.kind and p.subject_id = q.id`,
      [subjects.map((s) => s.kind), subjects.map((s) => s.id)],
    );
    for (const r of rows) {
      out.set(
        subjectKey({ kind: r.subject_kind as AuthSubjectKind, id: r.subject_id }),
        r.last_active_at,
      );
    }
    return out;
  }
}
