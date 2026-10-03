/**
 * The loader the site used before the grades moved into the database.
 *
 * It lives here, and no longer under src/, because its only remaining reader is
 * the test that checks every average in the database against the one the site
 * showed. Left in the application tree it would be an invitation: the
 * import.meta.glob calls below pull every grade into the bundle at build time,
 * and importing one of these helpers out of habit would put all of them back in
 * front of every visitor.
 */

/**
 * Auto-discovers all exam and project folders using Vite's glob import.
 *
 * Exam:    data/<class>/<number>/  →  info.json + body.json + students.json
 * Project: data/<class>/<number>/  →  info.json (type:"project") + groups.json
 *
 * Adding a new exam or project = create the folder with the right files.
 * The type field in info.json determines which loader handles it.
 */

import CLASSES_JSON from "../../src/data/classes.json";

// Globs are keyed by the path written here, so moving this file out of
// src/data/ changed every key. The code below splits those keys on "/" and
// looks entries up by name, and would silently find nothing rather than fail —
// the comparison test would then pass against an empty dataset. Re-keying to
// the original "./<course>/<number>/..." shape keeps that from happening.
const PREFIX = "../../src/data/";
const rekey = (files) =>
  Object.fromEntries(
    Object.entries(files).map(([path, mod]) => [`./${path.slice(PREFIX.length)}`, mod]),
  );

const infoFiles    = rekey(import.meta.glob("../../src/data/*/*/info.json",    { eager: true }));
const bodyFiles    = rekey(import.meta.glob("../../src/data/*/*/body.json",    { eager: true }));
const studentFiles = rekey(import.meta.glob("../../src/data/*/*/students.json",{ eager: true }));
const groupFiles   = rekey(import.meta.glob("../../src/data/*/*/groups.json",  { eager: true }));
const reportFiles  = rekey(import.meta.glob("../../src/data/*/*/markdown/*.md", { eager: true, query: "?raw", import: "default" }));

export const CLASSES = CLASSES_JSON;

function loadAll() {
  const exams = [];
  const students = {};
  const projects = [];
  const projectGroups = {};
  const projectReports = {};

  for (const [path, mod] of Object.entries(infoFiles)) {
    const [, classId, num] = path.split("/");
    const info = mod.default;
    const id = `${classId}-${num}`;

    if (info.type === "project") {
      // ── Project ──────────────────────────────────────
      const groups = groupFiles[`./${classId}/${num}/groups.json`]?.default;
      if (!groups) continue;

      projects.push({ id, classId, num, ...info });
      projectGroups[id] = groups;

      // Build report map from the "report" field declared in each group
      for (const group of groups) {
        if (!group.markdown) continue;
        const content = reportFiles[`./${classId}/${num}/markdown/${group.markdown}`];
        if (content == null) continue;
        if (!projectReports[id]) projectReports[id] = {};
        projectReports[id][group.groupName] = content;
      }

    } else {
      // ── Exam ─────────────────────────────────────────
      const body        = bodyFiles[`./${classId}/${num}/body.json`]?.default;
      const studentData = studentFiles[`./${classId}/${num}/students.json`]?.default;
      if (!body || !studentData) continue;

      exams.push({
        id, classId, num, ...info,
        bodyType: body.bodyType,
        questions: body.questions,
      });
      // Grade is provided by the teacher. "wrong" is optional.
      students[id] = studentData;
    }
  }

  exams.sort((a, b) => {
    if (a.publishedDate !== b.publishedDate)
      return a.publishedDate < b.publishedDate ? 1 : -1;
    return b.num.localeCompare(a.num); // tiebreak: higher num = more recently added
  });
  projects.sort((a, b) => (a.deadline < b.deadline ? 1 : -1));

  return { exams, students, projects, projectGroups, projectReports };
}

const data = loadAll();
export const EXAMS           = data.exams;
export const STUDENTS        = data.students;
export const PROJECTS        = data.projects;
export const PROJECT_GROUPS  = data.projectGroups;
export const PROJECT_REPORTS = data.projectReports;

// ── Helpers ─────────────────────────────────────

/** Get all exams for a student in a class, with their grade */
export function getStudentExams(studentId, classId) {
  const results = [];
  for (const exam of EXAMS) {
    if (exam.classId !== classId) continue;
    const student = STUDENTS[exam.id]?.[studentId];
    if (student) results.push({ exam, student });
  }
  return results;
}

/** Get all projects for a student in a class, with their specific group */
export function getStudentProjects(studentId, classId) {
  const results = [];
  for (const project of PROJECTS) {
    if (project.classId !== classId) continue;
    const groups = PROJECT_GROUPS[project.id] || [];
    const group = groups.find((g) => studentId in g.members);
    if (group) results.push({ project, group });
  }
  return results;
}

export function getStudentName(studentId) {
  for (const exam of EXAMS) {
    const s = STUDENTS[exam.id]?.[studentId];
    if (s) return s.name;
  }
  for (const project of PROJECTS) {
    const groups = PROJECT_GROUPS[project.id] || [];
    for (const g of groups) {
      if (studentId in g.members) return g.members[studentId];
    }
  }
  return null;
}

export function studentExists(studentId) {
  if (EXAMS.some((e) => STUDENTS[e.id]?.[studentId])) return true;
  return PROJECTS.some((p) =>
    (PROJECT_GROUPS[p.id] || []).some((g) => studentId in g.members)
  );
}

/** Default tab = class with most recently published exam or project deadline */
export function getDefaultClassId(studentId) {
  let latest = null, result = CLASSES[0].id;
  for (const exam of EXAMS) {
    if (!STUDENTS[exam.id]?.[studentId]) continue;
    if (!latest || exam.publishedDate > latest) {
      latest = exam.publishedDate;
      result = exam.classId;
    }
  }
  for (const project of PROJECTS) {
    const groups = PROJECT_GROUPS[project.id] || [];
    if (!groups.some((g) => studentId in g.members)) continue;
    if (!latest || project.deadline > latest) {
      latest = project.deadline;
      result = project.classId;
    }
  }
  return result;
}
