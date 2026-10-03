/**
 * App root — minimal screen router.
 *
 * Five screens, no react-router needed. The teacher one is reached by a
 * number beginning with 2042 and a password; see ADR-0008.
 * AnimatePresence handles fade transitions between them.
 *
 * The student's results are fetched once, here, when they log in: every screen
 * below reads from that one payload instead of from data bundled into the
 * JavaScript. Only an exam body or a correction report is fetched later, by the
 * screen that opens it.
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LoginScreen } from "./screens/LoginScreen";
import { TeacherScreen } from "./screens/TeacherScreen";
import { fetchTeacherSession } from "./api/client";
import { DashboardScreen } from "./screens/DashboardScreen";
import { ExamDetailScreen } from "./screens/ExamDetailScreen";
import { ProjectReportScreen } from "./screens/ProjectReportScreen";

export default function App() {
  const [screen, setScreen] = useState("login");
  const [student, setStudent] = useState(null);
  const [teacher, setTeacher] = useState(null);
  const [assessmentId, setAssessmentId] = useState(null);

  const studentId = student?.studentId ?? null;

  // A teacher's session lives in a cookie the page cannot read, so the only
  // way to know whether one is signed in after a reload is to ask. Students
  // are not asked anything: they have no session to restore.
  useEffect(() => {
    let cancelled = false;
    fetchTeacherSession()
      .then((session) => {
        if (cancelled || !session) return;
        setTeacher(session);
        setScreen("teacher");
      })
      // An unreachable server on startup is not an error worth a screen: the
      // login form is the right thing to show, and it will fail loudly enough
      // if the server is still down when it is used.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="bg-tm-bg text-tm-text font-mono min-h-screen text-[14px] overflow-hidden">
      <AnimatePresence mode="wait">
        {screen === "login" && (
          <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.3 }}>
            {/* The login screen loads the student, so the dashboard opens on
                data that is already there rather than on a spinner. */}
            <LoginScreen
              onLogin={(loaded) => { setStudent(loaded); setScreen("dashboard"); }}
              onTeacherLogin={(session) => { setTeacher(session); setScreen("teacher"); }}
            />
          </motion.div>
        )}
        {screen === "teacher" && (
          <motion.div key="teacher" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <TeacherScreen
              teacher={teacher}
              onSignedOut={() => { setTeacher(null); setScreen("login"); }}
            />
          </motion.div>
        )}
        {screen === "dashboard" && (
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <DashboardScreen
              student={student}
              onSelectExam={(id) => { setAssessmentId(id); setScreen("detail"); }}
              onSelectProject={(id) => { setAssessmentId(id); setScreen("report"); }}
              onLogout={() => { setStudent(null); setScreen("login"); }}
            />
          </motion.div>
        )}
        {screen === "detail" && (
          <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <ExamDetailScreen assessmentId={assessmentId} studentId={studentId} onBack={() => setScreen("dashboard")} />
          </motion.div>
        )}
        {screen === "report" && (
          <motion.div key="report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <ProjectReportScreen assessmentId={assessmentId} studentId={studentId} onBack={() => setScreen("dashboard")} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
