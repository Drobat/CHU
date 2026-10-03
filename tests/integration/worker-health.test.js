import { describe, expect, it } from "vitest";
import worker from "../../worker/index.js";
import { migrate } from "../../src/db/migrate.js";
import { resetTestDatabase } from "../helpers/test-database.js";

const silent = () => {};

/**
 * Calls the Worker the way Cloudflare does: the real fetch handler, a real
 * PostgreSQL behind the Hyperdrive binding, no deployment involved.
 */
async function call(connectionString, path, init) {
  const pending = [];
  const env = { HYPERDRIVE: { connectionString } };
  const ctx = { waitUntil: (promise) => pending.push(promise) };

  const response = await worker.fetch(new Request(`https://example.test${path}`, init), env, ctx);
  const body = await response.json();
  // The handler closes its client through waitUntil; without this the test
  // would finish while a connection is still open.
  await Promise.allSettled(pending);
  return { status: response.status, body };
}

describe("GET /api/health", () => {
  it("answers 200 and proves the database answered", async () => {
    const connectionString = await resetTestDatabase();
    await migrate({ connectionString, log: silent });

    const { status, body } = await call(connectionString, "/api/health");

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // now() comes from PostgreSQL: a handler that never reached the database
    // could not produce it.
    expect(Number.isNaN(Date.parse(body.now))).toBe(false);
    expect(Math.abs(Date.now() - Date.parse(body.now))).toBeLessThan(5 * 60 * 1000);
  }, 60_000);

  it("reports the database being unreachable instead of pretending to be healthy", async () => {
    // A health check that answers ok without a database is worse than none.
    const { status, body } = await call(
      "postgres://nobody:nobody@127.0.0.1:1/absent",
      "/api/health",
    );

    expect(status).toBe(500);
    expect(body.ok).toBeUndefined();
    // The message can carry the connection string, so it must not come back.
    expect(JSON.stringify(body)).not.toContain("nobody");
  }, 60_000);

  it("refuses a method other than GET", async () => {
    const connectionString = await resetTestDatabase();
    const { status } = await call(connectionString, "/api/health", { method: "POST" });
    expect(status).toBe(405);
  }, 60_000);
});
