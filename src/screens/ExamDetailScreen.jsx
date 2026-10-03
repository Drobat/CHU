/**
 * Exam detail — question-by-question review.
 *
 * The exam paper is fetched here rather than bundled: it is the heaviest thing
 * a student can open — tens of kilobytes of questions — and most students open
 * one or two of them, not thirty-five.
 *
 * No scoring is done: the grade comes from the teacher and the wrong-answer map
 * is for display only.
 */

import { useCallback } from "react";
import { motion } from "framer-motion";
import { C, gradeColor, fadeSlide, stagger } from "../theme";
import { AsciiBox, BlinkingCursor, ProgressBar, QuestionCard } from "../components";
import { Screen } from "../components/Screen";
import { fetchAssessment } from "../api/client";
import { useResource } from "../api/useResource";

export function ExamDetailScreen({ assessmentId, studentId, onBack }) {
  const load = useCallback(
    (options) => fetchAssessment(studentId, assessmentId, options),
    [studentId, assessmentId],
  );
  const { data: exam, error, loading } = useResource(load, [studentId, assessmentId]);

  return (
    <motion.div {...fadeSlide} className="min-h-screen p-4 sm:p-6 max-w-[720px] mx-auto">

      <BackButton onBack={onBack} />

      <Screen loading={loading} error={error} what="this exam">
        {exam && <ExamReview exam={exam} studentId={studentId} />}
      </Screen>

    </motion.div>
  );
}

function ExamReview({ exam, studentId }) {
  const pct = (exam.grade / exam.totalPoints) * 100;
  const label = pct >= 90 ? "EXCELLENT" : pct >= 70 ? "GOOD" : "";

  const questions = exam.body?.questions ?? [];
  // null means no answers were recorded; {} means they were and none was wrong.
  const hasAnswers = exam.wrongAnswers != null;
  const wrong = exam.wrongAnswers ?? {};
  const wrongCount = hasAnswers ? Object.keys(wrong).length : null;
  const correctCount = hasAnswers ? questions.length - wrongCount : null;

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <ScoreHeader
          exam={exam}
          studentId={studentId}
          pct={pct}
          label={label}
          hasAnswers={hasAnswers}
          correctCount={correctCount}
          wrongCount={wrongCount}
        />
      </motion.div>

      <SectionDivider label={hasAnswers ? "QUESTION DETAILS" : "CORRECTION"} />

      <motion.div variants={stagger} initial="initial" animate="animate">
        {questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            wrongAnswer={hasAnswers ? wrong[String(q.id)] : undefined}
            correctionOnly={!hasAnswers}
            index={i}
          />
        ))}
      </motion.div>

      <div className="text-center text-tm-dim text-[11px] py-6">
        ── end of exam review ── <BlinkingCursor />
      </div>
    </>
  );
}

// ── Sub-components ───────────────────────────────

function BackButton({ onBack }) {
  return (
    <motion.button
      whileHover={{ x: -2 }}
      whileTap={{ scale: 0.95 }}
      onClick={onBack}
      className="bg-transparent border border-tm-border text-tm-cyan font-mono text-[13px] cursor-pointer px-3.5 py-1.5 mb-5 tracking-wider"
    >
      [&lt; BACK]
    </motion.button>
  );
}

function ScoreHeader({ exam, studentId, pct, label, hasAnswers, correctCount, wrongCount }) {
  return (
    <AsciiBox accent={C.cyan} className="p-4 sm:p-6 mb-5 sm:mb-6">
      <div className="text-tm-dim text-[11px] mb-1">── EXAM RESULTS ──</div>
      <div className="text-tm-white text-[16px] sm:text-[18px] font-bold mb-0.5">{exam.title}</div>
      <div className="text-tm-dim text-[11px] sm:text-[12px] mb-4">
        {exam.heldOn} │ {exam.coeff}% │ ID: {studentId}
      </div>

      {label && (
        <div className="flex justify-end mb-2">
          <span className="text-[13px] font-bold" style={{ color: gradeColor(pct) }}>
            [{label}]
          </span>
        </div>
      )}

      <div className="mb-3">
        <span className="text-tm-white text-[24px] sm:text-[28px] font-bold">{exam.grade}</span>
        <span className="text-tm-dim text-[16px] sm:text-[18px]"> / {exam.totalPoints}</span>
      </div>

      <div className="overflow-hidden">
        <ProgressBar percent={pct} width={25} />
      </div>

      <div className="flex gap-4 mt-4 flex-wrap text-[12px]">
        {hasAnswers ? (
          <>
            <span className="text-tm-green">● {correctCount} correct</span>
            {wrongCount > 0 && <span className="text-tm-red">● {wrongCount} wrong</span>}
          </>
        ) : (
          <span className="text-tm-cyan">● correction only — your answers are not recorded</span>
        )}
      </div>
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
