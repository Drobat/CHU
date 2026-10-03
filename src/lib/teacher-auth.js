/**
 * Password hashing, session tokens and teacher-number validation.
 *
 * Pure in the same sense as grades.js: no React, no Vite, no database. It uses
 * WebCrypto and nothing else, which is why one implementation serves all three
 * callers — the Worker, the account script under Node, and the unit tests. A
 * second implementation would be a second thing to get wrong, and the two
 * would be free to disagree about what a stored hash means.
 *
 * The parameters and the reasoning behind them are in
 * docs/adr/0008-teacher-authentication.md. The short version: 50 000 PBKDF2
 * iterations is what fits the Workers free plan's 10 ms CPU limit, and it is
 * enough only because passwords here are machine-generated and never chosen by
 * a human. If that ever stops being true, the count has to be revisited.
 */

/** Teacher numbers: ten digits, 2042 then six. See the ADR for the prefix. */
export const TEACHER_ID = /^2042[0-9]{6}$/;

/**
 * Student numbers are 8 digits today and the demo accounts were 4, so the
 * length stays lenient and the alphabet strict — the same rule the Worker
 * already applied, with the teacher prefix now carved out of it.
 */
export const STUDENT_ID = /^[0-9]{4,10}$/;

export const PASSWORD_MIN_LENGTH = 12;

/** Measured in workerd: 6-8 ms. See the measurement table in the ADR. */
export const PBKDF2_ITERATIONS = 50_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const TOKEN_BYTES = 32;

/** Unchecked "stay signed in" gives 12 hours, checked gives 30 sliding days. */
export const SESSION_HOURS = 12;
export const SESSION_REMEMBER_DAYS = 30;

/** Five failures per number per 15 minutes, then blocked for 15 minutes. */
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MINUTES = 15;

export function isTeacherId(value) {
  return typeof value === "string" && TEACHER_ID.test(value);
}

/**
 * A teacher number is not a student number. The regex alone would accept one,
 * since 2042000001 is ten digits; the carve-out is the point of this function
 * and the reason callers should not test STUDENT_ID directly.
 */
export function isStudentId(value) {
  return typeof value === "string" && STUDENT_ID.test(value) && !value.startsWith("2042");
}

/**
 * Compares two byte sequences without leaking, through timing, where they
 * first differ.
 *
 * The lengths are compared normally: both are fixed-size digests, so the
 * length is not a secret, and pretending otherwise would only make this
 * harder to read.
 */
export function timingSafeEqual(a, b) {
  const left = toBytes(a);
  const right = toBytes(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("expected bytes");
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toBytes(salt), iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Derives a hash for a new or rotated password.
 *
 * Returns the salt and the iteration count alongside the hash because all
 * three belong together in the row: a hash whose parameters are stored
 * somewhere else cannot be verified after those parameters change.
 */
export async function hashPassword(password, { salt, iterations = PBKDF2_ITERATIONS } = {}) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`a password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  const chosenSalt = salt ? toBytes(salt) : crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return { salt: chosenSalt, hash: await pbkdf2(password, chosenSalt, iterations), iterations };
}

/**
 * Verifies a password against a stored row.
 *
 * The iteration count comes from the row, not from the constant above, which is
 * what lets the constant be raised without invalidating existing accounts.
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length === 0) return false;
  const derived = await pbkdf2(password, stored.salt, stored.iterations);
  return timingSafeEqual(derived, stored.hash);
}

/**
 * A row to verify against when the number is unknown.
 *
 * An unknown number must cost the same as a wrong password, or the response
 * time answers a question the single error message refuses to answer. The salt
 * is a constant because it protects nothing: there is no password behind it.
 */
export const ABSENT_ACCOUNT = {
  salt: new Uint8Array(SALT_BYTES),
  hash: new Uint8Array(HASH_BYTES),
  iterations: PBKDF2_ITERATIONS,
};

/**
 * Base58, so that a password printed once and typed by hand cannot be lost to
 * a zero read as an O. Twenty characters of it is about 117 bits.
 *
 * Rejection sampling rather than a modulo: 256 is not a multiple of 58, so
 * `byte % 58` would make the first 24 letters of the alphabet slightly more
 * likely than the rest. The bias is small and there is no reason to accept it.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const CEILING = 256 - (256 % ALPHABET.length);

export function generatePassword(length = 20) {
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte >= CEILING) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Base64url: it travels in a cookie, so no padding and no "+" or "/". */
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function sessionTokenHash(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return new Uint8Array(digest);
}

/**
 * A new session: the token goes to the cookie, the hash goes to the database.
 *
 * Returning both together is deliberate — it is the one moment where the plain
 * token exists, and a caller that stored the token instead of the hash would
 * be a caller that had to choose.
 */
export async function createSessionToken() {
  const token = base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  return { token, tokenHash: await sessionTokenHash(token) };
}

/** When a session issued now should stop working. */
export function sessionExpiry(remember, now = new Date()) {
  const ms = remember
    ? SESSION_REMEMBER_DAYS * 24 * 60 * 60 * 1000
    : SESSION_HOURS * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}
