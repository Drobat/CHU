// The student API — see docs/adr/0006-cloudflare-workers-hosting.md
//
// Every read goes through student_grades_v, never through the tables. The rule
// about what a student may see (published assessment, nothing archived) lives in
// the view, so no endpoint can forget it. See src/db/migrations/0004.
//
// Static assets are served by the platform before this Worker runs; only /api/*
// reaches here, because run_worker_first routes it that way.

import { Client } from "pg";
import {
  ABSENT_ACCOUNT,
  ATTEMPT_WINDOW_MINUTES,
  MAX_FAILED_ATTEMPTS,
  createSessionToken,
  isStudentId,
  isTeacherId,
  SESSION_HOURS,
  SESSION_REMEMBER_DAYS,
  sessionExpiry,
  sessionTokenHash,
  verifyPassword,
} from "../src/lib/teacher-auth.js";

// Formatted in SQL rather than in JavaScript: a date column comes back as a
// Date at local midnight, and JSON.stringify would render it in UTC — east of
// Greenwich a deadline would move to the day before.
const DAYS = `
    to_char(held_on,      'YYYY-MM-DD') as held_on,
    to_char(starts_on,    'YYYY-MM-DD') as starts_on,
    to_char(due_on,       'YYYY-MM-DD') as due_on,
    to_char(published_at, 'YYYY-MM-DD') as published_on
`;

const SUMMARY_SQL = `
    select assessment_id, course_code, course_title, academic_year, level, semester,
           assessment_num, assessment_title, kind, total_points, coeff, grade,
           group_num, repository_url, group_comments,
           report is not null as has_report,
           -- Counted here rather than shipped: a card shows "18 correct, 2
           -- wrong", which is two integers, not the exam paper and the answers.
           case when jsonb_typeof(body -> 'questions') = 'array'
                then jsonb_array_length(body -> 'questions') end as question_count,
           case when wrong_answers is null then null
                else (select count(*) from jsonb_object_keys(wrong_answers)) end as wrong_count,
           ${DAYS}
      from student_grades_v
     where student_id = $1
     order by course_code, assessment_num
`;

const ASSESSMENT_SQL = `
    select assessment_id, course_code, course_title, assessment_num, assessment_title,
           kind, total_points, coeff, grade, report, body, wrong_answers,
           group_num, repository_url, group_comments,
           ${DAYS}
      from student_grades_v
     where student_id = $1 and assessment_id = $2
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    let client;
    const connect = async () => {
      client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
      await client.connect();
      return client;
    };

    try {
      // Teacher routes first, because they are the only ones that accept a
      // method other than GET and the only ones that may not be cached.
      if (path === "/api/teachers/login") {
        if (method !== "POST") return json({ error: "method not allowed" }, 405);
        if (!sameOrigin(request)) return json({ error: "cross-origin request" }, 403);
        return await teacherLogin(request, connect);
      }

      if (path === "/api/teachers/logout") {
        if (method !== "POST") return json({ error: "method not allowed" }, 405);
        // Origin before session: a cross-origin request is refused whether or
        // not it carries a cookie, so a foreign page cannot learn from the
        // difference.
        if (!sameOrigin(request)) return json({ error: "cross-origin request" }, 403);
        return await teacherLogout(request, connect);
      }

      if (path === "/api/teachers/me") {
        if (method !== "GET") return json({ error: "method not allowed" }, 405);
        const session = await currentTeacher(request, connect);
        if (!session) return json({ error: "not signed in" }, 401);
        return json({ id: session.teacher_id, expiresAt: session.expires_at });
      }

      if (method !== "GET") {
        return json({ error: "method not allowed" }, 405);
      }

      if (path === "/api/health") {
        const db = await connect();
        const { rows } = await db.query("select now() as now");
        return json({ ok: true, now: rows[0].now });
      }

      const summary = path.match(/^\/api\/students\/([^/]+)$/);
      if (summary) {
        return await studentSummary(decodeURIComponent(summary[1]), connect);
      }

      const detail = path.match(/^\/api\/students\/([^/]+)\/assessments\/([^/]+)$/);
      if (detail) {
        return await assessmentDetail(
          decodeURIComponent(detail[1]),
          decodeURIComponent(detail[2]),
          connect,
        );
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      // The message can carry the connection string; log it, never return it.
      console.error("api error", error);
      return json({ error: "internal error" }, 500);
    } finally {
      if (client) ctx.waitUntil(client.end());
    }
  },
};

const SESSION_COOKIE = "teacher_session";

/**
 * Cross-site request forgery defence for the routes that change state.
 *
 * A missing Origin is refused rather than waved through. Every current browser
 * sends it on a POST, including a same-origin one, so the only callers it
 * rejects are non-browser ones — which here means the integration tests, and
 * they say so explicitly. Treating absence as "probably fine" is how this kind
 * of check stops being one.
 */
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function cookie(request, name) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(token, maxAgeSeconds) {
  // HttpOnly so no script can read it, Secure so it never crosses plain HTTP
  // (localhost is treated as a secure context, so local development works),
  // SameSite=Lax so a foreign page cannot make the browser send it on a POST.
  // Path=/ because the cookie has to reach /api as well as the application.
  const attributes = `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
  return `${SESSION_COOKIE}=${token}; ${attributes}`;
}

