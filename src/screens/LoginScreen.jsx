/**
 * Login screen — terminal-style student ID prompt.
 *
 * The input is hidden off-screen; visible text + blinking cursor
 * are rendered manually for the authentic terminal look.
 * Shake animation triggers on wrong ID.
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { scaleIn, shake, delayedFade, delayedScale } from "../theme";
import { BlinkingCursor } from "../components";
import { fetchStudent, loginTeacher } from "../api/client";
import { isTeacherId } from "../lib/teacher-auth";

/**
 * The prefix says "this number is heading for a teacher account", which is what
 * the error messages and the clearing rules need. It is deliberately *not* what
 * reveals the password field: four digits are not a number, and a field that
 * appears on `2042` appears for every student mistyping a 2023 number.
 */
const TEACHER_PREFIX = /^2042/;

export function LoginScreen({ onLogin, onTeacherLogin }) {
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const inputRef = useRef(null);
  const passwordRef = useRef(null);

  // Both decided here, from the digits, with no request. Asking the server which
  // numbers are teachers' would be a way to enumerate them.
  //
  // Two questions, not one: `looksLikeTeacher` drives the error messages and the
  // clearing rules, `teacherIdComplete` drives the password field. Only a whole
  // number gets a password prompt.
  const looksLikeTeacher = TEACHER_PREFIX.test(studentId);
  const teacherIdComplete = isTeacherId(studentId);

  // Checking a number used to be a lookup in a table the browser already had.
  // It is now a request, so it can be slow and it can fail — and an unknown
  // number and an unreachable server must not read the same to a student.
  const submit = async () => {
    const id = studentId.trim();
    setError(null);
    if (!id || busy) return;

    // A teacher number has a fixed shape, so an incomplete one is caught here
    // rather than spent as one of the five attempts the server allows.
    if (looksLikeTeacher && !isTeacherId(id)) {
      setError({ kind: "teacherIdShape" });
      setShakeKey((k) => k + 1);
      return;
    }

    // Same reasoning one step further: an empty password cannot be the right one,
    // so it is refused here instead of costing one of the five.
    if (teacherIdComplete && !password) {
      setError({ kind: "passwordMissing" });
      setShakeKey((k) => k + 1);
      return;
    }

    setBusy(true);
    try {
      if (isTeacherId(id)) {
        const session = await loginTeacher({ id, password, remember });
        onTeacherLogin(session);
        return;
      }
      const student = await fetchStudent(id);
      onLogin(student);
    } catch (failure) {
      setError(teacherAwareError(failure, id));
      // Clearing the password and keeping the number is what a retry needs:
      // the number is almost always right and the password almost never is.
      if (looksLikeTeacher) setPassword("");
      else if (failure?.kind === "notFound") setStudentId("");
      setShakeKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  const focus = () => (teacherIdComplete ? passwordRef : inputRef).current?.focus();

  /**
   * Focus follows the field that is visible, and it is moved *here* rather than
   * from a ref callback. A callback ref runs on every render, so focusing from
   * one stole the caret back to the number on each keystroke of the password —
   * the second character and everything after it landed in the number instead.
   * An effect keyed on the transition runs once per transition, which is the
   * number of times focus should move.
   */
  useEffect(() => {
    (teacherIdComplete ? passwordRef : inputRef).current?.focus();
  }, [teacherIdComplete]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4" onClick={focus}>
      <motion.div {...scaleIn} className="w-full max-w-[600px] border-[1.5px] border-tm-cyan bg-tm-bg">

        <TitleBar />

        <div className="pt-6 pb-5 px-4 sm:pt-8 sm:pb-6 sm:px-6">
          <SchoolHeader />
          <IdPrompt
            studentId={studentId}
            password={password}
            remember={remember}
            showPassword={teacherIdComplete}
            error={error}
            busy={busy}
            shakeKey={shakeKey}
            inputRef={inputRef}
            passwordRef={passwordRef}
            onSubmit={submit}
            onFocus={focus}
            onChange={(val) => {
              setStudentId(val);
              setError(null);
              // Leaving the teacher range clears what was typed into a field
              // that is about to disappear.
              if (!TEACHER_PREFIX.test(val)) { setPassword(""); setRemember(false); }
            }}
            onPasswordChange={(val) => { setPassword(val); setError(null); }}
            onRememberChange={setRemember}
          />
        </div>

      </motion.div>
    </div>
  );
}

/**
 * The server answers one thing for a wrong number and a wrong password alike,
 * and this function does not try to be cleverer than that. Only the rate limit
 * is told apart, because "wait" and "try again" ask for different behaviour.
 */
function teacherAwareError(failure, id) {
  if (failure?.kind === "rateLimited") return { kind: "rateLimited" };
  if (failure?.kind === "refused") return { kind: "refused" };
  if (failure?.kind === "notFound") return { kind: "notFound", id };
  return { kind: "unreachable" };
}

// ── Sub-components ───────────────────────────────

function TitleBar() {
  return (
    <div className="flex items-center justify-between px-3.5 py-2 border-b border-tm-border">
      <div className="text-[11px]">
        <span className="text-tm-green opacity-70">user@exam-server:~$</span>
        <span className="text-tm-dim ml-3">./results --view</span>
      </div>
      <div className="flex gap-1.5">
        {["tm-green", "tm-yellow", "tm-red"].map((c) => (
          <span key={c} className={`w-2.5 h-2.5 rounded-full bg-${c} opacity-60`} />
        ))}
      </div>
    </div>
  );
}

function SchoolHeader() {
  return (
    <>
      <motion.div {...delayedFade(0.2)} className="text-center mb-2">
        <div className="text-[24px] sm:text-[28px] font-bold text-tm-cyan tracking-[3px]">EPITA</div>
        <div className="text-[13px] text-tm-dim tracking-[4px] my-1">×</div>
        <div className="text-[15px] sm:text-[20px] font-bold text-tm-cyan tracking-[1px] sm:tracking-[2px]">CHANG'AN UNIVERSITY</div>
      </motion.div>

      <motion.div {...delayedScale(0.4)} className="text-center text-tm-border text-[12px] my-4 origin-center overflow-hidden">
        {"─".repeat(40)}
      </motion.div>

      <motion.div {...delayedFade(0.5)} className="text-center text-[11px] sm:text-[13px] text-tm-green tracking-[3px] sm:tracking-[6px] mb-6">
        EXAM RESULTS VIEWER
      </motion.div>

      <motion.div {...delayedScale(0.6)} className="text-center text-tm-border text-[12px] mb-6 origin-center overflow-hidden">
        {"─".repeat(40)}
      </motion.div>
    </>
  );
}

function IdPrompt({
  studentId, password, remember, showPassword, error, busy, shakeKey,
  inputRef, passwordRef, onSubmit, onFocus, onChange, onPasswordChange, onRememberChange,
}) {
  return (
    <motion.div {...delayedFade(0.7)}>
      <div className="text-tm-text mb-3 text-[13px]">Enter your student ID:</div>

      <TerminalInput
        studentId={studentId}
        error={error}
        shakeKey={shakeKey}
        inputRef={inputRef}
        onSubmit={onSubmit}
        onFocus={onFocus}
        onChange={onChange}
      />

      <AnimatePresence>
        {showPassword && (
          <PasswordPrompt
            password={password}
            remember={remember}
            passwordRef={passwordRef}
            onSubmit={onSubmit}
            onChange={onPasswordChange}
            onRememberChange={onRememberChange}
          />
        )}
      </AnimatePresence>

      <StatusLine error={error} busy={busy} />

      <div className="flex justify-end">
        <SubmitButton onSubmit={onSubmit} busy={busy} />
      </div>
    </motion.div>
  );
}

/**
 * Appears once the ten digits of a teacher number are there, and without a
 * request: the server is never asked whether a number belongs to a teacher.
 *
 * The characters are rendered as dots rather than echoed, and the real input is
 * a type="password" off-screen so that a password manager still recognises it
 * and the browser never shows the value.
 */
function PasswordPrompt({ password, remember, passwordRef, onSubmit, onChange, onRememberChange }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="flex items-center cursor-text mt-3" onClick={() => passwordRef.current?.focus()}>
        <span className="text-tm-yellow whitespace-nowrap text-[12px] sm:text-[14px]">teacher@exam</span>
        <span className="text-tm-dim text-[12px] sm:text-[14px]">:~$ </span>
        <span className="text-tm-white tracking-[2px]">{"•".repeat(password.length)}</span>
        <BlinkingCursor />
        <input
          ref={passwordRef}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          className="fixed top-0 left-0 opacity-0 w-px h-px pointer-events-none"
        />
      </div>

      {/* Unchecked by default, and labelled "this computer" rather than
          "remember me": the choice is about the machine, not the person. */}
      <label className="flex items-center gap-2 mt-3 text-[11px] text-tm-dim cursor-pointer select-none">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => onRememberChange(e.target.checked)}
          className="accent-tm-cyan cursor-pointer"
        />
        Stay signed in on this computer
      </label>
    </motion.div>
  );
}

