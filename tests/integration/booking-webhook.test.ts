// tests/integration/booking-webhook.test.ts
import { execSync } from "child_process";
import { Pool } from "pg";
import { processBookingCharge } from "../../src/reservations/booking-webhook";
import { StripeEvent } from "../../src/stripe/types";
import { clearDatabase } from "../utils/db-helper";

/**
 * Integration test that runs against a real Postgres instance (started by the
 * `npm run test:pg` script). It verifies that a payment which results in a
 * `lost` outcome no longer throws a FK violation and that the payment row is
 * persisted with a NULL reservation reference.
 */
describe("processBookingCharge – lost outcome", () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  beforeAll(async () => {
    // Ensure the schema is up‑to‑date – the test runner already executed the
    // migrations, but we guard against a missing table for local debugging.
    execSync("npm run db:migrate", { stdio: "inherit" });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await clearDatabase(pool);
  });

  it("records the payment with a NULL reservation_id and does not 500", async () => {
    // Build a minimal Stripe event that will trigger the `lost` branch.
    const event: StripeEvent = {
      id: "evt_test_lost",
      type: "charge.succeeded",
      data: {
        object: {
          id: "ch_test",
          amount: 5000,
          metadata: {
            // Intentionally omit a valid reservation identifier.
          },
        },
      },
    } as any;

    // The function should resolve without throwing.
    await expect(processBookingCharge(event)).resolves.not.toThrow();

    // Verify the payment row exists and reservation_id is NULL.
    const { rows } = await pool.query(
      "SELECT id, reservation_id FROM payments WHERE stripe_charge_id = $1",
      ["ch_test"]
    );
    expect(rows).toHaveLength(1);
    const payment = rows[0];
    expect(payment.reservation_id).toBeNull();
  });
});
