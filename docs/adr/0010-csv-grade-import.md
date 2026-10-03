# ADR-0010 — csv-grade-import

- **Status**: accepted
- **Date**: 2026-10-03
- **Deciders**: Baptiste Dupuis

## Context

Grades reach the database through `npm run import`, which reads the JSON files
of `src/data/` from a workstation. That is the right tool for the archive and
the wrong one for a teacher who has just marked an exam in a spreadsheet.

BDD-32 gave the teacher area a session, so a write path now has somebody to
attribute writes to. This decides what the first one does.

The shape asked for is deliberately small: a CSV of two columns, a student
number and a grade; the teacher picks the course and a ratio on the screen.
Everything else has to be derived — and the derivations are where this decision
earns its keep, because two of them have a trap under them that the data
revealed rather than the specification.

## The two traps, measured

**The student number does not reliably say which promotion a student is in.**
The intended rule is that a number beginning with 2023 belongs to the 2023
promotion. It holds for 285 students out of 289. The other four are three
numbers beginning with 2023 sitting in the 2024 promotion and one in the 2025,
and they are not mistakes: `src/db/migrations/0001` says it in a comment on the
column, *"A student repeating a year is moved to another cohort by hand."* They
are repeaters, corrected by hand. An import that derived the promotion from the
prefix would silently undo those four corrections and file their grades under
the wrong edition.

**A teacher-created assessment can be overwritten by the JSON import.**
`assessments.num` is "the folder number under `src/data/<course>/`", and
`npm run import` upserts on `on conflict (class_id, num) do update set title,
coeff, body, published_at…`. Folder numbers in use run from 0 to 5. An
assessment created by a CSV import taking `max(num) + 1` would therefore be
silently replaced the day a folder with that number is imported for the same
class.

## Options considered

### Option A — derive the promotion from the recorded cohort (chosen)

The student's own row says which promotion they are in. For a number the
database already knows — which, on an all-or-nothing import, is all of them —
that is the answer, and it is the answer a human already corrected.

The prefix keeps one job: explaining an unknown number in the preview
("2025… looks like the 2025 promotion"), as context for a refusal, never as a
value that gets written.

### Option B — derive the promotion from the number's prefix

Rejected on the measurement above. It is the simpler rule and it is wrong four
times out of 289, in exactly the cases where being wrong matters most: a
repeater's grades filed under the promotion they left.

### Option C — ask the teacher for the promotion

Rejected as redundant. The database already knows, and a field a teacher has to
fill is a field a teacher can fill wrongly. A file spanning several promotions
is refused instead, which is the only case where the question would have arisen.

## Decision

**The file.** Two columns, a student number and a grade out of 100. The
separator may be a comma or a semicolon and the decimal mark may be a comma,
because a spreadsheet exporting CSV in a French locale produces
`2024904082;12,5` and refusing that would be refusing the actual input. A
header row is tolerated and ignored. An empty grade means "not graded" and is
stored as null, which the average already excludes.

**The promotion** comes from `students.cohort_id`, never from the number's
prefix. Course and promotion then identify exactly one class edition — verified
across the catalogue, no pair maps to more than one.

**A file is refused, in full, when** it carries a number the database does not
know, a number that is not a student's (a `2042…` teacher number, per
ADR-0008), a grade outside 0–100 or unparseable, the same number twice, or
students from more than one promotion. Every problem is listed at once rather
than one per attempt; nothing is written until the teacher confirms a clean
preview. A teacher's spreadsheet is not the path that creates student records.

**The ratio sets `coeff`**, and the preview shows the share it actually
produces. The final mark is a weighted average, `Σ(grade × coeff) / Σ(coeff)`,
and the coefficients of a course sum to 100 in one course out of the nine that
exist — the others total 20, 80, 130, 140. So a teacher who types 30 on a
course already at 140 is choosing a weight of 30/170, about 18 %, and telling
them "30 %" would be a lie. The number they type is the weight; the number they
read back is the consequence.

**Each import creates an assessment**: `kind` `exam`, `total_points` 100, no
`body`, a title the teacher types, and **`num` from 1000 upwards**. The high
range is the fix for the second trap: folder numbers are small and will stay
small, so nothing the JSON import upserts can land on a number a teacher's
import chose.

**`published_at` stays null**, so students do not see the grades until somebody
decides they should. `student_grades_v` already enforces that, which is why
this costs nothing to honour.

**The write is one transaction** and declares itself: `app.actor` is the
teacher's number and `app.source` is `import`. The audit trigger of ADR-0003
then records who, and `changed_by` tells a teacher's import (`2042…`) apart
from `npm run import` (`import`) without a new column.

## Consequences

- A teacher cannot create a student, and will be blocked by a number the
  database does not know. That is the intended trade, and the message names
  the numbers so somebody can add them. If it becomes the common case rather
  than the exception, this is the paragraph to revisit.
- A grade loaded this way is invisible until published, and **this ADR does not
  provide the publishing action.** Importing without being able to publish is
  half a feature; the other half belongs to the teacher area that reads and
  edits grades (BDD-34).
- `num ≥ 1000` is a namespace split, not a constraint the database enforces. A
  migration adding a provenance column would be more explicit and would not
  solve the collision, since the uniqueness is on `(class_id, num)` whatever
  the provenance. If folder numbers ever reach four digits, this breaks loudly
  — a unique violation, not silent data loss.
- Re-importing the same file creates a second assessment rather than updating
  the first. There is no idempotency here, deliberately: two exams can have the
  same title, and guessing that an import is a correction rather than a new
  assessment is how a teacher loses a mark they entered by hand.
- The French-locale CSV handling means a file with semicolons and decimal
  commas works, and so does a plain one. It also means a two-column file whose
  second column contains a thousands separator would be misread; grades out of
  100 have no thousands.

Refs: BDD-33
