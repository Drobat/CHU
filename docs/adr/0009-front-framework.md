# ADR-0009 — front-framework

- **Status**: accepted
- **Date**: 2026-10-03
- **Deciders**: Baptiste Dupuis

## Context

The V1 plan assumed the front end would move to Next.js. That assumption is
written in several places and has been shaping decisions: ADR-0002 describes
the V1 as "the static React site becomes a Next.js application", ADR-0003
mentions the migration as a later task, ADR-0004 defers a `web` service in
`docker-compose.yml` until it lands, and the compose file still carries a
comment promising it.

Enough has changed since that it needs deciding rather than inheriting.

- **ADR-0006 chose Cloudflare Workers.** One Worker serves the Vite build as
  static assets and answers `/api/*`. Static assets are matched before the
  Worker runs, so they cost no invocation.
- **The grades already left the bundle** (BDD-31). The reason the original plan
  wanted a server-side framework — not shipping everyone's results to every
  visitor — is solved: the API returns one student's data on request.
- **The application is one page with no router.** Four screens, switched by
  `useState` in `App.jsx`, with no URL to route. No `react-router`, no
  file-based routing to gain.
- **There is no public content to index.** The site asks for a number and shows
  grades. Server rendering buys nothing for search engines here, and the
  teacher area added by ADR-0008 is behind a session.

What breaks if we do nothing is not the code — it is that four documents point
at a migration nobody has decided to do, and the next contributor cannot tell
whether they are supposed to start it.

## Options considered

### Option A — React + Vite, served by the Worker (chosen)

What already exists: React 19 with Vite 8, built to static files, published as
the Worker's assets, with `/api/*` handled by `worker/index.js`.

It fits because the two things a framework would have been brought in for are
already in place. The server-side layer exists — it is the Worker — and the
data boundary it enforces is a SQL view (`student_grades_v`), not a rendering
strategy. Nothing in the remaining V1 work (CSV import, a student's full
record, exports) needs server-rendered HTML; it needs endpoints, which the
Worker answers.

### Option B — migrate to Next.js

Rejected, and worth saying why carefully, because it was the plan.

Next.js would bring server components, file-based routing and a built-in API
layer. The first two solve problems this application does not have: one page,
no router, no indexable content. The third duplicates the Worker.

The cost is not theoretical. Running Next.js on Workers needs an adapter
(OpenNext or `@opennextjs/cloudflare`), which replaces "static assets matched
before the Worker runs" with a server invoked per request — the arrangement
ADR-0006 picked specifically to keep the free tier comfortable. It would also
mean re-doing the four screens during the weeks the V1 still has to deliver an
import, a teacher view and exports.

A migration whose benefits are routing and SSR, for an application with
neither routes nor a need for SSR, is work spent on the framework rather than
on the grades.

### Option C — Vite plus a Node server

Rejected on the same ground ADR-0006 rejected a VPS: a server to operate,
update and watch, falling on a teacher rather than on a platform. It would also
undo the hosting decision three weeks after taking it, without a reason that
has appeared since.

## Decision

The front end stays **React 19 + Vite**, built to static files, served by the
Cloudflare Worker that also answers `/api/*`. There is no migration to Next.js,
now or in the V1.

Consequently the `web` service that ADR-0004 deferred is **cancelled**, not
postponed: `docker-compose.yml` holds the database and the optional analytics
service, and nothing else is planned for it. The comment promising that service
is corrected by this change.

This supersedes the expectation of a Next.js migration stated in ADR-0002's
Context, ADR-0003's Options and ADR-0004's Consequences. Those files keep their
wording — an accepted ADR records what was decided when it was decided — and
this one is the current answer.

## Consequences

- No framework migration during the V1. The weeks go to BDD-33 and BDD-34, the
  import and the teacher view, which is where the V1 is actually unfinished.
- A future need for server-rendered HTML — a shareable link with a preview, a
  page a crawler should read — would reopen this. Neither exists today, and
  neither is on the V1 list.
- Routing stays a `useState` in `App.jsx`. That is adequate for four screens
  and will stop being adequate somewhere around eight, at which point a router
  is a dependency rather than a framework.
- **The TypeScript migration is a separate question and stays open.** It is
  mentioned alongside Next.js in ADR-0003, which is why it is worth saying here
  that this decision does not settle it: `docs/testing.md` still lists
  `typecheck` as a command that does not exist yet.
- The build stays what the CI already runs, so nothing in
  `.github/workflows/ci.yml` changes, and `npm run build` keeps meaning what it
  means today.

Refs: BDD-27
