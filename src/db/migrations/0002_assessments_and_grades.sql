-- What a class edition is graded on, and the grades themselves.

create table assessments (
    id           integer     generated always as identity primary key,
    class_id     integer     not null references classes (id),
    num          integer     not null,
    kind         text        not null check (kind in ('exam', 'project')),
    title        text        not null,
    total_points numeric     not null check (total_points > 0),
    coeff        numeric     not null check (coeff >= 0),
    body         jsonb,
    published_at timestamptz,
    unique (class_id, num)
);

comment on column assessments.num is
    'The folder number under src/data/<course>/, kept so an import can find the
     row it already created.';
comment on column assessments.body is
    'body.json stored exactly as the teacher wrote it. The questions are never
     normalised into tables: their shape is the teachers'' business, and a
     schema change must not be the price of a new question format.';
comment on column assessments.published_at is
    'Null means the students never see it, whatever the archive flags say.';

create index on assessments (class_id);

-- Group projects. One row per group, members in group_members. The grade of a
-- group lands on each member's row in grades: a grade is always something a
-- student holds, which keeps one single read path for "what did this student
-- get".
create table groups (
    id            integer generated always as identity primary key,
    assessment_id integer not null references assessments (id),
    num           integer not null,
    unique (assessment_id, num)
);

create table group_members (
    group_id   integer not null references groups (id),
    student_id text    not null references students (id),
    primary key (group_id, student_id)
);

create index on group_members (student_id);

create table grades (
    assessment_id integer not null references assessments (id),
    student_id    text    not null references students (id),
    grade         numeric,
    report        text,
    primary key (assessment_id, student_id)
);

comment on column grades.grade is
    'Null means not graded. The final average ignores those items in both the
     numerator and the denominator; the formula lives in src/lib/.';
comment on column grades.report is
    'The markdown correction report, stored as written. Text rather than a file
     path, so the database is self-contained.';

-- "Every grade of this student", the teacher-side read.
create index on grades (student_id);
