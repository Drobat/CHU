# ADR-0008 — teacher-authentication

- **Status**: accepted
- **Date**: 2026-10-03
- **Deciders**: Baptiste Dupuis

## Context

The teacher area — CSV import, the per-student view, the exports — writes
grades. Nothing in this project authenticates anybody yet: a student types
their number and reads their own results, which is the whole login story so
far. That is acceptable for reading one's own grades and unacceptable for
writing someone else's, so the teacher area cannot be built before this is
settled.

The constraints:

- Three teachers. Accounts are created by hand; there is no sign-up, and there
  will not be one.
- Students keep logging in with their number alone. Whatever is added must not
  make the student path heavier or slower.
- The application runs on the **Workers free plan** (ADR-0006: no budget).
  That plan allows **10 ms of CPU per request**. The paid plan allows 30 s by
  default. This is the binding constraint of this ADR, and it is unusual: a
  password check is the one operation in the application that is *supposed* to
  be slow.
- The data is real student grades, and the teacher area is the first write path
  that is neither an import run from a workstation nor a `psql` session.

CPU time on Workers excludes time spent waiting on I/O, so the round trip to
Neon does not consume the 10 ms. Only computation does — which is exactly what
a key derivation function is.

## The measurement

Taken before choosing anything, because the whole decision depends on it.
PBKDF2-SHA256 deriving 256 bits, measured **inside `workerd`** (the real
runtime, via `wrangler dev --local`), median of five runs after a warm-up, two
series on different machine load:

| Iterations | Series 1 | Series 2 |
| --- | --- | --- |
| 10 000 | 2 ms | 2 ms |
| 25 000 | 3 ms | 4 ms |
| 50 000 | 6 ms | 8 ms |
| 100 000 | 12 ms | 15 ms |
| 200 000 | 23 ms | 33 ms |
| 310 000 | 35 ms | 46 ms |
| 600 000 | 88 ms | — |

Both series are kept rather than the flattering one. Node's WebCrypto on the
same machine gives 16.2 ms at 100 000, which agrees.

**100 000 iterations cost 12–16 ms and therefore do not fit in the 10 ms free
limit** — and that is the hash alone, before the session token, the SQL and the
response. Under 10 ms the ceiling is roughly 60 000–80 000.

The measurement was taken in a cloud container, not on Cloudflare's hardware,
which is the limit of what it proves. Anything that depends on being *just*
under 10 ms is a wager whose loss shows up as HTTP 1102 on the login route —
an intermittently unusable login. That argues for a value with room, not for
the highest value that fits.

For comparison, measured on the project's PostgreSQL image, bcrypt costs 59 ms
at cost 10, 119 ms at 11, **238 ms at 12** and 372 ms at 13. Those are
database milliseconds, not Worker CPU.

## Options considered

### Option A — PBKDF2-SHA256 in the Worker, 50 000 iterations (chosen)

6–8 ms measured, leaving room inside the 10 ms for everything else the login
route does.

What makes a number this modest defensible is not the number: it is that
**passwords here are never chosen by a human**. `npm run create-teacher`
generates 20 random characters and prints them once. A slow KDF exists to make
dictionary and brute-force attacks on *guessable* passwords expensive; against
a 20-character random secret, no offline attack succeeds at 50 000 iterations
or at 600 000. The work factor defends against a weakness this design has
already removed.

The iteration count is stored per account, next to the hash, so it can be
raised later without resetting anybody's password: a successful login whose
stored count is below the current target is re-hashed in place.

### Option B — PBKDF2 at 100 000 iterations or more on the free plan

Rejected: it does not fit. This is the option the task specification started
from, and the measurement is the reason it is not the decision.

### Option C — bcrypt through pgcrypto, in PostgreSQL

Rejected for now, and kept as the documented fallback. It is a good idea: the
work moves to Neon, where it is I/O wait for the Worker and costs none of the
10 ms, and bcrypt at cost 12 is a stronger KDF than anything the free plan can
run locally. `pgcrypto` is available in the project's PostgreSQL image, and
`crypt()`/`gen_salt('bf', 12)` was verified to accept a correct password and
reject a wrong one.

What stopped it is a detail of our own stack: the Worker reaches Neon through
**Hyperdrive, which caches read queries**. A verification query carries the
plaintext password, so the password would become part of a cache key. It is
avoidable — an explicit transaction is not cached, and caching can be turned
off on the binding — but it means securing an extra path to solve a problem
that Option A does not have. `pgcrypto` on the production Neon plan is also
unverified.

