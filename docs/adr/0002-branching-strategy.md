# ADR-0002 — branching-strategy

- **Status**: accepted
- **Date**: 2026-09-26
- **Deciders**: Baptiste Dupuis

## Context

`master` is production: it is built and published to GitHub Pages on
`chu-epita.xyz`, and students use it to read their grades during the semester.
Anything merged there is online minutes later.

The V1 replaces almost everything: the static React site becomes a Next.js
application backed by PostgreSQL, and the hosting target is not settled yet
(ADR-0006). That work spans several weeks and many features, so there is a long
period during which the code is coherent but not publishable — it needs a
database that GitHub Pages cannot provide.

The other constraints are:

- Three contributors on three machines, each landing features independently.
- The history of this repository is read as documentation: small ordered commits,
  one pull request per feature, no rewriting of what is already pushed.
- The checks must be identical on a contributor machine and on a CI runner,
  otherwise the runner becomes the only place where the truth is known and every
  red build costs a round trip.

Doing nothing means either freezing the site for the students for the whole V1,
or publishing a half-migrated application to them.

## Options considered

### Option A — trunk-based on `master`

Every feature merges into `master` behind a flag. Rejected: `master` is
published automatically, so a half-migrated V1 would reach students, and the
Pages build has no database to talk to. Feature flags would have to guard the
data layer itself, which is most of the change.

### Option B — keep `db-docker` as the integration branch

The V1 work already started on a branch named `db-docker`. Rejected for two
reasons. Its name describes one feature (the Docker database) rather than the
role it plays, which stops making sense as soon as the next feature lands on it.
And it was never pushed, so it protected nothing: there was no shared reference
a pull request could target.

### Option C — a protected `preprod` integration branch (chosen)

One long-lived branch named after its role. Every feature targets it by pull
request; `master` only ever receives a single pull request from it, once the V1
is validated on the retained hosting.

## Decision

The flow is `feat/<slug>` → pull request → `preprod`, and one `preprod` →
`master` pull request at the end of the V1.

- `preprod` is created from the current tip of `db-docker`, without rewriting
  history. `db-docker` is kept as-is so the existing commits stay reachable, and
  is no longer used.
- `master`: pull request required, direct push forbidden. It keeps serving the
  students unchanged for the whole V1.
- `preprod`: pull request required, and the CI check must pass before merging.
- `npm run check` is the single entry point for verification. The pre-push hook
  and the CI workflow both call exactly that command, so a contributor can
  reproduce a CI failure with one line and the workflow never has to be edited
  when a check is added.
- The content of `check` grows with the project: linting today, type checking
  once the code is TypeScript, unit tests once a test runner is in place. Adding
  a check means editing one npm script, not the workflow.
- The pre-push hook is a convenience, not the authority. It can be skipped
  (`--no-verify`) and it only runs on the machines where `npm install` ran; the
  CI is what actually blocks a merge.

## Consequences

- No feature can reach the students by accident: reaching `master` requires an
  explicit pull request that nobody opens before the V1 is validated.
- Every contributor works the same way — branch, push, pull request — and the
  history shows one pull request per feature, which is what we want to be able
  to read six months from now.
- Two branches have to be kept in sync in the contributor documentation
  (`README`) and in the task workflow; a feature branched from `master` by
  mistake will show unrelated commits in its pull request.
- The branch protections live in the GitHub repository settings, not in the
  repository itself, so they are not versioned. They are captured as a
  screenshot with the task that sets them up.
- `preprod` is not deployed anywhere yet. Giving it a running environment
  depends on the hosting decision and is deferred to ADR-0006.

Refs: BDD-26
