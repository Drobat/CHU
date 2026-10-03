# ADR-0006 — cloudflare-workers-hosting

- **Status**: accepted
- **Date**: 2026-09-26
- **Deciders**: Baptiste Dupuis

## Context

The V0 site is static: the grades live in `src/data/` as JSON, Vite bundles them,
and GitHub Pages serves the result. That arrangement has two consequences we now
want to end.

The first is that the published bundle contains every grade of every student,
downloadable by anyone. Masking the names in the interface (BDD-19) changed what
the screens display, not what the bundle carries.

The second is that a static host cannot talk to a database. The schema, the
migrations and the import built in BDD-29 are unusable in production until
something server-side sits between the browser and PostgreSQL.

So the hosting decision and the "stop shipping the data to the browser" decision
are the same decision, and it has to be taken before the API is written.

Constraints:

- The audience is ~300 students at Chang'an University, in Xi'an. They consult
  their grades a handful of times per semester — on the order of 300 visits per
  month. Whatever we pick has to be reachable from mainland China.
- No budget.
- Three contributors, no operations team, no one on call.
- The grades are real student data. They carry no names — the database schema
  stores none (ADR-0003) — but a grade tied to a student number is still
  personal data.

## Options considered

### Option A — Cloudflare Workers serving the built site, with managed PostgreSQL behind Hyperdrive (chosen)

One Worker serves the static build and answers `/api/*`. Cloudflare has no
PostgreSQL of its own, so the database is managed elsewhere — Neon, in the
Singapore region — and Hyperdrive pools the connections at the edge so that a
Worker does not open a fresh TCP connection per request.

At 300 visits per month the free tiers are not a squeeze: the Workers free plan
allows 100,000 requests per day and serves static assets at no cost, Hyperdrive
is included in it, and Neon's free plan covers 0.5 GB of storage and 100
CU-hours per month against a dataset of roughly 2 MB. Total cost: the domain
renewal, which we already pay.

The deciding argument is empirical rather than theoretical. Cloudflare's free
plan has a reputation for being throttled from mainland China, but we have
already run a Cloudflare-hosted site that was accessible from there without
trouble. A measured precedent beats a reported one.

### Option B — stay on GitHub Pages

Rejected, because it is the problem. A static host cannot reach a database, so
the grades would stay in the bundle and the work of BDD-29 would stay unused.

### Option C — a VPS in Hong Kong or Singapore, Postgres in Docker

Seriously considered: ~5 USD per month, the `docker-compose.yml` of BDD-30
reused as-is, the data on a machine we control, and a plain IP address rather
than Cloudflare's anycast range. It was rejected on operational cost, not on
price: backups, security updates and availability would fall on a teacher
working alone, against a managed platform that does all three. It remains the
fallback if Cloudflare turns out to be degraded from Xi'an.

### Option D — Cloudflare D1

Rejected. D1 is SQLite. It would mean rewriting the six migrations of BDD-29 and
giving up the `grade_audit` trigger, the `JSONB` column holding each exam body,
and the `student_grades_v` view — the three mechanisms that make the database,
rather than the application, responsible for what a student may read.

### Option E — hosting inside mainland China (Alibaba Cloud, Tencent Cloud)

Rejected as unavailable. Serving a domain from mainland China requires an ICP
filing, which requires a registered Chinese entity. A partner university could
in principle sponsor one; that is a matter of months of administrative work, not
a V1 decision.

## Decision

Production runs on Cloudflare Workers: one Worker serves the Vite build as
static assets and handles `/api/*` route by route. PostgreSQL is hosted by Neon
in Singapore and reached through a Hyperdrive binding with the `pg` driver
already used by the migration and import scripts.

`master` stays deployable to GitHub Pages for the whole transition. It is the
rollback: if the students cannot reach Cloudflare, the DNS goes back and the site
that works today works again.

The migration happens in two steps, deliberately separated. First the Worker,
the database and a read endpoint go live while the front end still reads the
bundled JSON — this proves the whole chain without touching the screens. Then
the front end switches to the API (BDD-31), and the JSON files leave the bundle.
Until that second step lands, the grades remain publicly downloadable; the
hosting move alone does not fix that.

## Domain

`chu-epita.com` was registered on 2026-09-28 at Cloudflare Registrar, so the
zone is already on the DNS we deploy to and there is no nameserver move to
schedule. It is attached to the Worker as a custom domain, and it serves
`preprod` — the branch the CI deploys.

Buying a second domain rather than pointing the existing one is what makes the
two-step migration of the Decision above actually reversible. `chu-epita.xyz`
keeps serving the GitHub Pages build from `master` and is not touched: as long
as it answers, the rollback is doing nothing at all. It is redirected to
`chu-epita.com` when the V1 is validated, and that redirect is the moment the
migration becomes visible to students — not before.

Registrar and host are the same company here, which is convenient and worth
naming as a risk rather than discovering later: the domain, the DNS, the CDN and
the compute all sit with one provider, so a dispute with Cloudflare is a dispute
about everything at once. The registrar can be moved without moving the hosting,
and that is the exit if it is ever needed.

This supersedes the plan recorded in the Consequences below, which assumed the
`.xyz` nameservers would move to Cloudflare. They do not; a second domain costs
a few euros and buys a rollback that needs no DNS propagation.

## Where the data lives

The Neon project runs in **Singapore** (`ap-southeast-1`). The region was chosen
for latency: the students are in Xi'an, and the measurements above are what the
choice was checked against, not a prediction it was based on.

That puts pseudonymised student data — a student number, a grade, a correction
report, no name — on servers outside the European Union, processed for a French
school. Singapore holds no EU adequacy decision, so the transfer rests on the
standard contractual clauses in the processor's data protection agreement, and
on the minimisation already applied upstream: no name ever enters the database,
and the student endpoints return one student's rows.

