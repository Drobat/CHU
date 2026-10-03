# ADR-0004 — docker-compose-environments

- **Status**: accepted
- **Date**: 2026-09-26
- **Deciders**: Baptiste Dupuis

## Context

The V1 of the grades intranet replaces the JSON files of `src/data/` with a
PostgreSQL database. Before writing a single migration we need a database that
every contributor — and later the CI — can start the same way.

The constraints are:

- Three contributors, three different machines and operating systems.
- A CI pipeline is coming (BDD-31 runs integration tests against a real
  database), so the same database must be reachable from a GitHub runner.
- No budget for a hosted service.
- One contributor works from Xi'an, where access to services hosted outside
  China is slow and unreliable.
- The data is real student data, so it must stay on our machines until the
  hosting decision is taken (ADR-0006).

A database whose version differs between machines is a trap for a project whose
whole point is versioned SQL migrations: a migration that passes locally and
fails in CI costs more than the setup it saved.

## Options considered

### Option A — PostgreSQL as a Docker Compose service (chosen)

One `docker-compose.yml` at the root, one `db` service on a pinned major
version, configured through `.env`. Nothing to install beyond Docker; the same
image runs locally and as a service container in CI.

### Option B — PostgreSQL installed on each machine

Rejected. Versions drift (Homebrew, apt and the Windows installer do not ship
the same major), and the setup documentation has to be written and maintained
per OS. Nothing guarantees that the version used to test a migration is the
version that runs it next.

### Option C — a shared hosted database (Neon, Supabase…)

Rejected. It adds an external dependency on a free tier we do not control,
latency from Xi'an is uncertain, and it would put real student grades on a
third-party server before the RGPD scope of the project is settled.

## Decision

The local and CI database is a PostgreSQL container described in
`docker-compose.yml`:

- Official `postgres` image, major version pinned (`postgres:18-alpine`), never
  `latest`.
- Credentials and connection string come from `.env`, which is gitignored;
  `.env.example` is committed with placeholder values.
- `DATABASE_URL` is the only variable the application code reads.
- Data lives in a named volume `pgdata`, mounted on `/var/lib/postgresql` —
  not on `/var/lib/postgresql/data`. Since version 18 the official image stores
  the cluster in a major-version subdirectory so that a future
  `pg_upgrade --link` does not cross a mount boundary, and it refuses to start
  when the volume is mounted one level deeper.
- The port is published on the loopback interface only, on `${DB_PORT:-5432}`.
  The default matches the PostgreSQL convention; making it a variable costs
  nothing and lets a contributor who already runs a PostgreSQL on 5432 for
  another project work without stopping it.
- A `pg_isready` healthcheck lets scripts and CI wait for a database that is
  actually accepting connections instead of sleeping for a fixed delay.

The `web` service is added to the same file in a later commit, once the Next.js
migration (BDD-27) is merged; adding it now would mean describing a service that
does not exist yet.

## Consequences

- Docker (or Docker Desktop) becomes a prerequisite on every contributor
  machine, and the daemon must be running before `npm run migrate`,
  `npm run import` or `npm run test:integration`.
- A contributor who never copies `.env.example` to `.env` gets an explicit
  Compose error instead of a container that starts with an empty password.
- Resetting the database is a documented one-liner (`down -v`), which makes the
  migration runner easy to test from a genuinely empty state.
- No real password ever enters the repository; secrets stay in `.env`.
- Production hosting is not settled here — it may reuse this image or not, and
  that choice belongs to ADR-0006 (BDD-36).

Refs: BDD-30
