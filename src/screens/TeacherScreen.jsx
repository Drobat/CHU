/**
 * What a signed-in teacher sees — which is, for now, almost nothing.
 *
 * The teacher area itself is BDD-33 (CSV import) and BDD-34 (a student's
 * grades and the exports). This screen exists because a session has to be
 * visible and endable: without it, signing in would leave a teacher on a
 * screen that does not know they are signed in, and the only way out would be
 * to clear a cookie they cannot see.
 *
 * It is deliberately bare rather than a placeholder dashboard. An empty frame
 * with headings for features that do not exist reads as broken; a screen that
 * says what is and is not there reads as honest.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { scaleIn } from "../theme";
import { logoutTeacher } from "../api/client";

export function TeacherScreen({ teacher, onSignedOut }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await logoutTeacher();
      onSignedOut();
    } catch {
      // The session lives in the database, so a failed request means it is
      // still open. Saying so is better than returning to the login screen
      // and leaving a usable cookie behind.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div {...scaleIn} className="w-full max-w-[600px] border-[1.5px] border-tm-yellow bg-tm-bg">
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-tm-border">
          <div className="text-[11px]">
            <span className="text-tm-yellow opacity-70">teacher@exam-server:~$</span>
            <span className="text-tm-dim ml-3">./results --admin</span>
          </div>
          <div className="flex gap-1.5">
            {["tm-green", "tm-yellow", "tm-red"].map((c) => (
              <span key={c} className={`w-2.5 h-2.5 rounded-full bg-${c} opacity-60`} />
            ))}
          </div>
        </div>

        <div className="pt-6 pb-5 px-4 sm:px-6">
          <div className="text-[13px] text-tm-green mb-1">Signed in</div>
          <div className="text-[20px] sm:text-[24px] font-bold text-tm-cyan tracking-[2px] mb-4">
            {teacher?.id}
          </div>

          <div className="text-tm-border text-[12px] my-4 overflow-hidden">{"─".repeat(40)}</div>

          <p className="text-[12px] text-tm-dim leading-relaxed">
            The teacher area is not built yet. Importing grades from a CSV and
            reading a student&apos;s full record are separate pieces of work; this
            session is what they will be built behind.
          </p>

          {teacher?.expiresAt && (
            <p className="text-[11px] text-tm-dim mt-4">
              This session ends on{" "}
              <span className="text-tm-text">
                {new Date(teacher.expiresAt).toLocaleString()}
              </span>
              .
            </p>
          )}

          <div className="h-5 mt-3 text-[12px]">
            {failed && (
              <span className="text-tm-red">
                -bash: sign-out failed — you are still signed in
              </span>
            )}
          </div>

          <div className="flex justify-end mt-2">
            <motion.button
              whileHover={busy ? {} : { scale: 1.05 }}
              whileTap={busy ? {} : { scale: 0.95 }}
              onClick={signOut}
              disabled={busy}
              className={`bg-transparent text-tm-yellow border border-tm-border font-mono text-[11px] px-3.5 py-1 tracking-wider ${
                busy ? "opacity-50 cursor-wait" : "cursor-pointer"
              }`}
            >
              {busy ? "[signing out…]" : "[sign out]"}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
