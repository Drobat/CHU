/**
 * Provisions the two things Metabase needs from the local PostgreSQL, and
 * nothing more:
 *
 *   1. a login role that can only ever read the grades database;
 *   2. a database of its own, which Metabase owns and writes its dashboards,
 *      questions and accounts into.
 *
 * Why a script rather than a numbered migration: the role needs a password,
 * and a password cannot live in a committed .sql file. Migrations are plain SQL
 * read from disk and executed as-is, with no place to pass a value in, so the
 * password would either be hardcoded in the repository or the migration runner
 * would have to learn about parameters — for a role the production database
 * (Neon) must never have in the first place. A separate script keeps the secret
 * in .env, where every other credential of this project already lives.
 *
 * Why not an init script in /docker-entrypoint-initdb.d either: those run once,
 * when the cluster is first created. A contributor who already has a `pgdata`
 * volume would have to delete their database to get the role, and the grants
 * below cannot be written at init time anyway — the tables do not exist until
 * `npm run migrate` has run.
 *
 * Re-running this is expected: it is how tables added by a later migration get
 * granted. Every statement is written to be repeatable.
 */
import { fileURLToPath } from "node:url";
import pg from "pg";

/** The role name docker-compose.yml and the documentation use. */
export const READER_ROLE = "metabase_reader";

/** The database Metabase stores its own state in, on the same cluster. */
export const APP_DATABASE = "metabase_app";

/** Identifiers are interpolated, never parameterised — $1 is not valid there. */
function quoteIdentifier(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to use ${JSON.stringify(name)} as an identifier`);
  }
  return `"${name}"`;
}

async function roleExists(client, role) {
  const { rowCount } = await client.query("select 1 from pg_roles where rolname = $1", [role]);
  return rowCount > 0;
}

async function databaseExists(client, name) {
  const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
  return rowCount > 0;
}

/**
 * Creates the role if it is missing and resets its password otherwise, so that
 * changing METABASE_READER_PASSWORD in .env is applied by re-running this.
 *
 * The role is deliberately given no attributes: no SUPERUSER, no CREATEDB, no
 * CREATEROLE, no BYPASSRLS. `create role` defaults to all of those being off,
 * but they are spelled out because this is the one place where it matters, and
 * because an existing role created by hand may well have been given more.
 */
async function ensureRole(client, { role, password }) {
  const ident = quoteIdentifier(role);
  const literal = client.escapeLiteral(password);
  const attributes = "login nosuperuser nocreatedb nocreaterole noinherit nobypassrls";

  if (await roleExists(client, role)) {
    await client.query(`alter role ${ident} with ${attributes} password ${literal}`);
    return false;
  }
  await client.query(`create role ${ident} with ${attributes} password ${literal}`);
  return true;
}

/**
 * Metabase needs a read/write home for its own tables. It gets a separate
 * database that it owns, rather than a schema inside the grades database:
 * owning a database grants nothing in any other one, so the same credential
 * can be read-only on the grades and still create its ~200 tables here.
 *
 * This is also what makes dashboards survive `docker compose down` — they are
 * rows in the `pgdata` volume, not in the container's throwaway H2 file.
 */
async function ensureAppDatabase(client, { name, owner }) {
  if (await databaseExists(client, name)) return false;
  // create database cannot run inside a transaction; the client is in
  // autocommit here, which is why this is a bare query.
  await client.query(`create database ${quoteIdentifier(name)} owner ${quoteIdentifier(owner)}`);
  return true;
}

/**
 * Read-only on the grades database, enforced by the database rather than by
 * trusting Metabase to only ever issue selects.
 *
 * `revoke all` first: the grants are then a statement of everything the role
 * has, instead of an addition to whatever it was given before.
 *
 * The default privileges are the half that is easy to forget. `grant select on
 * all tables` only touches the tables that exist right now; a table created by
 * tomorrow's migration would be invisible to Metabase until someone re-ran
 * this. `alter default privileges` applies to tables created *later* by the
 * granting role — which is the role that runs the migrations, hence
 * current_user rather than a hardcoded name.
 */
async function grantReadOnly(client, { role, database }) {
  const ident = quoteIdentifier(role);

  await client.query(`revoke all on database ${quoteIdentifier(database)} from ${ident}`);
  await client.query(`revoke all on schema public from ${ident}`);
  await client.query(`revoke all on all tables in schema public from ${ident}`);
  await client.query(`revoke all on all sequences in schema public from ${ident}`);

  await client.query(`grant connect on database ${quoteIdentifier(database)} to ${ident}`);
  // usage, not create: the role can read the schema's contents and cannot add
  // anything of its own to it.
  await client.query(`grant usage on schema public to ${ident}`);
  // Covers views too, which is how student_grades_v becomes readable.
  await client.query(`grant select on all tables in schema public to ${ident}`);
  await client.query(
    `alter default privileges for role current_user in schema public grant select on tables to ${ident}`,
  );
}

/**
 * @param {object} options
 * @param {string} [options.connectionString] defaults to DATABASE_URL
 * @param {string} [options.password]          defaults to METABASE_READER_PASSWORD
 * @param {string} [options.role]              the login role to provision
 * @param {string|null} [options.appDatabase]  null skips the Metabase home database
 * @param {Function} [options.log]
 */
export async function setupMetabaseRole({
  connectionString,
  password,
  role = READER_ROLE,
  appDatabase = APP_DATABASE,
  log = console.log,
} = {}) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env, then run docker compose up -d db.");
  }
  const secret = password ?? process.env.METABASE_READER_PASSWORD;
  if (!secret) {
    throw new Error(
      "METABASE_READER_PASSWORD is not set. Add it to .env — see .env.example for the reference value.",
    );
  }

  const database = new URL(url).pathname.replace(/^\//, "");
  if (!database) throw new Error(`DATABASE_URL has no database name: ${url}`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    log((await ensureRole(client, { role, password: secret })) ? `created role ${role}` : `updated role ${role}`);

    await grantReadOnly(client, { role, database });
    log(`granted read-only access on ${database} to ${role}`);

    if (appDatabase) {
      const created = await ensureAppDatabase(client, { name: appDatabase, owner: role });
      log(created ? `created database ${appDatabase} owned by ${role}` : `database ${appDatabase} is already there`);
    }
  } finally {
    await client.end();
  }
}

// Only run when invoked directly, so the integration tests can import it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupMetabaseRole().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
