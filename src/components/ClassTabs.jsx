import { motion } from "framer-motion";
import { C } from "../theme";

/**
 * One tab per course the student sat.
 *
 * It used to show the whole catalogue with the courses they had not taken
 * greyed out, because the browser held everyone's data and could tell. The API
 * returns only this student's courses, so there is nothing to grey out — and
 * nothing to guess about what else exists.
 *
 * The label is the course code as the catalogue spells it, which is why a
 * folder named "algo" reads "algo2" here: the only spelling that stays
 * unambiguous once algo1 and algo3 are published too.
 */
export function ClassTabs({ courses, selectedCourse, onChange }) {
  if (courses.length === 0) return null;

  return (
    <div className="flex mb-5 relative">
      {courses.map((course) => {
        const active = course.id === selectedCourse;
        return (
          <motion.button
            key={course.id}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onChange(course.id)}
            title={course.fullName}
            className={[
              "flex-1 py-2.5 font-mono text-[13px] font-bold tracking-wider",
              "cursor-pointer relative border-y border-l transition-all duration-200",
              "overflow-hidden text-ellipsis whitespace-nowrap px-1",
              active
                ? "bg-tm-cyan text-tm-bg border-tm-cyan"
                : "bg-transparent text-tm-text border-tm-border",
            ].join(" ")}
          >
            {course.label}
            {/* sliding green underline that animates between active tabs */}
            {active && (
              <motion.div
                layoutId="activeTab"
                className="absolute -bottom-px left-0 right-0 h-0.5 bg-tm-green"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </motion.button>
        );
      })}
      <div
        style={{
          borderRight: `1px solid ${courses.at(-1).id === selectedCourse ? C.cyan : C.border}`,
        }}
      />
    </div>
  );
}
