/**
 * The final grade formula.
 *
 * Pure, and deliberately free of any React, Vite or database import: it is the
 * one piece of logic whose result students read off the screen, so it has to be
 * testable on its own and identical wherever it runs — the current front end,
 * the API that will replace it, or a script.
 *
 *   average = Σ((grade / totalPoints) × 100 × coeff) / Σ(coeff)
 *
 * over the student's graded items, exams and projects alike.
 */

/**
 * Weighted average over the student's graded items, exams and projects alike.
 *
 * An item with no grade is not a zero: it leaves both the numerator and the
 * denominator, so a student who has sat one exam out of a semester is judged on
 * that exam and not on the ones nobody has marked yet.
 */
export function computeWeightedAverage(examResults, projectResults = []) {
  // Exams and projects arrive in two shapes but are the same thing here. They
  // are flattened first so the rules below are written once — the null guard
  // used to exist on one loop and not the other.
  return weightedAverage([
    ...examResults.map(({ exam, student }) => ({
      grade: student.grade,
      totalPoints: exam.totalPoints,
      coeff: exam.coeff,
    })),
    ...projectResults.map(({ project, group }) => ({
      grade: group.grade,
      totalPoints: project.totalPoints,
      coeff: project.coeff,
    })),
  ]);
}

/**
 * The same average over items that already carry grade, totalPoints and coeff.
 *
 * This is the shape the API returns, where an exam and a project are one kind of
 * thing. computeWeightedAverage exists for the bundled JSON, which keeps them
 * apart; both go through the arithmetic below so the two can never drift.
 */
export function weightedAverage(items) {
  let sumWeighted = 0;
  let sumCoeff = 0;
  for (const { grade, totalPoints, coeff } of items) {
    if (grade == null) continue;
    sumWeighted += (grade / totalPoints) * 100 * coeff;
    sumCoeff += coeff;
  }

  return sumCoeff > 0 ? Math.round((sumWeighted / sumCoeff) * 100) / 100 : 0;
}
