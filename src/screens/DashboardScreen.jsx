/**
 * Dashboard — the student's courses and, for the selected one, their results.
 *
 * Everything on this screen comes from the payload App fetched at login. No
 * request is made here: switching tabs filters data that is already in memory.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { gradeColor, fadeSlide, stagger } from "../theme";
import {
  AsciiBox,
  BlinkingCursor,
  ProgressBar,
  ClassTabs,
  ExamCard,
  ProjectCard,
} from "../components";
import { assessmentsOf, coursesOf, defaultCourseId, totalCoeffOf } from "../api/student";
import { weightedAverage } from "../lib/grades";

export function DashboardScreen({ student, onSelectExam, onSelectProject, onLogout }) {
  const courses = useMemo(() => coursesOf(student), [student]);
  const [courseId, setCourseId] = useState(() => defaultCourseId(student));

  const items = useMemo(() => assessmentsOf(student, courseId), [student, courseId]);
  const avg = useMemo(() => weightedAverage(items), [items]);
  const totalCoeff = useMemo(() => totalCoeffOf(student, courseId), [student, courseId]);
  const courseInfo = courses.find((c) => c.id === courseId);

  return (
    <motion.div {...fadeSlide} className="min-h-screen p-4 sm:p-6 max-w-[720px] mx-auto">

      <LogoutButton onLogout={onLogout} />

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <IdentityCard studentId={student.studentId} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <ClassTabs courses={courses} selectedCourse={courseId} onChange={setCourseId} />
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={courseId}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
          className="mb-5"
        >
          <GradeSummary items={items} avg={avg} totalCoeff={totalCoeff} courseInfo={courseInfo} />
        </motion.div>
      </AnimatePresence>

      {items.length > 0 && <SectionDivider label="EXAMS" />}

      <AnimatePresence mode="wait">
        <motion.div
          key={courseId}
          variants={stagger}
          initial="initial"
          animate="animate"
          exit={{ opacity: 0 }}
        >
          {items.map((item, i) =>
            item.kind === "project" ? (
              <ProjectCard
                key={item.id}
                assessment={item}
                studentId={student.studentId}
                onViewReport={() => onSelectProject(item.id)}
              />
            ) : (
              <ExamCard
                key={item.id}
                assessment={item}
                isLatest={i === 0}
                onClick={() => onSelectExam(item.id)}
              />
            )
          )}
        </motion.div>
      </AnimatePresence>

      <div className="text-center text-tm-dim text-[11px] py-4">
        ── <BlinkingCursor />
      </div>

    </motion.div>
  );
}

// ── Sub-components ───────────────────────────────

function LogoutButton({ onLogout }) {
  return (
    <motion.button
      whileHover={{ x: -2 }}
      whileTap={{ scale: 0.95 }}
      onClick={onLogout}
      className="bg-transparent border border-tm-border text-tm-cyan font-mono text-[13px] cursor-pointer px-3.5 py-1.5 mb-5 tracking-wider"
    >
      [&lt; LOGOUT]
    </motion.button>
  );
}

function IdentityCard({ studentId }) {
  return (
    <AsciiBox accent="#00d4ff" className="p-3 sm:p-4 mb-5">
      <div className="text-tm-white text-[16px] sm:text-[18px] font-bold">ID: {studentId}</div>
    </AsciiBox>
  );
}

function GradeSummary({ items, avg, totalCoeff, courseInfo }) {
  const graded = items.filter((item) => item.grade != null);

  if (graded.length === 0) {
    return (
      <AsciiBox className="p-5">
        <div className="text-tm-dim text-[13px]">
          {items.length > 0
            ? "Project registered — grade pending."
            : "No exams published yet."}
        </div>
      </AsciiBox>
    );
  }

  const formulaParts = graded.map((item) => `${item.title} × ${item.coeff}%`);

  return (
    <AsciiBox accent={gradeColor(avg)} className="p-3 sm:p-5">
      <div className="text-tm-dim text-[10px] tracking-wider mb-2">
        {(courseInfo?.fullName ?? "").toUpperCase()} ── FINAL GRADE
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[24px] font-bold" style={{ color: gradeColor(avg) }}>
            {avg.toFixed(2)}
          </span>
          <span className="text-tm-dim text-[14px]"> / 100</span>
        </div>
        <span className="overflow-hidden">
          <ProgressBar percent={avg} width={20} />
        </span>
      </div>
      <div className="text-tm-text text-[10px] opacity-40 mt-1">
        {formulaParts.join("  +  ")}
      </div>
      {totalCoeff < 100 && (
        <div className="text-tm-dim text-[10px] mt-2 tracking-wider">
          {100 - totalCoeff}% remaining ── more to come
        </div>
      )}
    </AsciiBox>
  );
}

function SectionDivider({ label }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex-1 h-px bg-tm-border" />
      <span className="text-tm-text text-[12px] tracking-widest font-bold">{label}</span>
      <div className="flex-1 h-px bg-tm-border" />
    </div>
  );
}
