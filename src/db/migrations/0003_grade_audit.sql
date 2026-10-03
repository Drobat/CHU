-- Every grade change is recorded, whoever makes it.
--
-- The journal is written by a trigger rather than by application code: an
-- import, a route handler and a psql session are three different write paths,
-- and only the database sees all three.

create table grade_audit (
    id            bigint      generated always as identity primary key,
    assessment_id integer     not null,
    student_id    text        not null,
    old_grade     numeric,
    new_grade     numeric,
    source        text        not null check (source in ('import', 'manual')),
    changed_by    text        not null,
    changed_at    timestamptz not null default now()
);

-- No foreign keys on purpose: a journal that can be blocked or cascaded away
-- by a change to the rows it describes is not a journal.
comment on table grade_audit is
    'Append-only history of grades. Deliberately not tied to assessments or
     students by foreign keys, so deleting either cannot erase the record.';
comment on column grade_audit.changed_by is
    'Taken from app.actor. "unknown" means something wrote without declaring
     itself — worth looking into, but better recorded than lost.';

create index on grade_audit (assessment_id, student_id);

create function log_grade_change() returns trigger
language plpgsql
as $$
declare
    actor  text := coalesce(nullif(current_setting('app.actor', true), ''), 'unknown');
    source text := coalesce(nullif(current_setting('app.source', true), ''), 'manual');
begin
    if (tg_op = 'DELETE') then
        insert into grade_audit (assessment_id, student_id, old_grade, new_grade, source, changed_by)
        values (old.assessment_id, old.student_id, old.grade, null, source, actor);
        return old;
    end if;

    insert into grade_audit (assessment_id, student_id, old_grade, new_grade, source, changed_by)
    values (
        new.assessment_id,
        new.student_id,
        case when tg_op = 'UPDATE' then old.grade end,
        new.grade,
        source,
        actor
    );
    return new;
end;
$$;

comment on function log_grade_change() is
    'Reads app.actor and app.source, set with SET LOCAL inside the writing
     transaction. The import sets source to "import"; everything else is
     "manual".';

create trigger grades_audit
    after insert or update or delete on grades
    for each row execute function log_grade_change();
