-- The only thing a student is allowed to read.
--
-- The rule lives here rather than in the API so that it cannot be forgotten by
-- one endpoint out of five. The student API reads this view and nothing else;
-- the teacher area reads the tables and sees everything, archives included.

create view student_grades_v as
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
    co.title        as course_title
from grades g
    join assessments a  on a.id = g.assessment_id
    join classes cl     on cl.id = a.class_id
    join courses co     on co.id = cl.course_id
    join students s     on s.id = g.student_id
    join cohorts sc     on sc.id = s.cohort_id   -- the promotion the student belongs to
    join cohorts cc     on cc.id = cl.cohort_id  -- the promotion the edition was run for
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
