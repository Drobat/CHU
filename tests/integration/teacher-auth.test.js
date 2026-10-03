/**
 * Teacher authentication against the real Worker and a real PostgreSQL.
 *
 * The unit tests cover the primitives; what is checked here is everything that
 * only exists once a database and a request are involved — the rate limit, the
 * cookie attributes, that logging out really deletes a row, and that a teacher
 * number is refused by the student path.
 *
 * These tests send an Origin header on every POST. That is not scaffolding to
 * work around: the Worker refuses a state-changing request without one, and
 * saying so here is how that requirement stays visible.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../worker/index.js";
import { migrate } from "../../src/db/migrate.js";
import { createTeacher } from "../../src/db/create-teacher.js";
import { MAX_FAILED_ATTEMPTS } from "../../src/lib/teacher-auth.js";
import { query, resetTestDatabase } from "../helpers/test-database.js";

const silent = () => {};
const ORIGIN = "https://example.test";
const TEACHER = "2042000001";

let db;

/** Calls the Worker the way Cloudflare does, and keeps the raw response. */
async function call(path, { origin, cookie, body, method = "GET" } = {}) {
  const pending = [];
  const headers = { accept: "application/json" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { HYPERDRIVE: { connectionString: db } },
    { waitUntil: (promise) => pending.push(promise) },
  );

  const text = await response.text();
  await Promise.allSettled(pending);
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    setCookie: response.headers.get("set-cookie"),
  };
}

const login = (body, options = {}) =>
  call("/api/teachers/login", { method: "POST", origin: ORIGIN, body, ...options });

/** The cookie header a browser would send back from a Set-Cookie. */
const cookieFrom = (setCookie) => setCookie.split(";")[0];

beforeEach(async () => {
  db = await resetTestDatabase();
  await migrate({ connectionString: db, log: silent });
}, 120_000);

describe("teacher login", () => {
  it("accepts the generated password and sets a locked-down cookie", async () => {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });

    const response = await login({ id: TEACHER, password });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(TEACHER);

    // Every attribute is load-bearing and each one is asserted, because a
    // cookie that loses one of them is still a working cookie.
    expect(response.setCookie).toMatch(/^teacher_session=/);
    expect(response.setCookie).toContain("HttpOnly");
    expect(response.setCookie).toContain("Secure");
    expect(response.setCookie).toContain("SameSite=Lax");
    expect(response.setCookie).toContain("Path=/");

    // The database holds a digest, never the token that is in the cookie.
    const token = cookieFrom(response.setCookie).split("=")[1];
    const { rows } = await query(db, "select teacher_id, encode(token_hash, 'hex') as hash from teacher_sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0].teacher_id).toBe(TEACHER);
    expect(rows[0].hash).not.toContain(token);
  });

  it("refuses a wrong password, an unknown number and a malformed one the same way", async () => {
    await createTeacher({ id: TEACHER, connectionString: db, log: silent });

    const wrong = await login({ id: TEACHER, password: "not the password" });
    const unknown = await login({ id: "2042999999", password: "not the password" });
    const malformed = await login({ id: "2024904082", password: "not the password" });
    const empty = await login({ id: TEACHER, password: "" });

    for (const response of [wrong, unknown, malformed, empty]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Invalid ID or password" });
      expect(response.setCookie).toBeNull();
    }
    // Indistinguishable from the outside is the point: nothing in the four
    // answers says which of the number or the password was wrong.
    expect(new Set([wrong, unknown, malformed, empty].map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it("gives a long session only when stay-signed-in is checked", async () => {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });

    const short = await login({ id: TEACHER, password });
    const long = await login({ id: TEACHER, password, remember: true });

    const hours = (iso) => (Date.parse(iso) - Date.now()) / 3_600_000;
    expect(hours(short.body.expiresAt)).toBeGreaterThan(11.5);
    expect(hours(short.body.expiresAt)).toBeLessThan(12.5);
    expect(hours(long.body.expiresAt)).toBeGreaterThan(29 * 24);

    // The cookie's lifetime follows the session's, so the browser is not left
    // holding a token the server has already stopped honouring.
    expect(Number(short.setCookie.match(/Max-Age=(\d+)/)[1])).toBeLessThan(13 * 3600);
    expect(Number(long.setCookie.match(/Max-Age=(\d+)/)[1])).toBeGreaterThan(29 * 24 * 3600);
  });

  it("omitting remember is the short session, not the long one", async () => {
    // The checkbox is unchecked by default. A body that leaves the flag out
    // must not be read as "stay signed in".
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });
    for (const body of [{ id: TEACHER, password }, { id: TEACHER, password, remember: "yes" }]) {
      const response = await login(body);
      const hours = (Date.parse(response.body.expiresAt) - Date.now()) / 3_600_000;
      expect(hours).toBeLessThan(12.5);
    }
  });
});

