# ADR-0007 — local-analytics-with-metabase

- **Status**: accepted
- **Date**: 2026-10-03
- **Deciders**: Baptiste Dupuis

## Context

The grades are in PostgreSQL (ADR-0003) and the schema is stable enough to be
asked questions of: the average of a promotion, the spread of an assessment,
whether one course grades harder than the rest. Today that means opening `psql`
and writing a join across `grades`, `assessments`, `classes`, `courses` and
`cohorts` by hand, and rewriting it the next time.

The constraints:

- The data is real student grades, held on our machines until the hosting
  question is settled (ADR-0006 settled it for the application, not for an
  analytics tool).
- There is no authentication anywhere in the project. Knowing a student number
  is enough to read that student's grades, and the teacher area does not exist.
  Nothing can be opened to teachers before that changes.
- No budget for a hosted service.
- Three contributors, and two of them have no reason to run an analytics tool
  at all.
- Whatever reads the grades is a tool nobody on the team wrote.

Doing nothing means the questions keep being answered by hand-written SQL,
which is slow and invites a copy-paste of a query that joins one table wrong.

## Options considered

### Option A — Metabase as an optional Compose service (chosen)

A `metabase` service in the existing `docker-compose.yml`, behind
`profiles: ["metabase"]`, reading the local database with a role the database
refuses writes to. Pinned image, no telemetry, nothing published beyond
loopback. `docker compose up` is unchanged; the tool exists only for whoever
asks for it.

It fits because it costs nothing to the contributors who do not use it, it adds
no dependency to the application — nothing in `src/` or `worker/` knows it
exists — and the read-only guarantee is made by PostgreSQL rather than by
trusting the tool.

### Option B — SQL queries kept in the repository

Rejected as the whole answer, though it remains available. A `docs/queries.sql`
would version the joins, but every question still has to be written before it
can be asked, there is no cross-tabulation and no chart, and comparing two
promotions means editing SQL. It solves the copy-paste, not the exploration.

### Option C — an analytics page in the application

Rejected. It would put aggregate grades behind the same absence of
authentication that already lets a student number read a student's grades, and
this time the payload would be everyone's. It also grows the thing we are
trying to keep small: the Worker currently has three read endpoints on one
view.

### Option D — Metabase hosted, open to teachers

Rejected for now, and this is the option worth naming. It is what teachers
would actually want, and it is out of reach until there is authentication, a
decision about where it runs, and a view of what a teacher may see — the
equivalent of `student_grades_v` for a teacher. Each of those is a decision in
its own right. Opening it up gets its own ADR.

### Option E — Metabase on its default H2 storage

Rejected. The image stores dashboards, questions and accounts in an H2 file
inside the container, so `docker compose down` deletes the work. An analytics
tool whose saved questions do not survive a container recreation is not worth
setting up.

## Decision

Metabase runs as an optional service of `docker-compose.yml`, enabled only by
`docker compose --profile metabase up`, on a pinned image
(`metabase/metabase:v0.63.19.1`), published on `127.0.0.1:${METABASE_PORT:-3001}`,
with `MB_ANON_TRACKING_ENABLED=false`.

It reaches the grades through `metabase_reader`, a role holding `CONNECT`,
`USAGE` on `public` and `SELECT` — granted both for the tables that exist and,
through `alter default privileges`, for the tables a later migration will add —
and no role attribute that would let it widen its own grants. The refusal of
every write is asserted in `tests/integration/metabase-reader.test.js`.

The same role owns a separate `metabase_app` database on the same cluster,
where Metabase keeps its own state. Owning a database grants nothing in any
other one, so one credential writes its dashboards freely and still cannot
touch a grade, and the dashboards live in the `pgdata` volume rather than in
the container.

The role and that database are created by `npm run metabase:setup`, not by a
numbered migration: the role needs a password, and a migration is a committed
`.sql` file read from disk with no way to pass a value in. Production has
neither the role nor the database.

This is a workstation tool. It is not hosted and not exposed to teachers.

## Consequences

- A contributor who wants analytics installs nothing beyond what Docker already
  gives them, and runs `npm run metabase:setup` once before the first
  `--profile metabase up`. The two who do not want it see no change: `docker
  compose up` still starts the database alone, and it keeps working with no
  `.env` entry for Metabase at all.
- The grades can be explored without any of it reaching the application, and
  removing the service removes the feature entirely.
- A new secret, `METABASE_READER_PASSWORD`, exists in `.env` and in
  `.env.example` as a placeholder. It is the first credential in this project
  that is not the database administrator's.
- `npm run metabase:setup` is a third database command beside `migrate` and
  `import`, and a contributor has to know it runs before Metabase, not after.
  Re-running it is the fallback when a grant is missed.
- Pinning the image means upgrading Metabase is a deliberate commit. The
  version chosen is the last patch of the 0.63 line rather than the 0.64 that
  had been out two days.
- Teachers still have no analytics, and asking a contributor for a figure is
  still the answer. Opening this up — hosting, authentication, and what a
  teacher may see — is deferred to its own ADR.
- Nothing here changes the schema, the application or production. The
  production database has neither the role nor `metabase_app`, and
  `npm run migrate` does not create them.

Refs: BDD-53
