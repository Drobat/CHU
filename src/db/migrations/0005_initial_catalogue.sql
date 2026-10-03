-- The catalogue and the promotions that follow it. Reference data rather than
-- student data: it describes the programme, so it belongs to the schema's
-- history. Grades come in through npm run import, never through a migration.
--
-- Codes: the folder name under src/data/ for courses that already have one,
-- a short lowercase key otherwise.

insert into courses (code, title, level, semester) values
    ('python_intro', 'Introduction to Python',           'L1', 'S1'),
    ('algo1',        'Algorithms & Data Structures 1',   'L1', 'S1'),
    ('web',          'Web Development',                  'L1', 'S2'),
    ('algo',         'Algorithms & Data Structures 2',   'L1', 'S2'),
    ('python_oop',   'Python OOP',                       'L2', 'S1'),
    ('algo3',        'Algorithms & Data Structures 3',   'L2', 'S1'),
    ('cpp',          'C++',                              'L2', 'S2'),
    ('shell',        'Shell Programming',                'L2', 'S2'),
    ('db_intro',     'Introduction to Databases',        'L3', 'S1'),
    ('devops',       'System Admin to DevOps',           'L3', 'S1'),
    ('asm',          'Assembly',                         'L3', 'S1'),
    ('net',          'Network and Communications',       'L3', 'S2'),
    ('os',           'OS (Theoretical)',                 'L3', 'S2'),
    ('java',         'Java',                             'L3', 'S2'),
    ('fp',           'Functional Programming',           'L3', 'S2');

insert into cohorts (entry_year) values (2024), (2025), (2026);

-- One edition per (course, promotion), for every year already reached.
-- A promotion entering in Y sits level N during academic year Y + N - 1, and
-- the current academic year is 2026-27 — so the condition is the rule itself
-- rather than a hand-written list that would go stale next september.
insert into classes (course_id, cohort_id, academic_year, level, semester)
select
    c.id,
    h.id,
    h.entry_year + (substring(c.level from 2)::integer - 1),
    c.level,
    c.semester
from courses c
    cross join cohorts h
where h.entry_year + (substring(c.level from 2)::integer - 1) <= 2026;