/**
 * The session behind a request, or null.
 *
 * Only the digest of the cookie is ever compared, and the lookup is by primary
 * key on that digest: the token itself is nowhere in the database, so neither a
 * dump nor a careless select yields anything replayable.
 *
 * A long-lived session slides. Whether it is one is derived from the row rather
 * than stored: a session opened without "stay signed in" lasts exactly 12
 * hours, so expires_at minus created_at is greater than 12 hours only for the
 * ones opened with it. An explicit column would be plainer, and is the thing to
 * add if this ever grows a third duration.
 */
async function currentTeacher(request, connect) {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) return null;

  const db = await connect();
  // make_interval with bound parameters rather than an interpolated string:
  // the values are module constants and not user input, but a query built by
  // concatenation is a habit, and the habit is what eventually meets input.
  const { rows } = await db.query(
    `update teacher_sessions
        set last_seen_at = now(),
            expires_at = case
              when expires_at - created_at > make_interval(hours => $2)
              then now() + make_interval(days => $3)
              else expires_at
            end
      where token_hash = $1 and expires_at > now()
      returning teacher_id, expires_at`,
    [await sessionTokenHash(token), SESSION_HOURS, SESSION_REMEMBER_DAYS],
  );
  return rows[0] ?? null;
}

/**
 * One message and one status for every way of failing, so the response says
 * only "no".
 */
const REFUSED = { error: "Invalid ID or password" };

async function teacherLogin(request, connect) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(REFUSED, 401);
  }

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const remember = body?.remember === true;

  // A malformed number is refused with the same message as a wrong password:
  // the shape of a teacher number is not a secret, but saying which of the two
  // was wrong is a free hint.
  if (!isTeacherId(id)) return json(REFUSED, 401);

  const db = await connect();

  // Counted before the hash is computed, so a flood costs the CPU of a SELECT
  // rather than of a key derivation. A blocked number gets its own status: it
  // reveals that somebody is being attacked, not whether the number exists,
  // because attempts against numbers that do not exist are counted too.
  const { rows: recent } = await db.query(
    `select count(*)::int as failures
       from login_attempts
      where teacher_id = $1
        and attempted_at > now() - make_interval(mins => $2)`,
    [id, ATTEMPT_WINDOW_MINUTES],
  );
  if (recent[0].failures >= MAX_FAILED_ATTEMPTS) {
    return json({ error: "Too many attempts. Try again later." }, 429);
  }

  const { rows: found } = await db.query(
    "select password_salt, password_hash, iterations from teachers where id = $1",
    [id],
  );

  // An unknown number is hashed against a row that nothing can satisfy, so it
  // costs what a wrong password costs. Skipping this would let the response
  // time answer the question the single message refuses to answer.
  const account = found[0]
    ? { salt: found[0].password_salt, hash: found[0].password_hash, iterations: found[0].iterations }
    : ABSENT_ACCOUNT;

  const ok = await verifyPassword(password, account);

  if (!ok) {
    await db.query("insert into login_attempts (teacher_id) values ($1)", [id]);
    return json(REFUSED, 401);
  }

  const { token, tokenHash } = await createSessionToken();
  const expiresAt = sessionExpiry(remember);

  await db.query(
    "insert into teacher_sessions (token_hash, teacher_id, expires_at) values ($1, $2, $3)",
    [tokenHash, id, expiresAt],
  );
  // A success clears the record, so five failures followed by the right
  // password do not leave a trap for the next sign-in.
  await db.query("delete from login_attempts where teacher_id = $1", [id]);

  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  return json({ id, expiresAt: expiresAt.toISOString() }, 200, {
    "set-cookie": sessionCookie(token, maxAge),
  });
}

