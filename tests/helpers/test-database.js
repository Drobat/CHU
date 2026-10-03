/**
 * Integration tests run against their own database, never the one a developer
 * is working in: they drop the schema on every run.
 *
 * The name is the development database plus a "_test" suffix, so a single
 * DATABASE_URL configures both and there is nothing extra to set up.
 */
import pg from "pg";

function loadEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env: the CI passes DATABASE_URL directly.
  }
}

export function testDatabaseUrl() {
  loadEnv();
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env, then run docker compose up -d db.");
  }
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  if (!name) throw new Error(`DATABASE_URL has no database name: ${base}`);
  if (name.endsWith("_test")) return url.toString();
  url.pathname = `/${name}_test`;
  return url.toString();
}

/** Creates the test database if needed, then empties it. */
export async function resetTestDatabase() {
  const testUrl = testDatabaseUrl();
  const name = new URL(testUrl).pathname.replace(/^\//, "");

  const admin = new pg.Client({ connectionString: new URL("/postgres", testUrl).toString() });
  await admin.connect();
  try {
    await admin.query(`create database "${name.replaceAll('"', '""')}"`);
  } catch (error) {
    // 42P04: already there, which is the normal case.
    if (error.code !== "42P04") throw error;
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query("drop schema public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
  return testUrl;
}

export async function query(connectionString, sql, values = []) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await client.query(sql, values);
  } finally {
    await client.end();
  }
}
