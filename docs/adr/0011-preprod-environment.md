# ADR-0011 — preprod-environment

- **Status**: accepted
- **Date**: 2026-10-03
- **Deciders**: Baptiste Dupuis

## Context

`preprod` has been the name of a branch and not of an environment. ADR-0006
attached `chu-epita.com` to the Worker that the CI publishes from that branch,
so the only deployed copy of the application has been the apex, and the only
way to get a change onto a URL has been to merge it — which published it
immediately to the address students are meant to use.

That had no consequence while the V1 had nothing to try out. It has one now.
Three of the four remaining Requis V1 tasks are **write** paths: the teacher
sign-in (BDD-32), the CSV import (BDD-33) and the teacher view with its exports
(BDD-34). A write path is exactly the kind of change nobody should meet for the
first time on the live site, and until today there was nowhere else to meet it.

The symptom that prompted this: the apex still serves the commit deployed on
28 September, because nothing has been merged since, and there was no way to
look at any of the work in progress without merging it.

## Options considered

### Option A — a second environment on `preprod.chu-epita.com` (chosen)

A Wrangler environment publishing the same code as a second Worker on a
subdomain. The CI publishes it on every push to `preprod`; the apex becomes
production and is published deliberately.

It fits because it costs one configuration block and no new service. The
subdomain's DNS record is created by `custom_domain` on the first deploy — the
zone is already in this account, which ADR-0006 established — so there is
nothing to add by hand. And it makes "merged" and "released" two different
events, which is the distinction that was missing.

### Option B — a preview URL per pull request

Rejected for now, and worth keeping in mind. `wrangler versions upload`
publishes a version without promoting it and yields a URL, so a CI job on pull
requests could comment one. It is better than this option in one way — a change
is testable *before* merging rather than after — and worse in two: it needs the
database question below answered first, since every preview would write to the
same Neon, and it multiplies the deployments to reason about. A stable
`preprod.chu-epita.com` is the smaller step and does not block this one.

### Option C — a separate Cloudflare account or project for staging

Rejected. It doubles the configuration, the secrets and the places to look, to
separate two deployments that differ by one subdomain.

## Decision

Two deployments of the same code:

| | Published from | Published by | Database |
| --- | --- | --- | --- |
| `chu-epita.com` | `master`, at a validated release | by hand, `npm run deploy` | Neon |
| `preprod.chu-epita.com` | `preprod` | the CI, on every push | the same Neon |

The CI's `deploy` job runs `npm run deploy:preprod`, which is
`wrangler deploy --env preprod`. Nothing publishes the apex automatically, so a
release stays a decision rather than a consequence of merging.

Bindings are declared again inside the environment rather than omitted:
Wrangler does not inherit them, and a missing Hyperdrive binding would be a
Worker that answers 500 on every `/api` call.

## The limit this accepts, deliberately

**The two deployments share one database.** That is the status quo rather than a
new risk — the apex has been serving this branch and this data since September,
so nothing that was separate is being joined. But it means a write tried out on
preprod writes a real grade, which is precisely what arrives with BDD-32,
BDD-33 and BDD-34.

Splitting them needs a second Hyperdrive configuration pointing at a second
database, and Neon's branching is the obvious candidate. It is not done here
because it needs an account change nobody can make from a repository, and
because shipping the subdomain without it is still strictly better than having
no preprod at all. It is BDD-56, and it should land before the teacher area is
handed to a teacher.

## Consequences

- **The apex stops updating on merge.** It keeps serving the 28 September build
  until somebody publishes a release, which is the point — but anybody who has
  been reading `chu-epita.com` to see the latest work should read
  `preprod.chu-epita.com` from now on.
- A merged task is testable on a real URL, with real data, over real TLS, from
  Xi'an. Testing before *merging* still has no home; Option B is where that
  goes.
- `npm run deploy` now publishes production. It used to publish the only thing
  there was, so anybody with the habit should know it changed meaning.
- One more Worker appears in the dashboard, named `chu-grades-preprod`.
- Observability is enabled on both, which is what makes the CPU measurement
  ADR-0008 defers to a real deployment readable on preprod rather than on
  production.
- The DNS record for the subdomain is created by the first deploy. If the zone
  ever leaves this account, that deploy fails loudly rather than publishing a
  Worker nobody can reach — the same property ADR-0006 relied on for the apex.

Refs: BDD-56
