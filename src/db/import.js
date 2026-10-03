/**
 * Loads src/data/ into the database.
 *
 * Only the course folders listed in import-map.json are imported, so the
 * catalogue is opened one course at a time rather than all at once. The JSON
 * files are the reference import format and are never modified.
 *
 * The whole run is one transaction: either the database ends up holding every
 * grade of every listed course, or it is left exactly as it was.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isTeacherId } from "../lib/teacher-auth.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");
const IMPORT_MAP = join(HERE, "import-map.json");

// Accounts used to demonstrate the site, not students.
const DEMO_ACCOUNTS = new Set(["20230001", "20230002", "20230003", "1234", "5678"]);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path) {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

/** The academic year a promotion sits a given level: entering in Y, level N, year Y + N - 1. */
function academicYear(entryYear, level) {
  return entryYear + Number(level.slice(1)) - 1;
}

/**
 * A map entry is the promotion's entry year, or an object when the folder is
 * not named after its course code: src/data/algo holds "Data & Algorithms II",
 * whose catalogue code is algo2. The folders are the reference import format and
 * are never renamed to suit the database.
 */
function readEntry(folder, mapEntry) {
  if (typeof mapEntry === "number") return { code: folder, entryYear: mapEntry };
  if (mapEntry && typeof mapEntry.cohort === "number") {
    return { code: mapEntry.course ?? folder, entryYear: mapEntry.cohort };
  }
  throw new Error(
    `import-map.json entry for "${folder}" must be an entry year or { course, cohort }`,
  );
}

