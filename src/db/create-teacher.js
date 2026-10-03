/**
 * Creates a teacher account, or resets the password of one.
 *
 *   npm run create-teacher -- 2042000001
 *   npm run create-teacher -- 2042000001 --reset
 *
 * There is no HTTP route for this and there is not going to be one: three
 * accounts, created by somebody who already has the database. See
 * docs/adr/0008-teacher-authentication.md.
 *
 * The password is generated here and printed once. It is never stored in
 * plain text, never written to a file, and never passed on the command line —
 * a password in argv is a password in the shell history and in the process
 * list of every other user on the machine.
 */
import { fileURLToPath } from "node:url";
import pg from "pg";
import { generatePassword, hashPassword, isTeacherId } from "../lib/teacher-auth.js";
import { requireDatabaseUrl } from "./connection-url.js";

/**
 * @param {object} options
 * @param {string} options.id            the teacher number
 * @param {boolean} [options.reset]      replace the password of an existing account
 * @param {string} [options.connectionString]
 * @param {Function} [options.log]
 * @returns {Promise<{id: string, password: string, created: boolean, sessionsRevoked: number}>}
 */
export async function createTeacher({ id, reset = false, connectionString, log = console.log } = {}) {
  if (!isTeacherId(id)) {
    throw new Error(
      `"${id}" is not a teacher number. It must be ten digits beginning with 2042, ` +
        `which is what tells the entry screen to ask for a password.`,
    );
  }

  const url = requireDatabaseUrl(connectionString);

  const password = generatePassword();
  const { salt, hash, iterations } = await hashPassword(password);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query("select 1 from teachers where id = $1", [id]);

    if (existing.rowCount > 0 && !reset) {
      // Not an upsert by default: silently replacing a working password
      // because of a repeated command is a locked-out teacher who has no way
      // to find out why.
      throw new Error(`teacher ${id} already exists. Pass --reset to replace their password.`);
    }

    // One transaction, so a reset cannot leave the old sessions alive next to
    // a new password.
    await client.query("begin");
    try {
      if (existing.rowCount === 0) {
        await client.query(
          `insert into teachers (id, password_salt, password_hash, iterations)
           values ($1, $2, $3, $4)`,
          [id, salt, hash, iterations],
        );
      } else {
        await client.query(
          `update teachers
              set password_salt = $2, password_hash = $3, iterations = $4,
                  password_set_at = now()
            where id = $1`,
          [id, salt, hash, iterations],
        );
      }

      // Changing a password ends the sessions opened with the old one. A reset
      // is what somebody does when they fear the password leaked, and leaving
      // a live cookie behind would make the reset decorative.
      const revoked = await client.query("delete from teacher_sessions where teacher_id = $1", [id]);

      // Forget the failures too, so a reset is not followed by a lockout
      // inherited from the attempts that prompted it.
      await client.query("delete from login_attempts where teacher_id = $1", [id]);

      await client.query("commit");
      const created = existing.rowCount === 0;
      log(created ? `created teacher ${id}` : `reset the password of teacher ${id}`);
      if (revoked.rowCount > 0) {
        log(`revoked ${revoked.rowCount} open session(s)`);
      }
      return { id, password, created, sessionsRevoked: revoked.rowCount };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

function parseArgv(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const reset = args.includes("--reset");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length !== 1) {
    throw new Error("usage: npm run create-teacher -- <2042XXXXXX> [--reset]");
  }
  return { id: positional[0], reset };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { id, reset } = parseArgv(process.argv.slice(2));
    const result = await createTeacher({ id, reset });

    // stdout, once, framed so it is not mistaken for progress output. Anything
    // that persists it — a log file, a scrollback shared in a chat — is a
    // password in plain text, which is why this says so out loud.
    console.log("");
    console.log(`  teacher  ${result.id}`);
    console.log(`  password ${result.password}`);
    console.log("");
    console.log("  Shown once and stored only as a hash: nothing can print it again.");
    console.log("  Hand it over, then clear it from your scrollback.");
    console.log("");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
