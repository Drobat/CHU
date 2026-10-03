import { useState } from "react";
import { motion } from "framer-motion";
import { C, staggerItem } from "../theme";
import { AsciiBox } from "./AsciiBox";

export function ProjectCard({ assessment, onViewReport }) {
  const [hovered, setHovered] = useState(false);
  const group       = assessment.group;
  const hasReport   = assessment.hasReport;
  const hasGrade    = assessment.grade != null;
  const hasComments = group?.comments != null;

  return (
    <motion.div variants={staggerItem}>
      <motion.div
        whileHover={hasReport ? { x: 4 } : {}}
        onHoverStart={hasReport ? () => setHovered(true) : undefined}
        onHoverEnd={hasReport ? () => setHovered(false) : undefined}
        transition={{ duration: 0.15 }}
      >
        <AsciiBox
          className={`mb-3 ${hasReport ? "cursor-pointer" : ""}`}
          accent={hasReport && hovered ? C.yellow : undefined}
        >
          <div onClick={hasReport ? onViewReport : undefined}>

            <div className="p-3 sm:p-5 pb-0">

              {/* Title + coeff */}
              <div className="flex justify-between items-baseline mb-2 flex-wrap gap-2">
                <span className="text-tm-white text-[15px] font-bold">{assessment.title}</span>
                <span className="text-tm-dim text-[11px]">{assessment.coeff}%</span>
              </div>

              {/* Group badge + status */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {group && (
                  <span
                    className="text-[11px] px-2 py-0.5 tracking-wider font-bold border"
                    style={{ color: C.yellow, borderColor: C.yellow }}
                  >
                    GROUP {group.num}
                  </span>
                )}
                <span className="text-[11px] tracking-wider" style={{ color: C.green }}>
                  ✓ REGISTERED
                </span>
                {hasGrade && (
                  <span className="text-[11px] tracking-wider" style={{ color: C.cyan }}>
                    ● GRADED
                  </span>
                )}
              </div>

              {/* Dates + repo */}
              <div className="mb-4">
                <div className="text-tm-dim text-[11px] mb-1">
                  start {assessment.startsOn} ── deadline {assessment.dueOn}
                </div>
                {group?.repositoryUrl && (
                  <a
                    href={group.repositoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] tracking-wider break-all"
                    style={{ color: C.cyan }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    ⬡ {group.repositoryUrl}
                  </a>
                )}
              </div>

              {/* Grade + comments */}
              <div className="border-t pt-3 mb-4" style={{ borderColor: C.border }}>
                {hasGrade ? (
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-[22px] font-bold" style={{ color: C.green }}>
                      {assessment.grade}
                    </span>
                    <span className="text-tm-dim text-[14px]"> / {assessment.totalPoints}</span>
                  </div>
                ) : (
                  <div className="text-tm-dim text-[12px] tracking-wider mb-2">
                    GRADE PENDING
                  </div>
                )}
                {hasComments && (
                  <div
                    className="text-[12px] italic pl-3 border-l-2"
                    style={{ color: C.text, borderColor: C.yellow }}
                  >
                    {group.comments}
                  </div>
                )}
              </div>

            </div>

            {/* Report CTA — only when a report exists */}
            {hasReport && (
              <div
                className="px-3 sm:px-5 py-3 flex items-center justify-between border-t transition-colors duration-200"
                style={{
                  borderColor: hovered ? C.yellowDim : C.border,
                  background: hovered ? "rgba(255,215,0,0.06)" : "rgba(255,215,0,0.02)",
                }}
              >
                <span
                  className="text-[12px] tracking-wider font-bold"
                  style={{ color: C.yellow }}
                >
                  view correction &amp; report
                </span>
                <motion.span
                  style={{ color: C.yellow, fontSize: 16 }}
                  animate={{ x: [0, 4, 0] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                >
                  →
                </motion.span>
              </div>
            )}

          </div>
        </AsciiBox>
      </motion.div>
    </motion.div>
  );
}
