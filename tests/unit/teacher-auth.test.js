/**
 * Unit tests for the authentication primitives. No database, no Worker.
 *
 * What is worth testing here is not that PBKDF2 works — that is WebCrypto's
 * job — but the decisions layered on top of it: that the stored iteration
 * count is the one used, that a teacher number cannot pass as a student's,
 * that an unknown account costs the same as a wrong password, and that the
 * generated passwords are what the ADR claims they are.
 */
import { describe, expect, it } from "vitest";
import {
  ABSENT_ACCOUNT,
  ATTEMPT_WINDOW_MINUTES,
  MAX_FAILED_ATTEMPTS,
  PASSWORD_MIN_LENGTH,
  PBKDF2_ITERATIONS,
  SESSION_HOURS,
  SESSION_REMEMBER_DAYS,
  createSessionToken,
  generatePassword,
  hashPassword,
  isStudentId,
  isTeacherId,
  sessionExpiry,
  sessionTokenHash,
  timingSafeEqual,
  verifyPassword,
} from "../../src/lib/teacher-auth.js";

describe("teacher and student numbers", () => {
  it("accepts a teacher number and nothing that merely looks like one", () => {
    expect(isTeacherId("2042000001")).toBe(true);
    expect(isTeacherId("2042999999")).toBe(true);

    expect(isTeacherId("204200001")).toBe(false); // nine digits
    expect(isTeacherId("20420000012")).toBe(false); // eleven
    expect(isTeacherId("2042 00001")).toBe(false);
    expect(isTeacherId("2042abcdef")).toBe(false);
    expect(isTeacherId("")).toBe(false);
    expect(isTeacherId(null)).toBe(false);
    expect(isTeacherId(2042000001)).toBe(false); // a number, not a string
  });

  it("refuses a teacher number as a student number", () => {
    // The acceptance criterion that matters most: 2042000001 is ten digits and
    // would satisfy the student pattern on its own.
    expect(isStudentId("2042000001")).toBe(false);
    expect(isTeacherId("2042000001")).toBe(true);
  });

  it("keeps accepting the student numbers that already exist", () => {
    // Real prefixes from src/data, plus the four-digit demo accounts the
    // Worker's pattern was made lenient for.
    for (const id of ["2024904082", "2023905492", "2025000001", "1234", "5678"]) {
      expect(isStudentId(id)).toBe(true);
    }
  });

  it("does not mistake 2024 for the teacher prefix", () => {
    // 2042 is a transposition of 2024 (ADR-0008). A student of that promotion
    // must not be pushed onto the teacher path by the digits alone.
    expect(isTeacherId("2024000001")).toBe(false);
    expect(isStudentId("2024000001")).toBe(true);
  });
});

