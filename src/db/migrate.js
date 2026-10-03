/**
 * Applies the SQL migrations of src/db/migrations in file-name order.
 *
 * A migration is applied once and never edited afterwards: the file name is
 * the version recorded in schema_migrations. There is no "down" — undoing
 * something means writing the migration that undoes it, which is what happens
 * in production anyway.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { requireDatabaseUrl } from "./connection-url.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

// Arbitrary but stable: two runners started at the same time must pick the
// same key for the lock to mean anything.
const LOCK_KEY = 4327811;

async function applyMigration(client, file) {
  const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into schema_migrations (version) values ($1)", [file]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
  }
}

export async function migrate({ connectionString, log = console.log } = {}) {
  const url = requireDatabaseUrl(connectionString);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied = [];
  try {
    // Serialises concurrent runners (a developer and the CI, two CI jobs)
    // instead of letting them race on the same schema.
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        version    text        primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const known = new Set(
      (await client.query("select version from schema_migrations")).rows.map((row) => row.version),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const pending = files.filter((f) => !known.has(f));

    for (const file of pending) {
      await applyMigration(client, file);
      applied.push(file);
      log(`applied ${file}`);
    }
    if (pending.length === 0) log("database is up to date");
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end();
  }
  return applied;
}

// Only run when invoked directly, so the integration tests can import migrate().
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
