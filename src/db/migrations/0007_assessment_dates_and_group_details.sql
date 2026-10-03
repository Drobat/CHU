-- What the interface shows that the initial schema did not keep.
--
-- The screens render project dates, repository links and the teacher's comment
-- on a group. None of them had a column, so wiring the front end to the API
-- would have silently dropped them.
--
-- Group names are deliberately NOT stored. In the imported data 661 of 1079
-- group names are exactly a member's name and 26 more contain one, and 1047
-- groups have a single member: the name of a "group" is usually the name of a
-- student. No student name enters this database. A report is addressed by its
-- group number, which is stable and identifies nobody.

alter table assessments
    add column held_on   date,
    add column starts_on date,
    add column due_on    date;

comment on column assessments.held_on is
    'info.json "date": the day an exam was sat. Distinct from published_at,
     which is the day its grades became visible to students.';
comment on column assessments.starts_on is
    'info.json "startDate": the day a project opened.';
comment on column assessments.due_on is
    'info.json "deadline": the day a project was due.';

alter table groups
    add column repository_url text,
    add column comments       text;

comment on column groups.comments is
    'The teacher''s remark on the group as a whole. Distinct from grades.report,
     which is the per-student correction written in markdown.';

-- The view gains the new columns and the group a student belongs to. The join
-- cannot multiply rows: a student sits in at most one group per assessment,
-- which the primary key of group_members enforces.
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
    gr.comments     as group_comments
from grades g
    join assessments a  on a.id = g.assessment_id
    join classes cl     on cl.id = a.class_id
    join courses co     on co.id = cl.course_id
    join students s     on s.id = g.student_id
    join cohorts sc     on sc.id = s.cohort_id   -- the promotion the student belongs to
    join cohorts cc     on cc.id = cl.cohort_id  -- the promotion the edition was run for
    left join group_members gm on gm.student_id = g.student_id
    left join groups gr        on gr.id = gm.group_id and gr.assessment_id = a.id
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
