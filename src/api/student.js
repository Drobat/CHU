/**
 * Reading a student payload.
 *
 * These replace the helpers of src/data/index.js, which searched through every
 * student's results to find one. The API already returns only this student, so
 * the work left is grouping and ordering — no filtering by identity.
 *
 * Pure functions over the payload: no fetching, no React, so they are testable
 * on their own.
 */

/**
 * The tabs a student sees: their own courses, never the whole catalogue.
 *
 * The label is the course code as the catalogue spells it, so a folder named
 * "algo" shows up as "algo2" — the course a student actually sat, and the only
 * spelling that stays unambiguous once algo1 and algo3 exist.
 */
export function coursesOf(student) {
  return (student?.courses ?? []).map((course) => ({
    id: course.code,
    label: course.code,
    fullName: course.title,
  }));
}

/** The course whose most recent assessment is the most recent of all. */
export function defaultCourseId(student) {
  let best = null;
  let bestDate = null;

  for (const course of student?.courses ?? []) {
    for (const assessment of course.assessments) {
      const date = dateOf(assessment);
      if (date && (!bestDate || date > bestDate)) {
        bestDate = date;
        best = course.code;
      }
    }
  }
  return best ?? student?.courses?.[0]?.code ?? null;
}

/** Assessments of one course, most recent first. */
export function assessmentsOf(student, courseCode) {
  const course = (student?.courses ?? []).find((c) => c.code === courseCode);
  if (!course) return [];

  return [...course.assessments].sort((a, b) => {
    const da = dateOf(a);
    const db = dateOf(b);
    if (da !== db) return (db ?? "") > (da ?? "") ? 1 : -1;
    // Same day: the higher number was added later.
    return b.num - a.num;
  });
}

/**
 * The date a card shows and the list sorts on. An exam is dated by the day it
 * was sat, a project by its deadline; both fall back on nothing rather than on
 * today, so an undated item sorts last instead of first.
 */
export function dateOf(assessment) {
  return assessment.kind === "project"
    ? (assessment.dueOn ?? assessment.startsOn ?? null)
    : (assessment.heldOn ?? null);
}

/** The weights that add up to the course's final grade. */
export function totalCoeffOf(student, courseCode) {
  return assessmentsOf(student, courseCode).reduce((sum, a) => sum + a.coeff, 0);
}
