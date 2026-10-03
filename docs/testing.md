# Testing protocol

What we verify, when, and what stops a change from reaching `preprod` or
`master`. This is version 0: it describes the checks that exist today and names
the ones that are planned, so that the table can be read as a contract rather
than as an intention.

## Commands

| Command | What it runs | When it runs | Blocking |
| --- | --- | --- | --- |
| `npm run check` | The single entry point. Today: ESLint over the whole repository, then the unit tests of `src/lib/`. | While working, automatically on `git push` (pre-push hook), and on every pull request targeting `preprod`. | **Yes** — a red `check` blocks the merge. |
| `npm run lint` | ESLint alone. | Called by `check`; run directly when you only want the linter. | Through `check`. |
| `npm run build` | The production Vite build. | Automatically on every push to `master` (Pages deployment). | **Yes** for `master`: a build failure means the site is not published. |
| `npm run typecheck` | Not available yet. TypeScript type checking, added to `check` when the code is migrated to TypeScript. | — | — |
| `npm run test:unit` | Unit tests of the pure business logic of `src/lib/`, starting with the final grade formula. No database, no browser. | Called by `check`; run directly while working on the logic. | Through `check`. |
| `npm run test:integration` | The migrations, the import script, and the rules the database itself enforces: the audit trigger, the visibility view, the absence of any name column. Runs against a real PostgreSQL. | Locally after `docker compose up -d db`; on every pull request targeting `preprod`, against a `postgres:18-alpine` service container. | **Yes** — a red `integration` job blocks the merge. |
| `npm run test:e2e` | Not available yet. Browser scenarios: a student reads their grades, a teacher edits one. | — | — |

The integration tests are deliberately **not** part of `check`: they need a
running database, and `check` must stay runnable on a laptop with nothing
started and on a CI runner with no service container. They have their own CI
job instead. They also run against their own database — the one in
`DATABASE_URL` plus a `_test` suffix, created on demand — because they rebuild
the schema on every run and must never be able to erase what a contributor is
working on.

`check` is the only name a contributor, the pre-push hook and the CI workflow
ever use. A new check is added by editing that one script; neither the hook nor
`.github/workflows/ci.yml` changes. That is also why `typecheck` is absent from
`package.json` instead of being declared as a command that always succeeds — a
check that cannot fail would make the gate look stronger than it is.

## What blocks a pull request

A pull request targeting `preprod` cannot be merged unless:

- the `check` and `integration` jobs are green;
- the change comes from a `feat/<slug>` branch, never from a direct push;
- every commit message follows Conventional Commits, has a body explaining
  *why*, and ends with `Refs: BDD-<n>`;
- the diff contains no student name, no credential and no file from
  `document/` or `C++GroupGrading/`;
- a structural decision introduced by the change is justified by an ADR in
  `docs/adr/`, committed before the code it justifies.

`master` only ever receives one pull request from `preprod`, once the V1 is
validated on its hosting. Nothing else is merged there during the V1.

## What blocks a release

Merging and releasing are two different gates, and the section above only
describes the first one. A merge into `preprod` is also a release: the CI's
`deploy` job runs on a push to that branch and publishes to production.

A release is blocked when:

- **`check` or `integration` is red.** The `deploy` job declares
  `needs: [check, integration]`, so it cannot start if either failed. Nothing
  is published.
- **A migration does not apply.** The job applies the migrations to Neon
  *before* publishing the Worker, and a failing step ends the job. Code that
  reads a column the database does not have is never published.

Two things are deliberately *not* blocked, and both are the contributor's
responsibility rather than the pipeline's:

- **A migration that removes what the live Worker still reads.** The ordering
  above only protects the case where the code is newer than the schema. The
  reverse breaks production for the seconds between the two steps, so a
  destructive change takes **two releases**: add the new shape, publish the
  code that stopped using the old one, and drop it in a later release.
- **A release that is simply wrong.** There is no rollback deployment. The way
  back from a bad release is another release from `preprod`, so the question to
  ask before merging is not "can I undo this" but "do I believe this".

A push to `master` publishes to GitHub Pages and is **not** a production
release: production is the Worker serving `preprod`. The `npm run build` row in
the table above describes that Pages path, which the V1 no longer uses.

`docs/architecture.md` has the map of what runs where; this section is the
contract.

## Rule: a fixed bug gets a regression test

Every bug fix ships with a test that fails before the fix and passes after it.
The point is not coverage, it is that the same bug cannot come back unnoticed —
and that the test documents what the correct behaviour is, which a commit
message cannot do for the next contributor.

Until the test runners exist, a fix whose regression test cannot be written yet
says so explicitly in its commit body, and names what would be needed to write
it.

## Growth plan

The table above grows in this order, each step landing with the feature that
needs it:

1. `typecheck` — with the TypeScript migration.
2. ~~`test:unit`~~ — done, with the grade computation moved into `src/lib/`.
3. ~~`test:integration`~~ — done, with the SQL migrations and the import script.
4. `test:e2e` — with the student screens and the teacher area.

Each step adds its command to `npm run check`, or to a separate CI job when it
needs a service container, and updates this file in the same pull request.

Refs: BDD-26
