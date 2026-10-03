/**
 * The point of metabase_reader is that the database refuses its writes. That
 * is a claim about privileges, and privileges are exactly the kind of thing
 * that quietly stops being true — a later migration adds a table, someone
 * grants a little too much to get an import working. So it is asserted here
 * rather than trusted.
 *
 * Two things make this test safe to run on a workstation:
 *
 * - It provisions a role named metabase_reader_test, not metabase_reader.
 *   Roles are cluster-wide, so resetting the password of the real role would
 *   silently break the Metabase a contributor has running. The grant logic is
 *   the same code either way; only the name differs.
 * - It works in the <database>_test database, like every other integration
 *   test, so the grades a contributor is working on are never touched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../src/db/migrate.js";
import { APP_DATABASE, READER_ROLE, setupMetabaseRole } from "../../src/db/metabase-role.js";
import { query, resetTestDatabase } from "../helpers/test-database.js";

const silent = () => {};

const ROLE = `${READER_ROLE}_test`;
const APP_DB = `${APP_DATABASE}_test`;
const PASSWORD = "metabase-reader-integration-test";

/** The admin connection string, and the same one rewritten for the reader. */
let adminUrl;
let readerUrl;

/** Runs `sql` as metabase_reader_test and returns the PostgreSQL error code. */
async function errorCodeFor(sql, connectionString = readerUrl) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } catch (error) {
    return error.code;
  } finally {
    await client.end();
  }
  return null;
}

/** 42501 is insufficient_privilege: the database refused, it did not fail. */
const INSUFFICIENT_PRIVILEGE = "42501";

beforeAll(async () => {
  adminUrl = await resetTestDatabase();
  await migrate({ connectionString: adminUrl, log: silent });
  await setupMetabaseRole({
    connectionString: adminUrl,
    password: PASSWORD,
    role: ROLE,
    appDatabase: APP_DB,
    log: silent,
  });

  const url = new URL(adminUrl);
  url.username = ROLE;
  url.password = PASSWORD;
  readerUrl = url.toString();
}, 120_000);

afterAll(async () => {
  if (!adminUrl) return;
  // Leaving a cluster-wide role and a spare database behind would make the
  // next run of this test assert against yesterday's grants.
  await query(adminUrl, `drop database if exists "${APP_DB}"`).catch(() => {});
  await query(adminUrl, `drop owned by "${ROLE}"`).catch(() => {});
  await query(adminUrl, `drop role if exists "${ROLE}"`).catch(() => {});
});

describe("the metabase_reader role", () => {
  it("reads the business tables and the student view", async () => {
    // Four objects rather than one: the grades are the point, the view is what
    // the API reads, and courses and cohorts are what a dashboard groups by.
    for (const relation of ["grades", "courses", "cohorts", "student_grades_v"]) {
      const { rows } = await query(readerUrl, `select count(*)::int as n from ${relation}`);
      expect(rows[0].n).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses every way of writing a grade", async () => {
    expect(await errorCodeFor("insert into cohorts (entry_year) values (2099)")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCodeFor("update grades set grade = 20")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCodeFor("delete from grades")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCodeFor("truncate grades")).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("refuses to write through the view students read", async () => {
    // Refused with 55000 (object_not_in_prerequisite_state), not 42501:
    // student_grades_v joins seven tables, so PostgreSQL rejects it as not
    // automatically updatable before it ever looks at who is asking. The
    // reason is checked rather than just "it threw", because the day somebody
    // adds an INSTEAD OF trigger to that view, the refusal starts depending on
    // privileges alone — and this assertion is what will say so.
    expect(await errorCodeFor("update student_grades_v set grade = 20")).toBe("55000");
  });

  it("cannot reshape the schema or add anything of its own to it", async () => {
    expect(await errorCodeFor("create table metabase_was_here (i int)")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCodeFor("drop table grades")).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCodeFor("create schema mine")).toBe(INSUFFICIENT_PRIVILEGE);
    // Not 42501: altering a table is owner-only, and PostgreSQL reports a
    // missing ownership rather than a missing privilege. The write is refused
    // all the same, which is what this asserts.
    expect(await errorCodeFor("alter table grades add column injected int")).toBe("42501");
  });

  it("has no attribute that would let it grant itself more", async () => {
    const { rows } = await query(
      adminUrl,
      "select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin from pg_roles where rolname = $1",
      [ROLE],
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
      // It still has to be able to connect — that is the whole purpose.
      rolcanlogin: true,
    });
  });

  it("reads a table added after the grant, without the grant being repeated", async () => {
    // This is the half that is easy to get wrong: `grant select on all tables`
    // is a one-off over the tables that exist that day. A table from a future
    // migration has to be readable without anyone remembering to re-grant, or
    // Metabase shows a dashboard that is quietly missing the newest data.
    await query(adminUrl, "create table a_later_migration (i int)");
    try {
      const { rows } = await query(readerUrl, "select count(*)::int as n from a_later_migration");
      expect(rows[0].n).toBe(0);
      expect(await errorCodeFor("insert into a_later_migration values (1)")).toBe(INSUFFICIENT_PRIVILEGE);
    } finally {
      await query(adminUrl, "drop table a_later_migration");
    }
  });

  it("writes only inside the database it owns, which is what keeps dashboards", async () => {
    // Metabase stores its dashboards with this same credential. If it could
    // not write here it would not start; if this were the grades database the
    // read-only guarantee above would be worthless. Both halves are the point.
    const appUrl = new URL(readerUrl);
    appUrl.pathname = `/${APP_DB}`;
    const url = appUrl.toString();

    await query(url, "create table pretend_dashboard (name text)");
    await query(url, "insert into pretend_dashboard values ('average by promotion')");
    const { rows } = await query(url, "select name from pretend_dashboard");
    expect(rows).toEqual([{ name: "average by promotion" }]);

    // And the grades database is still refused from the same credential.
    expect(await errorCodeFor("insert into cohorts (entry_year) values (2098)")).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("is provisioned the same way twice", async () => {
    // Re-running npm run metabase:setup is the documented way to pick up the
    // tables a new migration added, so it has to be safe on a database that
    // already has the role.
    await expect(
      setupMetabaseRole({
        connectionString: adminUrl,
        password: PASSWORD,
        role: ROLE,
        appDatabase: APP_DB,
        log: silent,
      }),
    ).resolves.toBeUndefined();

    const { rows } = await query(readerUrl, "select count(*)::int as n from courses");
    expect(rows[0].n).toBeGreaterThanOrEqual(0);
  });
});