describe("the rate limit", () => {
  it("blocks the sixth failure within the window, right password included", async () => {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });

    for (let attempt = 1; attempt <= MAX_FAILED_ATTEMPTS; attempt++) {
      const response = await login({ id: TEACHER, password: "wrong" });
      expect(response.status).toBe(401);
    }

    expect((await login({ id: TEACHER, password: "wrong" })).status).toBe(429);

    // The account's own password is blocked too. A limit that still honoured
    // it would only slow an attacker down, while leaving the account open to
    // the guess that happens to be right.
    const stillBlocked = await login({ id: TEACHER, password });
    expect(stillBlocked.status).toBe(429);
    expect(stillBlocked.setCookie).toBeNull();
    expect((await query(db, "select count(*)::int as n from teacher_sessions")).rows[0].n).toBe(0);
  });

  it("counts attempts against a number that does not exist", async () => {
    // Otherwise the limit answers "is this number a teacher?" by whether it
    // can be locked out.
    for (let attempt = 1; attempt <= MAX_FAILED_ATTEMPTS; attempt++) {
      expect((await login({ id: "2042999999", password: "wrong" })).status).toBe(401);
    }
    expect((await login({ id: "2042999999", password: "wrong" })).status).toBe(429);
  });

  it("forgets the failures once the right password is given", async () => {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });

    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      await login({ id: TEACHER, password: "wrong" });
    }
    expect((await login({ id: TEACHER, password })).status).toBe(200);

    const { rows } = await query(db, "select count(*)::int as n from login_attempts where teacher_id = $1", [TEACHER]);
    expect(rows[0].n).toBe(0);

    // So the next mistake starts from zero rather than from a near-lockout.
    expect((await login({ id: TEACHER, password: "wrong" })).status).toBe(401);
  });

  it("does not let one number's failures lock another", async () => {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });
    for (let attempt = 0; attempt <= MAX_FAILED_ATTEMPTS; attempt++) {
      await login({ id: "2042999999", password: "wrong" });
    }
    expect((await login({ id: TEACHER, password })).status).toBe(200);
  });
});

describe("the session", () => {
  async function signedIn(remember = false) {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });
    const response = await login({ id: TEACHER, password, remember });
    return cookieFrom(response.setCookie);
  }

  it("identifies the teacher on /api/teachers/me", async () => {
    const cookie = await signedIn();
    const response = await call("/api/teachers/me", { cookie });
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(TEACHER);
  });

  it("answers 401 without a cookie and for a forged one", async () => {
    await signedIn();
    expect((await call("/api/teachers/me")).status).toBe(401);
    expect((await call("/api/teachers/me", { cookie: "teacher_session=invented" })).status).toBe(401);
    expect((await call("/api/teachers/me", { cookie: "something=else" })).status).toBe(401);
  });

  it("stops honouring a session once it has expired", async () => {
    // With the real cookie, not a forged one. An earlier version of this test
    // expired the row and then presented an invented token, which would have
    // been refused anyway — so it passed with the expiry check removed and
    // proved nothing. Expiry is enforced by the query rather than by a sweep,
    // so a session nobody cleaned up has to be dead on sight.
    const cookie = await signedIn();
    expect((await call("/api/teachers/me", { cookie })).status).toBe(200);

    await query(db, "update teacher_sessions set expires_at = now() - interval '1 minute'");

    expect((await call("/api/teachers/me", { cookie })).status).toBe(401);
    // And it cannot be used to log out either, which is the other route that
    // trusts the cookie.
    const logout = await call("/api/teachers/logout", { method: "POST", origin: ORIGIN, cookie });
    expect(logout.status).toBe(401);
  });

  it("slides a long session and leaves a short one alone", async () => {
    const remembered = await signedIn(true);
    const before = (await query(db, "select expires_at from teacher_sessions")).rows[0].expires_at;
    await query(db, "update teacher_sessions set expires_at = expires_at - interval '1 day'");
    await call("/api/teachers/me", { cookie: remembered });
    const after = (await query(db, "select expires_at from teacher_sessions")).rows[0].expires_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime() - 60_000);

    await query(db, "delete from teacher_sessions");
    await query(db, "delete from teachers");
    const short = await signedIn(false);
    const shortBefore = (await query(db, "select expires_at from teacher_sessions")).rows[0].expires_at;
    await call("/api/teachers/me", { cookie: short });
    const shortAfter = (await query(db, "select expires_at from teacher_sessions")).rows[0].expires_at;
    expect(shortAfter.getTime()).toBe(shortBefore.getTime());
  });

  it("records the last time it was used", async () => {
    const cookie = await signedIn();
    await query(db, "update teacher_sessions set last_seen_at = now() - interval '1 hour'");
    await call("/api/teachers/me", { cookie });
    const { rows } = await query(db, "select last_seen_at > now() - interval '1 minute' as fresh from teacher_sessions");
    expect(rows[0].fresh).toBe(true);
  });
});

