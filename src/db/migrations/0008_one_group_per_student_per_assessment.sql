-- Fixes a duplication introduced by 0007 and removes the assumption that caused it.
--
-- 0007 joined group_members on the student alone. A student who sat two projects
-- has two memberships, so every row of student_grades_v came back twice for
-- them — 404 duplicated pairs on the C++ course. The comment in 0007 claimed the
-- join could not multiply rows; it was wrong, and the milestone course had no
-- groups at all, so no test saw it.
--
-- Restricting the join to the assessment is enough only as long as a student
-- belongs to one group per assessment. Nothing enforced that, so it is enforced
-- here rather than hoped for: group_members carries the assessment, a composite
-- foreign key keeps it agreeing with the group, and a unique constraint allows
-- one seat per assessment.

alter table groups
    add constraint groups_id_assessment_key unique (id, assessment_id);

alter table group_members
    add column assessment_id integer;

update group_members gm
   set assessment_id = gr.assessment_id
  from groups gr
 where gr.id = gm.group_id;

alter table group_members
    alter column assessment_id set not null,
    add constraint group_members_belongs_to_its_group
        foreign key (group_id, assessment_id) references groups (id, assessment_id),
    add constraint group_members_one_group_per_assessment
        unique (assessment_id, student_id);

comment on column group_members.assessment_id is
    'Copied from the group so that "one group per student per assessment" can be
     a unique constraint. The composite foreign key keeps the two in step.';

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
    -- One row at most: the unique constraint above allows the student one group
    -- per assessment, and the join names both.
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
