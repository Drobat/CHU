/**
 * The file-reading half of the CSV import. No database here: whether a student
 * exists is the integration tests' business.
 *
 * Most of these cases are files a teacher will actually hand over — a French
 * Excel export, a stray header, a trailing blank line — rather than inputs
 * invented to exercise a branch.
 */
import { describe, expect, it } from "vitest";
import {
  TOTAL_POINTS,
  formatShare,
  parseGradeCsv,
  resultingShare,
} from "../../src/lib/csv-grades.js";

const ids = (result) => result.rows.map((r) => r.studentId);
const grades = (result) => result.rows.map((r) => r.grade);
const reasons = (result) => result.problems.map((p) => p.reason);

describe("parseGradeCsv", () => {
  it("reads a plain comma-separated file", () => {
    const result = parseGradeCsv("2024904082,75\n2024904083,80.5\n");
    expect(result.problems).toEqual([]);
    expect(ids(result)).toEqual(["2024904082", "2024904083"]);
    expect(grades(result)).toEqual([75, 80.5]);
  });

  it("reads what a French spreadsheet exports", () => {
    // Semicolons because the comma is taken, and a decimal comma. This is the
    // format a teacher is most likely to produce, so it is not an edge case.
    const result = parseGradeCsv("2024904082;12,5\n2024904083;8\n");
    expect(result.problems).toEqual([]);
    expect(grades(result)).toEqual([12.5, 8]);
  });

  it("ignores a header row, and only on the first line", () => {
    const withHeader = parseGradeCsv("student,grade\n2024904082,75\n");
    expect(withHeader.problems).toEqual([]);
    expect(ids(withHeader)).toEqual(["2024904082"]);

    // The same text further down is a broken row, not a header: silently
    // skipping it would lose a grade without saying so.
    const inTheMiddle = parseGradeCsv("2024904082,75\nstudent,grade\n");
    expect(ids(inTheMiddle)).toEqual(["2024904082"]);
    expect(reasons(inTheMiddle)).toEqual(["not a student number"]);
  });

  it("survives Windows line endings, blank lines and quotes", () => {
    const result = parseGradeCsv('\r\n"2024904082","75"\r\n\r\n2024904083,80\r\n');
    expect(result.problems).toEqual([]);
    expect(ids(result)).toEqual(["2024904082", "2024904083"]);
    expect(grades(result)).toEqual([75, 80]);
  });

  it("treats an empty grade as not graded rather than as zero", () => {
    // A blank cell means the student has no mark yet. Zero is a mark, and the
    // average counts it; null is excluded from both halves of the formula.
    const result = parseGradeCsv("2024904082,\n2024904083,0\n");
    expect(result.problems).toEqual([]);
    expect(grades(result)).toEqual([null, 0]);
  });

  it("collects every problem instead of stopping at the first", () => {
    const result = parseGradeCsv(
      ["2024904082,75", "abc,75", "2024904083,craie", "2024904084,120", "2024904085"].join("\n"),
    );
    expect(ids(result)).toEqual(["2024904082"]);
    expect(reasons(result)).toEqual([
      "not a student number",
      "grade not a number",
      "grade above 100",
      "needs two columns: student number, grade",
    ]);
    // The line numbers are the file's, so a teacher can go and look.
    expect(result.problems.map((p) => p.line)).toEqual([2, 3, 4, 5]);
  });

  it("refuses a grade above 100 and accepts exactly 100", () => {
    expect(reasons(parseGradeCsv("2024904082,100.1"))).toEqual(["grade above 100"]);
    expect(parseGradeCsv("2024904082,100").problems).toEqual([]);
    expect(TOTAL_POINTS).toBe(100);
  });

  it("refuses a negative grade", () => {
    // Caught by the number pattern rather than by a range check, which is
    // worth a test because the two would report it differently.
    expect(reasons(parseGradeCsv("2024904082,-5"))).toEqual(["grade not a number"]);
  });

  it("refuses the same student twice, naming the earlier line", () => {
    const result = parseGradeCsv("2024904082,75\n2024904083,80\n2024904082,90\n");
    expect(ids(result)).toEqual(["2024904082", "2024904083"]);
    expect(result.problems).toEqual([
      { line: 3, reason: "already on line 1", cell: "2024904082" },
    ]);
    // The first value stands, so the file is not silently resolved in favour
    // of whichever row came last.
    expect(grades(result)).toEqual([75, 80]);
  });

  it("refuses a teacher number", () => {
    // Ten digits, so the student pattern alone would have taken it. ADR-0008
    // keeps the two populations apart on every path.
    const result = parseGradeCsv("2042000001,75\n");
    expect(result.rows).toEqual([]);
    expect(result.problems).toEqual([
      { line: 1, reason: "that is a teacher number", cell: "2042000001" },
    ]);
  });

  it("says a file is empty rather than returning nothing at all", () => {
    for (const empty of ["", "\n\n", "   \n"]) {
      const result = parseGradeCsv(empty);
      expect(result.rows).toEqual([]);
      expect(reasons(result)).toEqual(["the file has no rows"]);
    }
  });

  it("does not report an empty file when it only reported a header", () => {
    // A file of nothing but a header has no rows and one real problem; saying
    // "no rows" as well would be two complaints about one mistake.
    const result = parseGradeCsv("student,grade\n");
    expect(result.rows).toEqual([]);
    expect(reasons(result)).toEqual(["the file has no rows"]);
  });

  it("refuses something that is not text", () => {
    expect(() => parseGradeCsv(undefined)).toThrow(TypeError);
    expect(() => parseGradeCsv(Buffer.from("2024904082,75"))).toThrow(TypeError);
  });
});

describe("resultingShare", () => {
  it("is the share of the total weight, not the number typed", () => {
    // The case from the ADR: 30 on a course already carrying 140.
    expect(resultingShare(30, 140)).toBeCloseTo(17.647, 2);
    // And the case where the two happen to agree, which is why the illusion
    // survives: a course at 70 plus a ratio of 30 really is 30 %.
    expect(resultingShare(30, 70)).toBeCloseTo(30, 10);
  });

  it("is 100 % for the first assessment of a course", () => {
    expect(resultingShare(30, 0)).toBeCloseTo(100, 10);
    expect(resultingShare(1, 0)).toBeCloseTo(100, 10);
  });

  it("returns null rather than a nonsense number when it cannot be computed", () => {
    expect(resultingShare(0, 0)).toBeNull();
    expect(resultingShare(NaN, 10)).toBeNull();
  });

  it("formats a share for a screen, and says so when there is none", () => {
    expect(formatShare(resultingShare(30, 140))).toBe("17.6 %");
    expect(formatShare(resultingShare(30, 70))).toBe("30 %");
    expect(formatShare(null)).toBe("—");
  });
});
