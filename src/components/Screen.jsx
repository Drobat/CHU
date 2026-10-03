import { motion } from "framer-motion";
import { C } from "../theme";
import { AsciiBox } from "./AsciiBox";
import { BlinkingCursor } from "./BlinkingCursor";

/**
 * What a screen shows while its data is on its way, and when it never arrives.
 *
 * Bundled data was always there, so no screen ever had to answer this. Now that
 * a request can be slow or fail, a blank page is the one answer that must not
 * happen — a student on a poor connection has to see that something is
 * happening, and that they can try again.
 */
export function Screen({ loading, error, what, children }) {
  if (loading) {
    return (
      <AsciiBox className="p-6">
        <div className="text-tm-dim text-[13px]">
          loading {what}… <BlinkingCursor />
        </div>
      </AsciiBox>
    );
  }

  if (error) {
    const missing = error.kind === "notFound";
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <AsciiBox accent={missing ? C.border : C.yellow} className="p-6">
          <div className="text-[13px]" style={{ color: missing ? C.textDim : C.yellow }}>
            {missing
              ? `${what} is not available.`
              : `${what} could not be loaded — the server did not answer.`}
          </div>
          {!missing && (
            <div className="text-tm-dim text-[12px] mt-2">
              Go back and open it again.
            </div>
          )}
        </AsciiBox>
      </motion.div>
    );
  }

  return children;
}