Two things follow, and neither is settled by this ADR. Neon's data protection
agreement has to be accepted and kept with the project's records rather than
assumed. And the retention and deletion rules (BDD-44) now have to be applied to
a processor's servers, not only to ours — a deletion that only happens in our
heads is not a deletion.

## Measured afterwards — 2026-09-26

The decision above was taken on the strength of a Cloudflare-hosted site that had
been reachable from China. It has since been measured from a Chinese network, and
the result corrects one assumption rather than the decision.

- A `*.workers.dev` URL does not load at all. Not slowly: a 44-byte JSON
  response never arrives, so the whole shared domain is unreachable rather than
  throttled.
- The same 1.8 MB bundle served by GitHub Pages does load, slowly. Payload size
  is therefore not the cause.
- The site that worked ran for a year on its own domain, on Cloudflare.

**A custom domain is a requirement, not a convenience.** `workers.dev` is
unusable in production and unusable even for a test: a negative result on it says
nothing about the decision. Any measurement from China has to be taken on a
domain we own.

The site was then deployed on a domain we own, behind the same Worker, and
measured four times from the same Chinese network:

| Measured | Run 1 | Run 2 | Run 3 | Run 4 | Spread |
| --- | --- | --- | --- | --- | --- |
| connection + 2 bytes | 348 ms | 1 504 ms | 420 ms | 730 ms | ×4.3 |
| home page, 730 bytes | 477 ms | 2 002 ms | 666 ms | 2 648 ms | ×5.5 |
| the site bundle, 1.8 MB | 1 860 ms | 21 250 ms | 5 404 ms | 10 710 ms | **×11.4** |

The whole journey works every time: login, course tabs, an exam paper, a project
report. **The decision holds, and this is the measurement BDD-36 asked for.**

What the runs show together, and none shows alone, is that size and stability are
the same question here. An earlier version of this file claimed the small page
stayed under two seconds in every run; the fourth run took 2 648 ms and settled
that. The claim that survives is comparative, not absolute: across the same four
runs the small page spans ×5.5 and the bundle ×11.4, and the bundle stays an
order of magnitude above it throughout — 1.9 to 21.3 seconds against 0.5 to 2.6.

So the case for serving grades through the API rather than in the bundle is not
an average saved per load. It is the removal of a worst case a student meets on
a bad day. Measuring once would have hidden it: the first run alone suggested
the bundle cost about a second, this file said so, and that reading was wrong.

## Measured after the front end moved to the API — 2026-09-27

The runs above were taken while the grades were still bundled. BDD-31 moved the
front end onto the API, which took the data out of the build: the bundle went
from 1.8 MB to 121 562 bytes served, and a student's own grades became a
separate 4 KB response. The same Chinese network was measured again, and this
time the round trip to Neon in Singapore was measured for the first time.

| Measured | Bytes | Run 1 | Run 2 |
| --- | --- | --- | --- |
| `/api/students/:id` — Worker, Hyperdrive, Neon | 4 084 | 317 ms | 330 ms |
| home page | 338 | 587 ms | 502 ms |
| the site bundle | 121 562 | 921 ms | — |

Two things changed, and they are worth separating.

The bundle no longer stands apart. At 1.8 MB it sat an order of magnitude above
every small response in all four runs; at 121 KB its single measurement, 921 ms,
falls below the *best* of those four (1 860 ms), and all three figures here sit
inside one 300–900 ms band. **This is one run and a half, not four.** The two
outliers of the earlier campaign — 21 250 ms and 10 710 ms — landed on runs 2
and 4, which is exactly what a short campaign misses. The honest claim is that
the worst case did not appear at this size, not that it is gone.

The database is not the slow part. The API call crosses the Pacific to Singapore
and returns faster than a 338-byte page served from Cloudflare's own asset
store. With two samples that ordering is inside the noise and no law should be
read into it, but the question it settles is the one that opened this
investigation: a blank page from China was attributed to the hosted database
before anything was measured, and the failing request never touched it. It still
does not. Hyperdrive holding a warm pooled connection is the plausible reason
the Singapore hop costs so little, and it is a hypothesis here, not a finding.

What remains unmeasured is the tail. Both campaigns show that the spread between
runs, not the average, is what a student actually experiences, and two runs
cannot describe a spread.

## Consequences

- **Student data leaves our machines.** ADR-0004 rejected a hosted database for
  local development on exactly this ground. The reasoning that was right for a
  development database does not survive contact with production: there is no
  machine of ours that 300 students in China can reach. Neon in Singapore is the
  compromise, and it is a real one, not a detail — the retention and deletion
  rules (BDD-44) now govern a third party's servers as well as ours.
- Deployment stops being "push to master". It becomes a Wrangler deploy, which
  has to be wired into the CI before anyone deploys from a laptop.
- ~~The DNS for `chu-epita.xyz` moves from its current nameservers to
  Cloudflare.~~ Superseded by the Domain section above: a second domain,
  `chu-epita.com`, is registered on Cloudflare instead, and `.xyz` is left
  alone until the V1 is validated. Nothing about the existing site has to move
  for the new one to be reachable.
- `/api/students/:id` will expose one student's grades to anyone who knows the
  student number, which is a predictable eight-digit number. This is strictly
  better than today, where the entire dataset is one download away, and strictly
  worse than an authenticated endpoint. It is acceptable only as an intermediate
  state, and it is what makes BDD-42 (magic-link login) a V2 item we should not
  let slide.
- If the free tiers change, the exposure is bounded: Workers paid is 5 USD per
  month and Neon's paid plan is usage-based with no monthly minimum.

Refs: BDD-36
