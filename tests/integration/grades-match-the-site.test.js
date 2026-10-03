/**
 * The migration is only worth anything if a student reads the same number after
 * it as before. This compares, for every student and every course, the average
 * computed from the database against the one computed from the JSON files the
 * site serves today.
 *
 * The same function does the arithmetic on both sides, so what is under test is
 * the data — grades, totals and coefficients — not the formula. The formula has
 * its own unit tests.
 *
 * Only the courses listed in import-map.json are compared: they are the ones the
 * database is supposed to hold. Opening the catalogue widens this test for free.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { migrate } from "../../src/db/migrate.js";
import { runImport } from "../../src/db/import.js";
import { computeWeightedAverage } from "../../src/lib/grades.js";
import { getStudentExams, getStudentProjects } from "../helpers/site-data.js";
import { query, resetTestDatabase } from "../helpers/test-database.js";

const silent = () => {};

/** folder in src/data → course code in the catalogue, as import-map.json says. */
async function importMap() {
  const raw = JSON.parse(
    await readFile(new URL("../../src/db/import-map.json", import.meta.url), "utf8"),
  );
  return Object.entries(raw).map(([folder, entry]) => ({
    folder,
    code: typeof entry === "number" ? folder : (entry.course ?? folder),
  }));
}

describe("the database gives a student the average the site shows", () => {
  it("agrees on every student of every imported course", async () => {
    const connectionString = await resetTestDatabase();
    await migrate({ connectionString, log: silent });
    await runImport({ connectionString, log: silent });

    const courses = await importMap();

    // One query rather than one per student: the comparison is about data, and
    // 2700 round trips would make the test slow enough to be skipped.
    const rows = (
      await query(
        connectionString,
        `select student_id, course_code, grade, total_points, coeff
           from student_grades_v`,
      )
    ).rows;

    const fromDatabase = new Map();
    for (const row of rows) {
      const key = `${row.student_id}|${row.course_code}`;
      if (!fromDatabase.has(key)) fromDatabase.set(key, []);
      fromDatabase.get(key).push({
        exam: { totalPoints: Number(row.total_points), coeff: Number(row.coeff) },
        student: { grade: row.grade === null ? null : Number(row.grade) },
      });
    }

    const disagreements = [];
    const students = [...new Set(rows.map((r) => r.student_id))];

    for (const studentId of students) {
      for (const { folder, code } of courses) {
        const site = computeWeightedAverage(
          getStudentExams(studentId, folder),
          getStudentProjects(studentId, folder),
        );
        const database = computeWeightedAverage(fromDatabase.get(`${studentId}|${code}`) ?? []);

        if (site !== database) {
          // The student number is the identifier the site itself uses; no name
          // is involved.
          disagreements.push(`${studentId} ${folder}: site ${site}, database ${database}`);
        }
      }
    }

    expect(disagreements).toEqual([]);
    // A test that compares nothing would also pass with an empty list.
    expect(students.length).toBeGreaterThan(0);
  }, 180_000);
});
