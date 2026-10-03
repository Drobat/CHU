/**
 * Reading a teacher's spreadsheet export: two columns, a student number and a
 * grade out of 100.
 *
 * Pure, like grades.js and teacher-auth.js — no database, no request. What the
 * database has to say about a number (does this student exist, which promotion
 * are they in) is checked by the caller, because only the caller can ask. This
 * file decides what the *file* says, and says precisely what is wrong with it
 * when something is.
 *
 * The rules and the reasons are in docs/adr/0010-csv-grade-import.md.
 */

/** A grade is out of 100 everywhere in this project; assessments.total_points agrees. */
export const TOTAL_POINTS = 100;

/**
 * Accepts a comma or a semicolon, whichever the row actually uses.
 *
 * A spreadsheet exporting CSV in a French locale writes `2024904082;12,5`: the
 * semicolon because the comma is taken, and the comma as the decimal mark.
 * Refusing that would be refusing the file teachers actually have.
 */
function splitRow(row) {
  const separator = row.includes(";") ? ";" : ",";
  return row.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

/**
 * A grade cell, or null for "not graded".
 *
 * The decimal comma is translated here rather than at the separator level: a
 * semicolon-separated row may use it, a comma-separated row cannot, and by this
 * point the cell is already on its own.
 */
function parseGrade(cell) {
  if (cell === "") return { grade: null };
  const normalised = cell.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalised)) return { error: "not a number" };
  const grade = Number(normalised);
  if (grade > TOTAL_POINTS) return { error: `above ${TOTAL_POINTS}` };
  return { grade };
}

/**
 * True for the first row of a file that carries column titles.
 *
 * Detected rather than configured: a header is whatever does not look like a
 * student number, which is also exactly what would be rejected as a row.
 */
function looksLikeHeader(cells) {
  return cells.length >= 1 && !/^\d{4,10}$/.test(cells[0]);
}

/**
 * @typedef {{line: number, studentId: string, grade: number|null}} ParsedRow
 * @typedef {{line: number, reason: string, cell?: string}} RowProblem
 */

/**
 * Reads the file into rows and problems, without judging whether the students
 * exist.
 *
 * Every problem is collected rather than thrown on the first one: a teacher
 * fixing a spreadsheet wants the list, not a game of whack-a-mole.
 *
 * @param {string} text
 * @returns {{rows: ParsedRow[], problems: RowProblem[]}}
 */
export function parseGradeCsv(text) {
  if (typeof text !== "string") throw new TypeError("expected the file's text");

  const rows = [];
  const problems = [];
  const seen = new Map();

  // \r\n as well as \n: a file written on Windows is the common case, not the
  // exotic one.
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;

    const cells = splitRow(raw);
    if (index === 0 && looksLikeHeader(cells)) return;

    if (cells.length < 2) {
      problems.push({ line, reason: "needs two columns: student number, grade" });
      return;
    }

    const studentId = cells[0];
    if (!/^\d{4,10}$/.test(studentId)) {
      problems.push({ line, reason: "not a student number", cell: studentId });
      return;
    }
    // A teacher number is ten digits and would pass the test above. ADR-0008
    // keeps the two populations apart on every path, and this is one of them.
    if (studentId.startsWith("2042")) {
      problems.push({ line, reason: "that is a teacher number", cell: studentId });
      return;
    }

    const previous = seen.get(studentId);
    if (previous !== undefined) {
      problems.push({
        line,
        reason: `already on line ${previous}`,
        cell: studentId,
      });
      return;
    }

    const { grade, error } = parseGrade(cells[1]);
    if (error) {
      problems.push({ line, reason: `grade ${error}`, cell: cells[1] });
      return;
    }

    seen.set(studentId, line);
    rows.push({ line, studentId, grade });
  });

  if (rows.length === 0 && problems.length === 0) {
    problems.push({ line: 0, reason: "the file has no rows" });
  }

  return { rows, problems };
}

/**
 * What a ratio of `coeff` will actually weigh, given what the course already
 * carries.
 *
 * The final mark is a weighted average, so a ratio is a share of the total
 * weight and not a percentage of the mark. The coefficients of a course sum to
 * 100 in one course out of nine, so a teacher who types 30 on a course already
 * at 140 is choosing 30/170 — about 18 %. Showing that is the difference
 * between a number they chose and a number they were told.
 *
 * @param {number} coeff          the ratio being added
 * @param {number} existingTotal  the sum of the coefficients already on the course
 * @returns {number|null} the share in percent, or null when it cannot be computed
 */
export function resultingShare(coeff, existingTotal) {
  const total = Number(existingTotal) + Number(coeff);
  if (!Number.isFinite(total) || total <= 0) return null;
  return (Number(coeff) / total) * 100;
}

/** One decimal, because the second one is noise at this precision. */
export function formatShare(share) {
  return share === null ? "—" : `${Math.round(share * 10) / 10} %`;
}