If the post-deployment measurement below disappoints, this is where to go.

### Option D — Workers Paid

Rejected for now, on the same ground as ADR-0004 and ADR-0006: no budget. It
remains the clean answer if the iteration count ever has to rise — 5 USD per
month buys a 30 s limit, under which even 600 000 iterations (88 ms) is
irrelevant. Nothing in Option A has to be undone to take it: the stored
iteration count is the migration path.

### Option E — magic link by e-mail

Out of scope (V2). It removes passwords altogether, which is attractive, but it
needs a mail path the project does not have and it does not answer the question
this ADR exists for.

## Decision

**Identity.** Teacher numbers match `^2042[0-9]{6}$` and live in a `teachers`
table, separate from `students`. A `students.id` beginning with `2042` is
refused by a database CHECK constraint *and* by the import and the student
routes — two layers, because the database sees every write path and the
application gives the better error. No student number in `src/data/` begins
with `2042` today (the prefixes in use are 2023, 2024 and 2025), so the
constraint applies to existing data without a repair.

**Password.** At least 12 characters, PBKDF2-SHA256 through WebCrypto (native
on Workers, and the same API in Node so one implementation serves the Worker
and the account script), a 16-byte random salt per account, 50 000 iterations
stored per row, 256 bits derived. Comparison is constant-time over bytes.

**Front end.** The entry screen decides locally, from the digits alone, and
reveals a password field without calling the server, so no request announces
whether a number is a teacher's. The field waits for the complete ten-digit
number: the prefix alone would prompt a student who mistypes a `2024` number for
a password they do not have.

**Failure.** One message, `Invalid ID or password`, for a wrong number and a
wrong password alike, and the same work in both cases: an unknown number is
hashed against a dummy salt so that the response time does not distinguish
them.

**Session.** A 32-byte random token, sent as a `HttpOnly; Secure;
SameSite=Lax; Path=/` cookie; the database stores only its SHA-256. Never
`localStorage` — a token a script can read is a token an injection can steal.
`teacher_sessions` holds the hash, the teacher, `expires_at` and
`last_seen_at`. "Stay signed in on this computer" is unchecked by default: 12
hours otherwise, 30 sliding days when checked. Logging out deletes the row, so
a stolen cookie dies with it.

**Rate limit.** Five failures per number per 15 minutes, then 15 minutes
blocked, recorded in `login_attempts`.

**Write routes.** A valid session *and* a matching `Origin` header. The
grade journal records the teacher: `app.actor` is set to their number inside
the writing transaction, which is the mechanism ADR-0003 already put in place,
so no schema change is needed to attribute a change.

## Consequences

- Teachers cannot recover their own password. There is no reset in the UI and
  no mail path; a lost password means `npm run create-teacher -- <id> --reset`
  run by somebody with repository and database access. For three accounts that
  is acceptable, and it is the first thing V2 should fix.
- **The chosen iteration count is conditional on passwords staying
  machine-generated.** The day a teacher picks their own — password change in
  the UI, a V2 item — 50 000 iterations stops being enough and the count has to
  be revisited. Whoever implements that change owns this paragraph.
- **The count must be confirmed on real hardware.** `wrangler.jsonc` already
  has `observability.enabled`, so the login route's actual CPU time is readable
  after the first deployment. If it sits near 10 ms, lower the count (the
  entropy argument above means little is lost) or take Option C or D.
- **`2042` is a digit transposition of `2024`, a cohort prefix in use.** A
  teacher who types `2024…` is treated as a student and told the number is
  unknown; a student of the 2024 promotion who transposes is asked for a
  password they do not have. Both fail safely and both are confusing. It is the
  price of deriving the role from the number instead of asking, and it is worth
  remembering when the entry screen's wording is next revised.
- The prefix will collide with a real promotion entering in 2042. Sixteen years
  is long enough to change prefix and short enough to write down, which is what
  this line is.
- Students are unaffected: no password, no cookie, no extra request. The cost
  of this ADR falls entirely on a path three people use.
- One more secret exists in the deployment — none, in fact: the hash and salt
  are in the database, the token is in a cookie, and nothing new enters `.env`
  or the repository. That is a property worth keeping on the next change here.

Refs: BDD-32
