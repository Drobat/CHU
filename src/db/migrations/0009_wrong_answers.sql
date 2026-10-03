-- The answers a student got wrong, which the exam review screen marks question
-- by question.
--
-- students.json carries them under "wrong": a map of question id to the option
-- the student picked. The first import read only the grade, so 369 of the 1 559
-- imported records lost their detail — and the screen would have told those
-- students their answers were not recorded, which is false.
--
-- Stored as jsonb and exactly as written, like assessments.body: the shape of a
-- question is the teachers' business, and a new question format must not cost a
-- schema change.

alter table grades
    add column wrong_answers jsonb;

comment on column grades.wrong_answers is
    'students.json "wrong", as written: question id to the option the student
     picked. Null means the teacher did not record answers for this exam, which
     is different from an empty object — that one means every answer was right.';

create or replace view student_grades_v as
select
    g.student_id,
    g.assessment_id,
    g.grade,
    g.report,
    a.kind,
    a.num           as assessment_num,
    a.title         as assessment_title,
    a.total_points,
    a.coeff,
    a.body,
    a.published_at,
    cl.id           as class_id,
    cl.academic_year,
    cl.level,
    cl.semester,
    co.code         as course_code,
    co.title        as course_title,
    a.held_on,
    a.starts_on,
    a.due_on,
    gr.num          as group_num,
    gr.repository_url,
    gr.comments     as group_comments,
    g.wrong_answers
from grades g
    join assessments a  on a.id = g.assessment_id
    join classes cl     on cl.id = a.class_id
    join courses co     on co.id = cl.course_id
    join students s     on s.id = g.student_id
    join cohorts sc     on sc.id = s.cohort_id   -- the promotion the student belongs to
    join cohorts cc     on cc.id = cl.cohort_id  -- the promotion the edition was run for
    -- One row at most: the unique constraint of 0008 allows the student one
    -- group per assessment, and the join names both.
    left join group_members gm on gm.student_id = g.student_id and gm.assessment_id = a.id
    left join groups gr        on gr.id = gm.group_id
where a.published_at is not null
  and cl.archived_at is null
  and co.archived_at is null
  and sc.archived_at is null
  and cc.archived_at is null;

comment on view student_grades_v is
    'Published assessments of editions, courses and promotions that are not
     archived. Two promotions are checked, not one: a student repeating a year
     belongs to one promotion while sitting the edition of another, and
     archiving either has to hide the grade. Archiving errs towards hiding.';
