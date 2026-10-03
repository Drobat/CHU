-- Three separate notions, deliberately not collapsed into one "class" table:
--   cohorts  a promotion, identified by the year it entered the school
--   courses  the catalogue: what the programme teaches, in theory
--   classes  one course taken by one cohort in one academic year
-- Assessments and grades hang off a class edition, never off a course, so that
-- changing the programme later cannot rewrite what a past promotion was graded
-- on.

create table cohorts (
    id          integer generated always as identity primary key,
    entry_year  integer     not null unique,
    archived_at timestamptz
);

comment on column cohorts.archived_at is
    'Set to hide every grade of this promotion from students. Reversible; nothing is deleted.';

create table courses (
    id          integer generated always as identity primary key,
    code        text        not null unique,
    title       text        not null,
    level       text        not null check (level in ('L1', 'L2', 'L3')),
    semester    text        not null check (semester in ('S1', 'S2')),
    archived_at timestamptz
);

comment on column courses.code is
    'Short lowercase key. For courses already present in src/data/, the folder name.';
comment on column courses.semester is
    'S1 runs september to december, S2 march to june.';

create table classes (
    id            integer     generated always as identity primary key,
    course_id     integer     not null references courses (id),
    cohort_id     integer     not null references cohorts (id),
    academic_year integer     not null,
    level         text        not null check (level in ('L1', 'L2', 'L3')),
    semester      text        not null check (semester in ('S1', 'S2')),
    archived_at   timestamptz,
    unique (course_id, cohort_id, academic_year)
);

comment on table classes is
    'One edition of a course: a cohort taking it in a given academic year.';
comment on column classes.academic_year is
    'The year the academic year starts: 2026 means 2026-27.';
comment on column classes.level is
    'Copied from the course when the edition is created, then frozen. The
     programme can be reorganised; what a promotion actually took cannot.';

create index on classes (cohort_id);
create index on classes (course_id);

-- No name, ever. The student identifier is the only thing we keep, and the
-- English names in src/data/ are dropped on import.
create table students (
    id        text    primary key,
    cohort_id integer not null references cohorts (id)
);

comment on column students.cohort_id is
    'A student repeating a year is moved to another cohort by hand.';

create index on students (cohort_id);
