/**
 * Resolves the database URL for the scripts that talk to PostgreSQL directly.
 *
 * It exists for one error message. The three scripts each carried the same
 * check, and that check could not tell apart the two ways of having no URL:
 *
 *   - nothing set at all, which means `.env` has not been created yet;
 *   - set to the empty string, which is what
 *     `DATABASE_URL="$NEON_DATABASE_URL" npm run migrate` produces when
 *     `NEON_DATABASE_URL` lives in `.env`. A shell never reads `.env` — only
 *     Node does, through `--env-file-if-exists` — so the expansion happens in a
 *     shell that has never heard of the variable and yields "".
 *
 * The second case is the one worth naming, because an empty string *shadows*
 * the value in `.env` (a variable set to "" is still set), so the symptom is a
 * missing URL on a machine whose `.env` has a perfectly good one.
 */

const ABSENT =
  "DATABASE_URL is not set. Copy .env.example to .env, then run docker compose up -d db.";

const EMPTY =
  'DATABASE_URL is set but empty. If you ran DATABASE_URL="$SOMETHING" npm run …, ' +
  "that variable was empty in your shell: a shell does not read .env, so load it first " +
  "with `set -a && . ./.env && set +a`. An empty value also hides the one in .env, " +
  "which is why this is not falling back to the local database.";

/**
 * @param {string} [connectionString] an explicit URL, which always wins
 * @returns {string}
 */
export function requireDatabaseUrl(connectionString) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (url) return url;
  throw new Error(url === undefined ? ABSENT : EMPTY);
}
