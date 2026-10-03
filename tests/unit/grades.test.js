import { describe, expect, it } from "vitest";
import { computeWeightedAverage } from "../../src/lib/grades.js";

const exam = (grade, totalPoints = 100, coeff = 20) => ({
  exam: { totalPoints, coeff },
  student: { grade },
});

const project = (grade, totalPoints = 100, coeff = 20) => ({
  project: { totalPoints, coeff },
  group: { grade },
});

describe("computeWeightedAverage", () => {
  it("puts a single exam back on a 0-100 scale", () => {
    expect(computeWeightedAverage([exam(80, 100, 20)])).toBe(80);
    expect(computeWeightedAverage([exam(30, 60, 20)])).toBe(50);
  });

  it("weights by coefficient, not by the point scale of the exam", () => {
    // 90/100 at coeff 30 and 60/200 at coeff 20: the exam marked out of 200 is
    // not worth twice as much, its coefficient decides.
    expect(computeWeightedAverage([exam(90, 100, 30), exam(60, 200, 20)])).toBe(66);
  });

  it("divides by the coefficients present, not by 100", () => {
    // A student who has sat one exam out of a semester worth 100% is not at
    // 16/100 — the average is over what has been graded so far.
    expect(computeWeightedAverage([exam(80, 100, 20)])).toBe(80);
  });

  it("counts graded projects alongside exams", () => {
    expect(computeWeightedAverage([exam(100, 100, 50)], [project(0, 100, 50)])).toBe(50);
  });

  it("ignores a project that has no grade yet", () => {
    // Not graded is not zero: the item leaves both sides of the fraction.
    expect(computeWeightedAverage([exam(80, 100, 20)], [project(null, 100, 80)])).toBe(80);
  });

  it("ignores an exam that has no grade yet", () => {
    // Regression: the exam loop had no null guard, and (null / 100) * 100 is 0
    // in JavaScript. An exam nobody has marked counted as a zero while still
    // adding its coefficient — this case returned 16 instead of 80.
    expect(computeWeightedAverage([exam(80, 100, 20), exam(null, 100, 80)])).toBe(80);
  });

  it("returns 0 when every item is ungraded", () => {
    expect(computeWeightedAverage([exam(null, 100, 20)], [project(null, 100, 80)])).toBe(0);
  });

  it("returns 0 when nothing has been graded", () => {
    expect(computeWeightedAverage([])).toBe(0);
    expect(computeWeightedAverage([], [])).toBe(0);
    expect(computeWeightedAverage([], [project(null)])).toBe(0);
  });

  it("rounds to two decimals", () => {
    expect(computeWeightedAverage([exam(10, 30, 1)])).toBe(33.33);
  });
});
