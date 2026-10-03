# ADR-0003 — postgresql-access-and-migrations

- **Status**: accepted
- **Date**: 2026-09-26
- **Deciders**: Baptiste Dupuis

## Context

The V1 replaces the JSON files of `src/data/` with the PostgreSQL database
described in ADR-0004. Before writing the first table we have to decide how
application code reaches that database, how the schema is described and
applied, and where the existing data enters.

The constraints come from the project itself:

- The repository is JavaScript. There is no `tsconfig.json` and not a line of
  TypeScript; the migration to Next.js and TypeScript is a later task.
- Part of the model cannot be expressed by a mapping layer: a trigger has to
  copy every grade change into `grade_audit`, exam bodies are stored as JSONB
  exactly as the teachers wrote them, and student visibility is a view the
  student API is the only reader of. These rules belong to the database so that
  no write path can bypass them.
- The model is small: cohorts, courses, class editions, students, assessments,
  groups, grades and the audit table.
- The existing data must be loadable repeatedly. Grades get corrected, and a
  contributor must be able to drop the database and rebuild it from `src/data/`
  without thinking about it.

## Options considered

### Option A — the `pg` driver and hand-written SQL (chosen)

One runtime dependency. Migrations are plain `.sql` files, applied in order by
a small runner. Queries are SQL.

### Option B — an ORM (Prisma, Drizzle)

Rejected, for now. The main reason to adopt one is end-to-end typing of
queries, and on a JavaScript codebase that benefit does not exist yet: we would
pay the cost — a schema DSL, a code generation step, an indirection layer, and
for Prisma a binary engine to run in CI — for nothing we can use today.

It also works against the parts of the model that matter here. An ORM does not
write the audit trigger, it gets in the way of JSONB columns, and it replaces
readable SQL migrations with a declarative schema from which migrations are
generated. On a project whose point is versioned SQL, that trades the thing we
want for its abstraction. With five tables, the SQL it would save us is not
worth the dependency.

### Option C — a dedicated migration tool (node-pg-migrate, dbmate)

Rejected for now, and it is the closest call. `node-pg-migrate` accepts raw SQL
migrations and handles the ledger and the lock; `dbmate` does the same from a
single binary. Neither is needed yet: there is one database, three
contributors, and no automatic rollback to support. The runner is also the
mechanism we want to be able to show and test. This is the option to revisit
first, and adopting it later is mechanical — the migration files do not change.

## Decision

- **Driver**: `pg` (node-postgres), the only runtime dependency added here.
  `DATABASE_URL` stays the single variable the application reads.
- **Migrations**: numbered `.sql` files in `src/db/migrations/`, never edited
  once applied. `npm run migrate` applies the missing ones in order, each in
  its own transaction, under a `pg_advisory_lock` so two concurrent runs cannot
  overlap, and records what it applied in a `schema_migrations` table.
- **Schema and data are separate.** `npm run migrate` changes the schema;
  `npm run import` loads `src/data/`. Grades are data: they are corrected,
  reloaded and re-imported. Putting them in migration files would make the
  first correction require another migration, and would stop us rebuilding an
  empty database to test the schema.
- **The import is idempotent and all-or-nothing**: a single transaction,
  upserts on the natural keys, so two consecutive runs leave the same database.
- **Business rules live in SQL** where a write path could otherwise escape them:
  the `grade_audit` trigger, `archived_at` on cohorts, courses and class
  editions, and the `student_grades_v` view that the student API is the only
  reader of. The final grade formula stays in `src/lib/`, covered by unit tests.
- **No student name enters the database.** The import reads the `name` field of
  `students.json` and drops it, and excludes the demo accounts.

## Consequences

- Queries are written in SQL, so every contributor needs to read SQL. On this
  project that is the point rather than a cost.
- There is no compile-time check that a query matches the schema. Integration
  tests against a real database are what catch that, which is why they are
  required as soon as the database is touched.
- The runner is code we own, roughly sixty lines, and it has to be tested like
  the rest — starting with "empty database, migrate, expected schema".
- Migrations are forward-only. Undoing something means writing the migration
  that undoes it, which is also what happens in production.
- Adopting a query builder later is possible without rewriting the schema.
  When the TypeScript migration lands, and only if the query code becomes
  painful, Kysely is the candidate: it is a typed query builder, the queries
  keep the shape of SQL, and it does not own the schema.
- The integration test runner is not decided here. Vitest arrives with BDD-28;
  the integration tests of this task depend on it.

Refs: BDD-29