async function importCourse(client, folder, mapEntry, counters, log) {
  const { code, entryYear } = readEntry(folder, mapEntry);
  const courseDir = join(DATA_DIR, folder);
  if (!(await exists(courseDir))) {
    throw new Error(`import-map.json lists "${folder}" but src/data/${folder} does not exist`);
  }

  const course = (await client.query("select id, level, semester from courses where code = $1", [code])).rows[0];
  if (!course) {
    throw new Error(`no course with code "${code}" in the catalogue; add it in a migration first`);
  }

  const cohort = (
    await client.query(
      `insert into cohorts (entry_year) values ($1)
       on conflict (entry_year) do update set entry_year = excluded.entry_year
       returning id, (xmax = 0) as created`,
      [entryYear],
    )
  ).rows[0];
  if (cohort.created) counters.cohorts += 1;

  const year = academicYear(entryYear, course.level);
  const klass = (
    await client.query(
      `insert into classes (course_id, cohort_id, academic_year, level, semester)
       values ($1, $2, $3, $4, $5)
       on conflict (course_id, cohort_id, academic_year) do update set level = excluded.level
       returning id, (xmax = 0) as created`,
      [course.id, cohort.id, year, course.level, course.semester],
    )
  ).rows[0];
  if (klass.created) counters.classes += 1;

  const entries = (await readdir(courseDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const entry of entries) {
    const dir = join(courseDir, entry);
    const info = await readJson(join(dir, "info.json"));
    const kind = info.type === "project" ? "project" : "exam";

    // Stored as written; an assessment without a body.json simply has none.
    const body = await readFile(join(dir, "body.json"), "utf8").catch(() => null);

    const assessment = (
      await client.query(
        `insert into assessments
             (class_id, num, kind, title, total_points, coeff, body,
              published_at, held_on, starts_on, due_on)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (class_id, num) do update set
             kind = excluded.kind, title = excluded.title,
             total_points = excluded.total_points, coeff = excluded.coeff,
             body = excluded.body, published_at = excluded.published_at,
             held_on = excluded.held_on, starts_on = excluded.starts_on,
             due_on = excluded.due_on
         returning id, (xmax = 0) as created`,
        [
          klass.id,
          Number(entry),
          kind,
          info.title,
          info.totalPoints,
          info.coeff,
          body,
          // A project carries no publication date of its own: it is on the site,
          // so its deadline is the day its grades became readable. Leaving this
          // null would hide it from student_grades_v entirely.
          info.publishedDate ?? info.date ?? info.deadline ?? null,
          info.date ?? null,
          info.startDate ?? null,
          info.deadline ?? null,
        ],
      )
    ).rows[0];
    if (assessment.created) counters.assessments += 1;

    if (kind === "project") {
      await importGroups(client, dir, assessment.id, cohort.id, counters, log);
    } else {
      await importExamGrades(client, dir, assessment.id, cohort.id, counters);
    }
  }
}

/**
 * Writing row by row is what an import used to do, and it is fine against a
 * database on the same machine: a round trip costs a fraction of a millisecond.
 * Against a hosted database it is not. Loading the whole catalogue meant more
 * than five thousand sequential statements, and at the ~500 ms a round trip to
 * Singapore costs from here, that is over forty minutes — the first full import
 * had to be killed.
 *
 * Everything below therefore writes in batches: one statement per few hundred
 * rows instead of one per row. The same import drops to about a hundred
 * statements, and its duration stops depending on where the database lives.
 */
const BATCH = 500;

function* batches(rows, size = BATCH) {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

/** `($1::int, $2::text, …), ($5::int, …)` for however many rows and columns. */
function placeholders(rowCount, types) {
  const lines = [];
  for (let r = 0; r < rowCount; r += 1) {
    const base = r * types.length;
    lines.push(`(${types.map((t, c) => `$${base + c + 1}::${t}`).join(", ")})`);
  }
  return lines.join(", ");
}

/**
 * Refuses a teacher number before it can become a student row (ADR-0008).
 *
 * The database refuses it too, with a CHECK constraint, and that is the layer
 * that actually guarantees it: the import is one write path out of three. This
 * one exists for the message. A constraint violation on a batch insert names
 * the constraint and the table, not the identifier or the file it came from,
 * and the person who has to fix it is reading a JSON file.
 *
 * Exported so it can be tested on its own. Reaching it through a real import
 * would mean a fixture folder under src/data/, and src/data/ is the teachers'
 * reference format, not a place for test data.
 */
export function assertNoTeacherNumbers(ids) {
  const reserved = ids.filter(isTeacherId);
  if (reserved.length === 0) return;
  throw new Error(
    `src/data/ holds ${reserved.length} identifier(s) reserved for teachers ` +
      `(${reserved.join(", ")}). A number beginning with 2042 identifies a teacher, ` +
      `not a student. Correct the data rather than the constraint.`,
  );
}

/**
 * Registers students without their names.
 *
 * A student already known keeps the cohort they were given — a repeater's
 * cohort is corrected by hand and an import must not undo it.
 */
async function ensureStudents(client, studentIds, cohortId, counters) {
  const ids = [...new Set(studentIds)];

  assertNoTeacherNumbers(ids);

  for (const part of batches(ids)) {
    const params = part.flatMap((id) => [id, cohortId]);
    const inserted = await client.query(
      `insert into students (id, cohort_id)
       values ${placeholders(part.length, ["text", "int"])}
       on conflict (id) do nothing`,
      params,
    );
    counters.students += inserted.rowCount;
  }
}

/**
 * The guard on the update is not an optimisation: without it, re-importing
 * rewrites every grade to its own value and the audit trigger records a change
 * where nothing changed.
 *
 * Returns the (assessment, student) pairs actually written, so the caller can
 * tell whether a report reached anyone.
 */
async function upsertGrades(client, rows, counters) {
  const written = new Set();
  for (const part of batches(rows)) {
    const params = part.flatMap((r) => [
      r.assessmentId, r.studentId, r.grade ?? null, r.report ?? null, r.wrong ?? null,
    ]);
    const result = await client.query(
      `insert into grades (assessment_id, student_id, grade, report, wrong_answers)
       values ${placeholders(part.length, ["int", "text", "numeric", "text", "jsonb"])}
       on conflict (assessment_id, student_id) do update set
           grade = excluded.grade, report = excluded.report,
           wrong_answers = excluded.wrong_answers
       where grades.grade         is distinct from excluded.grade
          or grades.report        is distinct from excluded.report
          or grades.wrong_answers is distinct from excluded.wrong_answers
       returning assessment_id, student_id, (xmax = 0) as created`,
      params,
    );
    for (const row of result.rows) {
      written.add(`${row.assessment_id}|${row.student_id}`);
      if (row.created) counters.grades += 1;
    }
  }
  return written;
}

async function importExamGrades(client, dir, assessmentId, cohortId, counters) {
  const students = await readJson(join(dir, "students.json"));

  const rows = [];
  for (const [studentId, record] of Object.entries(students)) {
    if (DEMO_ACCOUNTS.has(studentId)) {
      counters.skipped += 1;
      continue;
    }
    // record.name is read and deliberately dropped: no student name enters the
    // database. record.wrong is kept: it is what the review screen marks.
    rows.push({
      assessmentId,
      studentId,
      grade: record.grade,
      report: null,
      wrong: record.wrong === undefined ? null : JSON.stringify(record.wrong),
    });
  }

  await ensureStudents(client, rows.map((r) => r.studentId), cohortId, counters);
  await upsertGrades(client, rows, counters);
}

/**
 * A project is graded by group: every member of a group receives the group's
 * grade and its correction report.
 *
 * groupName is read and deliberately dropped. In the data it is almost always a
 * student's first name or nickname, and no student name enters the database. A
 * group is identified by its position in groups.json, which is stable across
 * re-imports as long as the file is appended to rather than reordered.
 */
async function importGroups(client, dir, assessmentId, cohortId, counters, log) {
  const groups = await readJson(join(dir, "groups.json"));

  // Read the reports first: a missing file is a fact about the data, and it has
  // to be reported whether or not anything is written afterwards.
  const reports = new Map();
  for (const [index, group] of groups.entries()) {
    if (!group.markdown) continue;
    const report = await readFile(join(dir, "markdown", group.markdown), "utf8").catch(() => null);
    // Say it rather than skip it: silence would let a student's correction
    // disappear unnoticed.
    if (report === null) log(`missing report: ${dir}/markdown/${group.markdown}`);
    else reports.set(index + 1, report);
  }

  const inserted = [];
  for (const part of batches(groups.map((group, index) => ({ group, num: index + 1 })))) {
    const params = part.flatMap(({ group, num }) => [
      assessmentId, num, group.repositoryLink ?? null, group.comments ?? null,
    ]);
    const result = await client.query(
      `insert into groups (assessment_id, num, repository_url, comments)
       values ${placeholders(part.length, ["int", "int", "text", "text"])}
       on conflict (assessment_id, num) do update set
           repository_url = excluded.repository_url, comments = excluded.comments
       returning id, num, (xmax = 0) as created`,
      params,
    );
    for (const row of result.rows) {
      if (row.created) counters.groups += 1;
      inserted.push(row);
    }
  }

  const idOfNum = new Map(inserted.map((row) => [row.num, row.id]));
  const members = [];
  const grades = [];

  for (const [index, group] of groups.entries()) {
    const num = index + 1;
    for (const studentId of Object.keys(group.members ?? {})) {
      if (DEMO_ACCOUNTS.has(studentId)) {
        counters.skipped += 1;
        continue;
      }
      members.push({ groupId: idOfNum.get(num), studentId });
      grades.push({
        assessmentId,
        studentId,
        grade: group.grade,
        report: reports.get(num) ?? null,
        wrong: null,
        num,
      });
    }
  }

  await ensureStudents(client, grades.map((r) => r.studentId), cohortId, counters);

  for (const part of batches(members)) {
    const params = part.flatMap((m) => [m.groupId, m.studentId, assessmentId]);
    const result = await client.query(
      `insert into group_members (group_id, student_id, assessment_id)
       values ${placeholders(part.length, ["int", "text", "int"])}
       on conflict do nothing`,
      params,
    );
    counters.members += result.rowCount;
  }

  const written = await upsertGrades(client, grades, counters);

  // Counted like every other counter: what the run changed, not what it read.
  // A second run that writes nothing reports zero reports.
  const groupsWithReport = new Set(
    grades
      .filter((r) => r.report !== null && written.has(`${r.assessmentId}|${r.studentId}`))
      .map((r) => r.num),
  );
  counters.reports += groupsWithReport.size;
}

export async function runImport({ connectionString, log = console.log, importMap } = {}) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env, then run docker compose up -d db.");
  }

  // Tests pass their own map so that proving the importer works on a project
  // does not require committing a decision about which promotion sat a course.
  const map = importMap ?? (await readJson(IMPORT_MAP));
  const counters = {
    cohorts: 0, classes: 0, assessments: 0, students: 0, grades: 0,
    groups: 0, members: 0, reports: 0, skipped: 0,
  };

  const present = (await readdir(DATA_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const folder of present) {
    if (!(folder in map)) log(`ignored: src/data/${folder} is not in import-map.json`);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    // Travels with the transaction, so the audit trigger attributes every row
    // it writes to the import rather than to "unknown".
    await client.query("set local app.actor = 'import'");
    await client.query("set local app.source = 'import'");

    for (const [folder, mapEntry] of Object.entries(map)) {
      await importCourse(client, folder, mapEntry, counters, log);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  log(
    `imported: ${counters.cohorts} cohort(s), ${counters.classes} class edition(s), ` +
      `${counters.assessments} assessment(s), ${counters.students} student(s), ` +
      `${counters.grades} grade(s), ${counters.groups} group(s), ` +
      `${counters.members} membership(s), ${counters.reports} report(s); ` +
      `${counters.skipped} demo account(s) skipped`,
  );
  return counters;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runImport().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
