# Exam Results Viewer

[![CI](https://github.com/Drobat/CHU/actions/workflows/ci.yml/badge.svg?branch=preprod)](https://github.com/Drobat/CHU/actions/workflows/ci.yml)

Terminal-themed student exam results viewer built for the EPITA × Chang'an University collaboration.

Three teachers share this site — each manages their own class (`net`, `os`, `fp`). Students log in with their ID, pick a class tab, and review their graded MCQs question by question.

---

## Quick Start

```bash
npm create vite@latest exam-results -- --template react
cd exam-results
npm install
npm install framer-motion
npm install -D tailwindcss @tailwindcss/vite
```

Add Tailwind to `vite.config.js`:
```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

Then replace `src/` with this folder and run:
```bash
npm run dev
```

---

## Local database

The V1 stores grades in PostgreSQL instead of the JSON files of `src/data/`. The
database runs in Docker so that every contributor — and the CI — uses the exact
same version. Requires Docker (or Docker Desktop) running.

```bash
cp .env.example .env          # then edit the password if you want
docker compose up -d db       # starts postgres:18-alpine
docker compose ps             # wait for STATUS = healthy (a few seconds)
```

Connect with `psql` inside the container:

```bash
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Stop it, keeping the data (named volume `pgdata`):

```bash
docker compose down
```

Reset it — **deletes every row**, useful to replay the migrations from an empty
database:

```bash
docker compose down -v
```

`.env` holds the credentials and is gitignored; `.env.example` is the committed
reference. `DATABASE_URL` is the only variable the application code reads. The
port is published on `127.0.0.1` only, so the database is never reachable from
the local network.

If `docker compose up` fails with `address already in use`, another PostgreSQL
already holds the port. Set `DB_PORT` to a free one in `.env` and update the
port inside `DATABASE_URL` to match:

```bash
DB_PORT=5433
DATABASE_URL=postgres://chu:local-dev-password@127.0.0.1:5433/chu_grades
```

See `docs/adr/0004-docker-compose-environments.md` for why the database runs in
Docker rather than being installed on each machine.

Once the container is healthy, build the schema and load the data:

```bash
npm run migrate                # applies src/db/migrations/*.sql in order
npm run import                 # loads the courses listed in src/db/import-map.json
npm run test:integration       # runs against a separate <database>_test
```

`migrate` and `import` are separate on purpose: the schema is versioned and
applied once, the grades are data that get corrected and reloaded. Both are
safe to run again — `migrate` skips what it already applied, `import` upserts
and leaves the audit journal alone when nothing changed.

`import-map.json` decides which course folders of `src/data/` are imported. It
holds one entry today: the chain is validated on Python OOP for the 2025
promotion before the rest of the catalogue is opened. Folders absent from it
are reported and skipped.

See `docs/database.md` for the schema and the rules the database enforces, and
`docs/adr/0003-postgresql-access-and-migrations.md` for why there is no ORM.

---

## Production

Production runs on Cloudflare Workers: one Worker serves the Vite build as
static assets and answers `/api/*`. The database is hosted by Neon in Singapore
and reached through a Hyperdrive binding. See
`docs/adr/0006-cloudflare-workers-hosting.md` for why.

`.env` holds two connection strings and they are not interchangeable:

| Variable | Points at | Used by |
| --- | --- | --- |
| `DATABASE_URL` | the local Docker database | `dev:api`, `migrate`, `import`, integration tests |
| `NEON_DATABASE_URL` | the production database | the commands below, explicitly |

Nothing reads `NEON_DATABASE_URL` implicitly. Touching production is always a
deliberate override on the command line:

```bash
DATABASE_URL="$NEON_DATABASE_URL" npm run migrate
DATABASE_URL="$NEON_DATABASE_URL" npm run import
```

(A variable set in the shell wins over `.env`, so the override is enough.)

### Running the API locally

```bash
docker compose up -d db        # the Worker talks to the local database
npm run build                  # the Worker serves ./dist
npm run dev:api                # http://localhost:8787
```

`dev:api` passes `DATABASE_URL` to the Hyperdrive binding as its local
connection string, so local development never touches Neon.

### Deploying

**A push to `preprod` deploys.** The `deploy` job of `.github/workflows/ci.yml`
runs after `check` and `integration`, applies the migrations to Neon, then
publishes the Worker. It needs two repository secrets:

| Secret | Contents |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token, `Workers Scripts: Edit`, restricted to the account named in `wrangler.jsonc` |
| `NEON_DATABASE_URL` | the **direct** connection string, not the pooled one — `migrate.js` takes a session-level advisory lock |

The schema is applied before the Worker is published, and a migration that fails
publishes nothing. That protects against code newer than the schema, which is a
failure we have already had. It does not protect against the opposite: a
migration that removes what the live Worker still reads breaks production for the
seconds between the two steps. **A destructive change takes two releases** — add
the new shape, publish the code that stopped using the old one, drop it later.

Deploying by hand still works and is the fallback when the CI is unavailable:

```bash
npx wrangler login             # once per machine
npm run deploy                 # builds, then wrangler deploy
```

It runs the same script the CI runs, but it skips the migrations and the tests,
and it publishes whatever is in the working tree. It is not the normal path.

The Hyperdrive configuration is created once per account and its id goes into
`wrangler.jsonc`:

```bash
npx wrangler hyperdrive create chu-grades-db --connection-string="$NEON_DATABASE_URL"
```

The id is a public identifier, not a secret: the credentials stay inside
Hyperdrive and never reach the Worker code or the repository.

### What the API exposes

| Route | Returns |
| --- | --- |
| `GET /api/health` | database reachability |
| `GET /api/students/:id` | one student's courses and grades, without exam bodies |
| `GET /api/students/:id/assessments/:assessmentId` | one assessment with its body and report |

Every read goes through the `student_grades_v` view, so an unpublished
assessment or an archived promotion is invisible to the API by construction
rather than by remembering to filter. Responses are `no-store`.

These endpoints are **not authenticated**: anyone who knows a student number can
read that student's grades. That is strictly better than the previous state,
where the whole dataset shipped inside the public bundle, and strictly worse
than a login. It is an intermediate state, not a destination.

---

## Contributing

### Branches

| Branch | Role |
| --- | --- |
| `master` | The pre-V1 site, built from bundled JSON. Still published to GitHub Pages by a push to it, but `chu-epita.xyz` is no longer ours, so no domain of ours serves it. Receives one pull request from `preprod` at the end of the V1, nothing else. |
| `preprod` | Integration branch for the V1. Every feature merges here. |
| `feat/<slug>` | One branch per feature, created from `preprod`, short English slug. |

Direct pushes to `master` and `preprod` are refused: both require a pull
request. See `docs/adr/0002-branching-strategy.md` for why.

`master` is not the rollback it used to be. `chu-epita.xyz` has left the
project, so the site built from `master` is no longer reachable through a
hostname of ours — while `public/CNAME` and the Pages workflow still name that
hostname, so merging into `master` publishes to Pages under a domain the
project does not control. Read `docs/architecture.md` before merging anything
there.

### Working on a feature

```bash
git checkout preprod && git pull
git checkout -b feat/<slug>
# … work, in small commits …
npm run check          # same command the CI runs
git push -u origin feat/<slug>
```

The push triggers a pre-push hook that runs `npm run check` and refuses the push
if it fails. The hook is installed by `npm install` (`prepare` script); it is a
convenience and can be bypassed with `--no-verify`, but the same check is
required on the pull request, so bypassing it only defers the failure.

Then open a pull request against `preprod`. It cannot be merged until the `check`
job is green. `docs/testing.md` lists what is checked and what blocks a merge.

### Checks

```bash
npm run check     # the single entry point — lint today, more later
npm run lint      # ESLint alone
npm run build     # production build, as the Pages deployment runs it
```

`check` is what the hook and the CI call, verbatim. New checks are added to that
one script, so a contributor never has to read the workflow to know what will
run.

### Commits

Conventional Commits, in English, one commit per logical step — a migration, a
script, a test, a route, a screen — in the order the work is built. No squash,
no interactive rebase, no amend on something already pushed.

Each message has a body that says *why*: the context, and the alternative that
was rejected when it is relevant. The footer links the commit to its task.

```
feat(db): add grades table with audit trigger

Every grade change must be traceable (who/what/when) before opening the
teacher area. A trigger on UPDATE copies the previous row into
grade_audit; done in SQL rather than app code so imports are covered too.

Refs: BDD-29
```

### Architecture decisions

Any structural choice — framework, database, driver, hosting, authentication,
test strategy — gets a file in `docs/adr/` following `docs/adr/TEMPLATE.md`, and
that file is committed **before** the code it justifies.

### What never enters the repository

Student names, credentials, `.env`, and the teacher working folders
(`document/`, `C++GroupGrading/`). The JSON files in `src/data/` are the import
format of reference: write code that reads them, do not reshape them.

---

## Project Structure

```
src/
│
├── App.jsx                  ← Screen router (login → dashboard → detail)
├── main.jsx                 ← Vite entry point
├── index.css                ← Tailwind import + custom terminal colors
├── theme.js                 ← Color map for JS logic + framer-motion presets

├── components.jsx           ← Every reusable UI component
│
├── screens/
│   ├── LoginScreen.jsx      ← Terminal-style student ID prompt
│   ├── DashboardScreen.jsx  ← Student overview + class tabs + exam list
│   └── ExamDetailScreen.jsx ← Full question-by-question exam review
│
└── data/                    ← PURE DATA — no code, only JSON
    ├── README.md            ← Guide for adding exams (give this to teachers)
    ├── classes.json         ← Class definitions
    ├── index.js             ← Auto-loader (Vite glob, never edit)
    └── <class>/<number>/    ← One folder per exam
        ├── info.json        ← Title, dates, coefficient
        ├── body.json        ← Questions, options, correct answers
        └── students.json    ← Student results (wrong answers only)
```

---

## How It Works

### Screen Flow

```
LoginScreen → DashboardScreen → ExamDetailScreen
                  ↑                    │
                  └────────────────────┘
```

1. **Login** — student enters their ID in a fake terminal prompt
2. **Dashboard** — shows their name, weighted average for the selected class, and a list of exam cards. Class tabs (`Net | OS | FP`) filter everything.
3. **Exam Detail** — question-by-question breakdown with color-coded answers and expandable explanations

### Data Loading

`data/index.js` uses Vite's `import.meta.glob` to auto-discover every `info.json`, `body.json`, and `students.json` inside `data/<class>/<number>/`. No imports to maintain — drop a folder, restart dev server, done.

The "wrong-only" student format gets expanded at load time: questions NOT listed in `wrong` are assumed correct, and the scoring engine receives a full answer array either way.

### Grade Display

Grades are provided by teachers in `students.json`. The app just displays them.
Weighted average = `Σ(grade × coeff) / Σ(coeff)`, computed per class in `data/index.js`.

---

## How To Change Things

### "I want to change the colors"

Edit `src/index.css` — all colors are defined in `@theme`:
```css
--color-tm-cyan: #00d4ff;    /* accent color */
--color-tm-green: #00ff41;   /* correct / success */
--color-tm-red: #ff3333;     /* wrong / error */
--color-tm-yellow: #ffd700;  /* partial / warning */
--color-tm-bg: #0a0a1a;      /* page background */
```

These generate Tailwind classes: `text-tm-cyan`, `bg-tm-green`, `border-tm-red`, etc.

For dynamic colors used in JS (score-based), edit the `C` object in `theme.js`.

### "I want to change the animations"

Edit `src/theme.js` — all framer-motion presets are exported:
- `fadeSlide` — screen transitions
- `scaleIn` — login terminal entrance
- `stagger` / `staggerItem` — card list animations
- `shake` — wrong ID error
- `delayedFade(delay)` / `delayedScale(delay)` — login sequence

To remove all animations: replace motion components with regular `div`s and remove framer-motion import.

### "I want to change the login screen look"

Edit `src/screens/LoginScreen.jsx`. The terminal frame is pure HTML/Tailwind — title bar, traffic light dots, prompt line. No SVG, no images.

### "I want to change how scores are displayed"

Edit the relevant screen:
- Dashboard average → `DashboardScreen.jsx`
- Exam card preview → `ExamCard` in `components.jsx`
- Question detail → `QuestionCard` in `components.jsx`

### "I want to change the weighted average logic"

Edit `computeWeightedAverage()` in `data/index.js`.

### "I want to change the grade thresholds (colors/labels)"

Two places:
- `gradeColor()` in `theme.js` — picks green/yellow/red based on percentage
- Grade label (`EXCELLENT/GOOD/PASS/FAIL`) in `ExamDetailScreen.jsx`

### "I want to add a new body type (not MCQ)"

1. Add the new format in `body.json` with a different `bodyType`
2. Add a scoring function in `scoring.js`
3. Add a new card component in `components.jsx`
4. Add a conditional render in `ExamDetailScreen.jsx` based on `bodyType`

### "I want to deploy this"

```bash
npm run build
```

The `dist/` folder is a static site — drop it on any hosting (Netlify, Vercel, GitHub Pages, or a simple nginx). No backend needed.

---

## For Teachers

You only need to touch the `data/` folder. Read `data/README.md` for:
- How to add an exam (3 JSON files)
- How to convert your Markdown exam using AI
- How to convert graded CSV to students.json
- Templates and examples for every file