/**
 * Logging out requires a session, rather than answering 204 to anybody.
 *
 * It makes this the one write route that exists today, so the rule every
 * teacher write route will follow — a valid session and a matching Origin —
 * is enforced and tested somewhere rather than only described. An idempotent
 * 204 was the alternative and would have left that rule unexercised until
 * BDD-33.
 */
async function teacherLogout(request, connect) {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) return json({ error: "not signed in" }, 401);

  const db = await connect();
  const { rowCount } = await db.query(
    "delete from teacher_sessions where token_hash = $1 and expires_at > now()",
    [await sessionTokenHash(token)],
  );
  if (rowCount === 0) return json({ error: "not signed in" }, 401);

  // The row is gone, so the cookie is already useless; clearing it as well
  // keeps the browser from sending a token that can only ever be rejected.
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function studentSummary(studentId, connect) {
  // isStudentId, not the bare pattern: a teacher number is ten digits and
  // would satisfy it. ADR-0008 keeps the two populations apart on every path.
  if (!isStudentId(studentId)) return json({ error: "invalid student id" }, 400);

  const db = await connect();
  const { rows } = await db.query(SUMMARY_SQL, [studentId]);

  if (rows.length === 0) {
    // No visible grade is not the same as no such student: a student whose
    // promotion was archived must not be told their own number is unknown.
    const { rows: exists } = await db.query("select 1 from students where id = $1", [studentId]);
    if (exists.length === 0) return json({ error: "unknown student" }, 404);
  }

  const courses = new Map();
  for (const row of rows) {
    if (!courses.has(row.course_code)) {
      courses.set(row.course_code, {
        code: row.course_code,
        title: row.course_title,
        academicYear: row.academic_year,
        level: row.level,
        semester: row.semester,
        assessments: [],
      });
    }
    courses.get(row.course_code).assessments.push({
      ...assessmentFrom(row),
      hasReport: row.has_report,
      questionCount: row.question_count === null ? null : Number(row.question_count),
      // null means no answers were recorded for this exam, which the review
      // screen says differently from "none was wrong".
      wrongCount: row.wrong_count === null ? null : Number(row.wrong_count),
    });
  }

  return json({ studentId, courses: [...courses.values()] });
}

async function assessmentDetail(studentId, assessmentId, connect) {
  if (!isStudentId(studentId)) return json({ error: "invalid student id" }, 400);

  const db = await connect();
  const { rows } = await db.query(ASSESSMENT_SQL, [studentId, assessmentId]);
  // Also covers "this assessment belongs to someone else": the view is filtered
  // by student_id, so a mismatched pair returns nothing rather than a leak.
  if (rows.length === 0) return json({ error: "not found" }, 404);

  const row = rows[0];
  return json({
    studentId,
    courseCode: row.course_code,
    courseTitle: row.course_title,
    ...assessmentFrom(row),
    report: row.report,
    body: row.body,
    // null and {} mean different things: no answers were recorded, versus
    // answers were recorded and none was wrong. The review screen says
    // something different in each case.
    wrongAnswers: row.wrong_answers,
  });
}

/**
 * The shape both routes agree on. The summary adds hasReport, the detail adds
 * the report and the body; everything else is described in one place so the two
 * cannot drift into disagreeing about the same assessment.
 *
 * A project carries the group the student sat in — its number, not its name.
 */
function assessmentFrom(row) {
  return {
    id: row.assessment_id,
    num: row.assessment_num,
    title: row.assessment_title,
    kind: row.kind,
    totalPoints: Number(row.total_points),
    coeff: Number(row.coeff),
    // null means "not graded yet" and is excluded from the average — keep it null.
    grade: row.grade === null ? null : Number(row.grade),
    heldOn: row.held_on,
    startsOn: row.starts_on,
    dueOn: row.due_on,
    publishedOn: row.published_on,
    group:
      row.group_num === null
        ? null
        : {
            num: row.group_num,
            repositoryUrl: row.repository_url,
            comments: row.group_comments,
          },
  };
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Personal data: no shared cache, no browser cache. It also keeps
      // Hyperdrive and any intermediary from holding a logged-in response.
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}