describe("logging out", () => {
  it("deletes the session in the database and clears the cookie", async () => {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });
    const cookie = cookieFrom((await login({ id: TEACHER, password })).setCookie);

    const response = await call("/api/teachers/logout", { method: "POST", origin: ORIGIN, cookie });
    expect(response.status).toBe(200);
    expect(response.setCookie).toContain("Max-Age=0");

    // The row is gone, which is what makes a stolen cookie stop working rather
    // than merely being asked not to be used.
    const { rows } = await query(db, "select count(*)::int as n from teacher_sessions");
    expect(rows[0].n).toBe(0);

    // And the cookie the browser still holds is now worthless.
    expect((await call("/api/teachers/me", { cookie })).status).toBe(401);
  });

  it("is a write route: 401 without a session, 403 from a foreign origin", async () => {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });
    const cookie = cookieFrom((await login({ id: TEACHER, password })).setCookie);

    expect((await call("/api/teachers/logout", { method: "POST", origin: ORIGIN })).status).toBe(401);

    // Origin is checked before the session, so a foreign page gets 403 whether
    // or not it managed to attach a cookie.
    const foreign = await call("/api/teachers/logout", {
      method: "POST",
      origin: "https://attacker.test",
      cookie,
    });
    expect(foreign.status).toBe(403);

    const noOrigin = await call("/api/teachers/logout", { method: "POST", cookie });
    expect(noOrigin.status).toBe(403);

    // None of the refusals destroyed the session.
    const { rows } = await query(db, "select count(*)::int as n from teacher_sessions");
    expect(rows[0].n).toBe(1);
  });
});

describe("cross-origin requests", () => {
  it("are refused on login, before the password is even looked at", async () => {
    const { password } = await createTeacher({ id: TEACHER, connectionString: db, log: silent });

    const foreign = await login({ id: TEACHER, password }, { origin: "https://attacker.test" });
    expect(foreign.status).toBe(403);
    expect(foreign.setCookie).toBeNull();

    const missing = await call("/api/teachers/login", {
      method: "POST",
      body: { id: TEACHER, password },
    });
    expect(missing.status).toBe(403);

    // No session was created by either, and no failure was recorded against
    // the number: a refused origin is not a failed password.
    expect((await query(db, "select count(*)::int as n from teacher_sessions")).rows[0].n).toBe(0);
    expect((await query(db, "select count(*)::int as n from login_attempts")).rows[0].n).toBe(0);
  });
});

describe("teacher numbers stay out of the student paths", () => {
  it("are refused by the student API", async () => {
    await createTeacher({ id: TEACHER, connectionString: db, log: silent });

    const summary = await call(`/api/students/${TEACHER}`);
    expect(summary.status).toBe(400);
    expect(summary.body.error).toBe("invalid student id");

    const detail = await call(`/api/students/${TEACHER}/assessments/1`);
    expect(detail.status).toBe(400);
  });

  it("cannot be inserted as a student, whatever asks", async () => {
    // The application check above and this one are deliberate duplicates: the
    // database sees the import and a psql session, which the Worker does not.
    await expect(
      query(db, "insert into students (id, cohort_id) values ($1, (select id from cohorts limit 1))", [TEACHER]),
    ).rejects.toThrow(/students_id_not_a_teacher/);
  });

  it("still lets a normal student number through", async () => {
    // The guard must not have made the student API stricter than it was: a
    // 2024 number is a transposition of the teacher prefix and must work.
    const response = await call("/api/students/2024904082");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("unknown student");
  });
});

describe("the methods each route accepts", () => {
  it("keeps the read API GET-only and the write routes POST-only", async () => {
    expect((await call("/api/health", { method: "POST", origin: ORIGIN })).status).toBe(405);
    expect((await call("/api/teachers/login", { method: "GET" })).status).toBe(405);
    expect((await call("/api/teachers/logout", { method: "GET" })).status).toBe(405);
    expect((await call("/api/teachers/me", { method: "POST", origin: ORIGIN })).status).toBe(405);
  });
});
