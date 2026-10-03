import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { query, resetTestDatabase } from "../helpers/test-database.js";

const silent = () => {};

describe("npm run migrate", () => {
  it("builds the schema from an empty database and is a no-op the second time", async () => {
    const connectionString = await resetTestDatabase();

    const applied = await migrate({ connectionString, log: silent });
    expect(applied.length).toBeGreaterThan(0);
    expect(applied).toEqual([...applied].sort());

    const tables = (
      await query(
        connectionString,
        "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
      )
    ).rows.map((r) => r.table_name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "assessments",
        "classes",
        "cohorts",
        "courses",
        "grade_audit",
        "grades",
        "group_members",
        "groups",
        "schema_migrations",
        "students",
      ]),
    );

    // Running it again must change nothing: that is what makes it safe to call
    // on every deploy.
    expect(await migrate({ connectionString, log: silent })).toEqual([]);
  }, 60_000);

  it("keeps no student name anywhere in the schema", async () => {
    const connectionString = await resetTestDatabase();
    await migrate({ connectionString, log: silent });

    const named = (
      await query(
        connectionString,
        "select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name ilike '%name%'",
      )
    ).rows;

    expect(named).toEqual([]);
  }, 60_000);
});
