/**
 * The only place the front end talks to the server.
 *
 * It replaces the build-time glob of src/data: the grades are no longer bundled
 * into the JavaScript every visitor downloads, they are fetched per student. A
 * student's own results weigh a few hundred bytes against the ~380 KB of
 * everyone's data that used to ship with the application.
 *
 * Every function throws ApiError on failure. Screens are expected to catch it:
 * unlike a bundled constant, a network call can fail, and a blank screen is not
 * an acceptable answer.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, kind = "network" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    // "notFound" lets the login screen tell an unknown number apart from an
    // unreachable server, which are two different things to say to a student.
    this.kind = kind;
  }
}

async function get(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(path, { signal, headers: { accept: "application/json" } });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw new ApiError("the server could not be reached", { kind: "network" });
  }

  if (response.status === 404) {
    throw new ApiError("not found", { status: 404, kind: "notFound" });
  }
  if (!response.ok) {
    throw new ApiError(`the server answered ${response.status}`, {
      status: response.status,
      kind: "server",
    });
  }

  try {
    return await response.json();
  } catch {
    // A JSON parse failure here usually means the SPA fallback answered with
    // index.html — an /api path that no route matched.
    throw new ApiError("the server answered something that is not JSON", {
      status: response.status,
      kind: "server",
    });
  }
}

/**
 * The same, for the routes that change something.
 *
 * Cookies travel because the request is same-origin, which is the default for
 * fetch and the reason nothing here touches credentials. The Origin header is
 * set by the browser and cannot be set from here, which is exactly what makes
 * the server's check on it worth anything.
 */
async function post(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError("the server could not be reached", { kind: "network" });
  }

  if (response.ok) {
    try {
      return await response.json();
    } catch {
      throw new ApiError("the server answered something that is not JSON", { kind: "server" });
    }
  }

  // 429 is the one failure worth telling apart from the others: "wrong
  // password" and "too many attempts" ask the teacher to do different things.
  // Everything else collapses into one kind, because the server deliberately
  // refuses to say which of the number or the password was wrong.
  throw new ApiError("the request was refused", {
    status: response.status,
    kind: response.status === 429 ? "rateLimited" : "refused",
  });
}

/**
 * Signs a teacher in. `remember` is the "stay signed in on this computer"
 * checkbox, and leaving it out is the short session — the server decides, not
 * this function.
 *
 * The password goes in the body and never in the URL: a query string ends up
 * in logs, in history and in a Referer header.
 */
export function loginTeacher({ id, password, remember = false }) {
  return post("/api/teachers/login", { id, password, remember });
}

/** Deletes the session server-side; the cookie it clears was never readable here. */
export function logoutTeacher() {
  return post("/api/teachers/logout");
}

/**
 * Who the session cookie belongs to, or null.
 *
 * Called once when the application starts, which is what makes a reload keep a
 * teacher signed in: the proof of being signed in is a cookie the page cannot
 * read, so the only way to know is to ask.
 */
export async function fetchTeacherSession() {
  try {
    return await get("/api/teachers/me");
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 401) return null;
    throw failure;
  }
}

/**
 * Everything a student's dashboard needs: their courses, and for each one the
 * assessments with their grade. Exam bodies and correction reports are left out
 * — they are fetched one at a time, when a screen actually opens one.
 */
export function fetchStudent(studentId, options) {
  return get(`/api/students/${encodeURIComponent(studentId)}`, options);
}

/** One assessment in full: its body for an exam, its report for a project. */
export function fetchAssessment(studentId, assessmentId, options) {
  return get(
    `/api/students/${encodeURIComponent(studentId)}/assessments/${encodeURIComponent(assessmentId)}`,
    options,
  );
}