describe("timingSafeEqual", () => {
  it("compares content, not identity", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("is false for different lengths rather than throwing", () => {
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("does not stop early on the first differing byte", () => {
    // Not a timing measurement — a timing assertion would be flaky. This only
    // pins the contract that a difference anywhere is detected, including at
    // the very end, which a loop written with an early return would also pass
    // but which a loop written with `some()` on a prefix would not.
    const a = new Uint8Array(32).fill(7);
    const b = new Uint8Array(32).fill(7);
    b[31] = 8;
    expect(timingSafeEqual(a, b)).toBe(false);
    b[31] = 7;
    b[0] = 8;
    expect(timingSafeEqual(a, b)).toBe(false);
  });
});

describe("password hashing", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("a password long enough");
    expect(await verifyPassword("a password long enough", stored)).toBe(true);
    expect(await verifyPassword("a password long enougi", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("gives two accounts with the same password different hashes", async () => {
    // The salt is per account, so a leaked database does not reveal that two
    // teachers chose the same password — and one cracked hash is one account.
    const a = await hashPassword("the very same password");
    const b = await hashPassword("the very same password");
    expect(timingSafeEqual(a.salt, b.salt)).toBe(false);
    expect(timingSafeEqual(a.hash, b.hash)).toBe(false);
  });

  it("stores a 16-byte salt, a 32-byte hash and the iteration count", async () => {
    const stored = await hashPassword("a password long enough");
    expect(stored.salt).toHaveLength(16);
    expect(stored.hash).toHaveLength(32);
    expect(stored.iterations).toBe(PBKDF2_ITERATIONS);
  });

  it("verifies with the count stored on the row, not the current constant", async () => {
    // This is what makes raising PBKDF2_ITERATIONS safe: an account hashed at
    // an older count keeps working, instead of everybody needing a reset.
    const legacy = await hashPassword("a password long enough", { iterations: 50_000 });
    expect(legacy.iterations).not.toBe(60_000);
    expect(await verifyPassword("a password long enough", legacy)).toBe(true);

    // Same password, same salt, different count: a different hash. Which is
    // why the count has to travel with the row.
    const raised = await hashPassword("a password long enough", {
      salt: legacy.salt,
      iterations: 60_000,
    });
    expect(timingSafeEqual(raised.hash, legacy.hash)).toBe(false);
    expect(await verifyPassword("a password long enough", raised)).toBe(true);
  });

  it("refuses to hash a password shorter than the policy", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/at least 12 characters/);
    await expect(hashPassword("x".repeat(PASSWORD_MIN_LENGTH - 1))).rejects.toThrow();
    await expect(hashPassword("x".repeat(PASSWORD_MIN_LENGTH))).resolves.toBeDefined();
  });

  it("verifies nothing against the absent-account row", async () => {
    // It exists to spend the same CPU for an unknown number as for a wrong
    // password. No input may ever satisfy it.
    expect(await verifyPassword("a password long enough", ABSENT_ACCOUNT)).toBe(false);
    expect(await verifyPassword(generatePassword(), ABSENT_ACCOUNT)).toBe(false);
    expect(ABSENT_ACCOUNT.iterations).toBe(PBKDF2_ITERATIONS);
  });
});

describe("generated passwords", () => {
  it("is 20 characters by default and satisfies the policy", () => {
    expect(generatePassword()).toHaveLength(20);
    expect(generatePassword().length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    expect(generatePassword(32)).toHaveLength(32);
  });

  it("avoids the characters that are misread when typed from a printout", () => {
    // base58: no 0, O, I or l. The password is shown once, so a character
    // nobody can transcribe is a locked-out account.
    const sample = Array.from({ length: 200 }, () => generatePassword()).join("");
    expect(sample).not.toMatch(/[0OIl]/);
    expect(sample).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it("does not repeat itself", () => {
    const many = new Set(Array.from({ length: 500 }, () => generatePassword()));
    expect(many.size).toBe(500);
  });

  it("uses the whole alphabet rather than a biased slice", () => {
    // Rejection sampling should leave every one of the 58 characters
    // reachable. A modulo bias would not show up here, but an alphabet that
    // was never fully reached would.
    const seen = new Set(Array.from({ length: 2000 }, () => generatePassword()).join(""));
    expect(seen.size).toBe(58);
  });
});

describe("session tokens", () => {
  it("produces a cookie-safe token and stores only its digest", async () => {
    const { token, tokenHash } = await createSessionToken();
    // base64url of 32 bytes, unpadded.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toHaveLength(32);
    // The digest must be reproducible from the cookie, which is how a request
    // is matched to a row without the row ever holding the token.
    expect(timingSafeEqual(tokenHash, await sessionTokenHash(token))).toBe(true);
  });

  it("does not let the digest reveal the token", async () => {
    const { token, tokenHash } = await createSessionToken();
    const asText = Array.from(tokenHash, (b) => String.fromCharCode(b)).join("");
    expect(asText).not.toContain(token);
  });

  it("gives every session a different token", async () => {
    const tokens = new Set();
    for (let i = 0; i < 200; i++) tokens.add((await createSessionToken()).token);
    expect(tokens.size).toBe(200);
  });
});

describe("session expiry", () => {
  const now = new Date("2026-10-03T10:00:00.000Z");

  it("lasts 12 hours when stay-signed-in is not checked", () => {
    expect(sessionExpiry(false, now).toISOString()).toBe("2026-10-03T22:00:00.000Z");
    expect(SESSION_HOURS).toBe(12);
  });

  it("lasts 30 days when it is", () => {
    expect(sessionExpiry(true, now).toISOString()).toBe("2026-11-02T10:00:00.000Z");
    expect(SESSION_REMEMBER_DAYS).toBe(30);
  });

  it("treats the default as the short session", () => {
    // The checkbox is unchecked by default, so a caller that forgets to pass
    // the flag must get 12 hours and not 30 days.
    expect(sessionExpiry(undefined, now).toISOString()).toBe(sessionExpiry(false, now).toISOString());
  });
});

describe("rate-limit policy", () => {
  it("is five failures per fifteen minutes", () => {
    // Pinned because the Worker and the integration tests both depend on these
    // two numbers, and a silent change to either would weaken the limit
    // without any test failing.
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(ATTEMPT_WINDOW_MINUTES).toBe(15);
  });
});

describe("the import refuses teacher numbers", () => {
  it("stops on one, naming it", async () => {
    const { assertNoTeacherNumbers } = await import("../../src/db/import.js");

    expect(() => assertNoTeacherNumbers(["2024904082", "2042000001", "1234"])).toThrow(
      /2042000001/,
    );
    // The message has to be actionable: the person reading it is looking at a
    // JSON file, so it says which number and what to do.
    expect(() => assertNoTeacherNumbers(["2042000001"])).toThrow(/reserved for teachers/);
    expect(() => assertNoTeacherNumbers(["2042000001"])).toThrow(/Correct the data/);
  });

  it("names every offending number, not just the first", async () => {
    const { assertNoTeacherNumbers } = await import("../../src/db/import.js");
    expect(() => assertNoTeacherNumbers(["2042000001", "2042000002"])).toThrow(/2042000002/);
    expect(() => assertNoTeacherNumbers(["2042000001", "2042000002"])).toThrow(/2 identifier/);
  });

  it("lets a file of real student numbers through", async () => {
    const { assertNoTeacherNumbers } = await import("../../src/db/import.js");
    // Including 2024, the transposition of the teacher prefix, which is a real
    // cohort and must not be caught by this guard.
    expect(() =>
      assertNoTeacherNumbers(["2024904082", "2023905492", "2025000001", "1234", "5678"]),
    ).not.toThrow();
    expect(() => assertNoTeacherNumbers([])).not.toThrow();
  });
});
