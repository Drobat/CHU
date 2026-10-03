import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { runImport } from "../../src/db/import.js";
import { query, resetTestDatabase } from "../helpers/test-database.js";

const silent = () => {};
const count = async (connectionString, table) =>
  Number((await query(connectionString, `select count(*) from ${table}`)).rows[0].count);

async function freshDatabase() {
  const connectionString = await resetTestDatabase();
  await migrate({ connectionString, log: silent });
  return connectionString;
}

describe("npm run import", () => {
  // The counts are read from the run rather than written down here: this test
  // is about the import being repeatable, and opening a course in
  // import-map.json must not turn it red.
  it("loads what the map lists and can be run again without changing anything", async () => {
    const connectionString = await freshDatabase();

    const first = await runImport({ connectionString, log: silent });
    expect(first.assessments).toBeGreaterThan(0);
    expect(first.students).toBeGreaterThan(0);
    expect(first.grades).toBeGreaterThan(0);

    const imported = await count(connectionString, "grades");
    expect(imported).toBe(first.grades);

    const second = await runImport({ connectionString, log: silent });
    expect(second).toEqual({
      cohorts: 0,
      classes: 0,
      assessments: 0,
      students: 0,
      grades: 0,
      groups: 0,
      members: 0,
      reports: 0,
      // Demo accounts are skipped on every run, not only the first.
      skipped: second.skipped,
    });

    expect(await count(connectionString, "grades")).toBe(imported);
    // Re-importing identical grades must not fill the journal with changes
    // that did not happen.
    expect(await count(connectionString, "grade_audit")).toBe(imported);
  }, 300_000);

  it("attributes the imported grades to the import in the audit journal", async () => {
    const connectionString = await freshDatabase();
    await runImport({ connectionString, log: silent });

    const rows = (
      await query(
        connectionString,
        "select distinct source, changed_by from grade_audit",
      )
    ).rows;

    expect(rows).toEqual([{ source: "import", changed_by: "import" }]);
  }, 120_000);

  it("publishes what it imports and shows it to the student", async () => {
    const connectionString = await freshDatabase();
    await runImport({ connectionString, log: silent });

    const grades = await count(connectionString, "grades");
    // Everything imported is published: the site showed it all already.
    expect(await count(connectionString, "student_grades_v")).toBe(grades);

    // Archiving hides grades without deleting any. Every promotion is archived
    // rather than one, so the assertion does not depend on which courses the
    // map happens to list.
    await query(connectionString, "update cohorts set archived_at = now()");
    expect(await count(connectionString, "student_grades_v")).toBe(0);
    expect(await count(connectionString, "grades")).toBe(grades);

    await query(connectionString, "update cohorts set archived_at = null");
    expect(await count(connectionString, "student_grades_v")).toBe(grades);
  }, 300_000);

  // C++ is the course that exercises everything a project can carry: two
  // project folders, correction reports in markdown, and the demo accounts that
  // must never be imported. The map is passed here rather than committed to
  // import-map.json, which carries a decision about which promotion sat what.
  const PROJECT_COURSE = { cpp: 2024 };

  it("imports projects as groups, memberships, reports and per-member grades", async () => {
    const connectionString = await freshDatabase();

    const first = await runImport({ connectionString, log: silent, importMap: PROJECT_COURSE });

    expect(first.groups).toBeGreaterThan(0);
    expect(first.members).toBeGreaterThan(0);
    expect(first.reports).toBeGreaterThan(0);
    // The demo accounts sit in a group of cpp/03 and must be left out of it.
    expect(first.skipped).toBeGreaterThan(0);

    const second = await runImport({ connectionString, log: silent, importMap: PROJECT_COURSE });
    expect(second.groups).toBe(0);
    expect(second.members).toBe(0);
    expect(second.grades).toBe(0);
    expect(second.reports).toBe(0);

    const demo = (
      await query(
        connectionString,
        "select count(*) from students where id in ('1234', '5678', '20230001')",
      )
    ).rows[0].count;
    expect(Number(demo)).toBe(0);
  }, 120_000);

  it("reports a group whose markdown file is missing instead of dropping it", async () => {
    const connectionString = await freshDatabase();

    const lines = [];
    await runImport({
      connectionString,
      log: (line) => lines.push(line),
      importMap: PROJECT_COURSE,
    });

    // Two groups declare a markdown file that is not in the folder:
    // cpp/03 renamed one on a single side, cpp/04 is simply missing one.
    expect(lines.filter((l) => l.startsWith("missing report:"))).toHaveLength(2);
  }, 120_000);

  it("shows a student who sat two projects one row per grade, not two", async () => {
    const connectionString = await freshDatabase();
    await runImport({ connectionString, log: silent, importMap: PROJECT_COURSE });

    // The view joins group membership. Joining on the student alone duplicated
    // every row of anyone who sat more than one project.
    const duplicated = (
      await query(
        connectionString,
        `select count(*) from (
           select student_id, assessment_id from student_grades_v
            group by 1, 2 having count(*) > 1) t`,
      )
    ).rows[0].count;
    expect(Number(duplicated)).toBe(0);

    const [grades, visible] = await Promise.all([
      count(connectionString, "grades"),
      count(connectionString, "student_grades_v"),
    ]);
    expect(visible).toBe(grades);
  }, 120_000);

  it("refuses to seat a student in two groups of the same project", async () => {
    const connectionString = await freshDatabase();
    await runImport({ connectionString, log: silent, importMap: PROJECT_COURSE });

    const [{ student_id, assessment_id }] = (
      await query(connectionString, "select student_id, assessment_id from group_members limit 1")
    ).rows;
    const other = (
      await query(
        connectionString,
        `select id from groups where assessment_id = $1
          and id not in (select group_id from group_members where student_id = $2)
          limit 1`,
        [assessment_id, student_id],
      )
    ).rows[0];

    await expect(
      query(
        connectionString,
        "insert into group_members (group_id, student_id, assessment_id) values ($1, $2, $3)",
        [other.id, student_id, assessment_id],
      ),
    ).rejects.toThrow(/group_members_one_group_per_assessment/);
  }, 120_000);

  it("stores no group name, only a number", async () => {
    const connectionString = await freshDatabase();
    await runImport({ connectionString, log: silent, importMap: PROJECT_COURSE });

    // The guarantee is structural: there is no column a name could sit in.
    const columns = (
      await query(
        connectionString,
        `select column_name from information_schema.columns
          where table_name = 'groups' order by column_name`,
      )
    ).rows.map((r) => r.column_name);

    expect(columns).toEqual(["assessment_id", "comments", "id", "num", "repository_url"]);
  }, 120_000);

  it("gives a project member their group's report and grade", async () => {
    const connectionString = await freshDatabase();
    await runImport({ connectionString, log: silent, importMap: PROJECT_COURSE });

    const row = (
      await query(
        connectionString,
        `select kind, group_num, grade, report, due_on, starts_on
           from student_grades_v
          where kind = 'project' and report is not null
          limit 1`,
      )
    ).rows[0];

    expect(row.kind).toBe("project");
    expect(row.group_num).toBeGreaterThan(0);
    expect(row.report).toMatch(/\S/);
    // The dates the project cards render, which the schema did not keep before.
    expect(row.due_on).toBeInstanceOf(Date);
  }, 120_000);
});