function TerminalInput({ studentId, error, shakeKey, inputRef, onSubmit, onFocus, onChange }) {
  return (
    <motion.div
      key={shakeKey}
      animate={error ? shake : {}}
      className="flex items-center cursor-text overflow-hidden"
      onClick={onFocus}
    >
      <span className="text-tm-green whitespace-nowrap text-[12px] sm:text-[14px]">student@exam</span>
      <span className="text-tm-dim text-[12px] sm:text-[14px]">:~$ </span>
      <span className="text-tm-white">{studentId}</span>
      <BlinkingCursor />
      <input
        ref={inputRef}
        type="text" inputMode="numeric"
        value={studentId}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        className="fixed top-0 left-0 opacity-0 w-px h-px pointer-events-none"
      />
    </motion.div>
  );
}

/**
 * One line for the three things that can now happen: a request is in flight, a
 * number is unknown, or the server did not answer. Telling the last two apart
 * matters — one is the student's mistake, the other is not.
 */
function StatusLine({ error, busy }) {
  return (
    <div className="h-5 mt-2 text-[12px]">
      <AnimatePresence mode="wait">
        {busy && (
          <motion.span key="busy" className="text-tm-dim"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            checking…
          </motion.span>
        )}
        {!busy && error?.kind === "notFound" && (
          <motion.span key="notFound" className="text-tm-red"
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            -bash: student '{error.id}': not found
          </motion.span>
        )}
        {!busy && error?.kind === "refused" && (
          <motion.span key="refused" className="text-tm-red"
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            -bash: Invalid ID or password
          </motion.span>
        )}
        {!busy && error?.kind === "rateLimited" && (
          <motion.span key="rateLimited" className="text-tm-yellow"
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            -bash: too many attempts — wait 15 minutes
          </motion.span>
        )}
        {!busy && error?.kind === "teacherIdShape" && (
          <motion.span key="teacherIdShape" className="text-tm-dim"
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            -bash: a teacher ID is 10 digits
          </motion.span>
        )}
        {!busy && error?.kind === "passwordMissing" && (
          <motion.span key="passwordMissing" className="text-tm-dim"
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            -bash: password required
          </motion.span>
        )}
        {!busy && error?.kind === "unreachable" && (
          <motion.span key="unreachable" className="text-tm-yellow"
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            -bash: server unreachable — try again
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function SubmitButton({ onSubmit, busy }) {
  return (
    <motion.button
      whileHover={busy ? {} : { scale: 1.05 }}
      whileTap={busy ? {} : { scale: 0.95 }}
      onClick={onSubmit}
      disabled={busy}
      className={`bg-transparent text-tm-cyan border border-tm-border font-mono text-[11px] px-3.5 py-1 tracking-wider ${busy ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
    >
      [enter]
    </motion.button>
  );
}
