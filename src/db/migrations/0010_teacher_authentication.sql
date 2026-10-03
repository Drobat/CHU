-- Teacher accounts, their sessions and the failed-login record.
-- See docs/adr/0008-teacher-authentication.md for why each choice is what it is.
--
-- Teachers are a separate table from students rather than a flag on one table.
-- The two have nothing in common beyond being people: a student has a cohort
-- and grades, a teacher has a password and sessions, and a column that is null
-- for everyone but three rows is an invitation to forget a filter on the path
-- that reads grades.

create table teachers (
    id            text        primary key check (id ~ '^2042[0-9]{6}$'),
    -- PBKDF2-SHA256. Stored as bytea rather than base64 text: the comparison
    -- happens on bytes, and a round trip through base64 is one more place for
    -- an encoding mistake to look like a wrong password.
    password_salt bytea       not null check (length(password_salt) = 16),
    password_hash bytea       not null check (length(password_hash) = 32),
    -- Stored per account, not hardcoded, so the count can be raised without
    -- resetting anybody: a login that finds a stale count re-hashes in place.
    -- The floor is the ADR's measurement, not a round number.
    iterations    integer     not null check (iterations >= 50000),
    created_at    timestamptz not null default now(),
    password_set_at timestamptz not null default now()
);

comment on table teachers is
    'Three accounts, created by npm run create-teacher. No sign-up route
     exists and none is planned.';
comment on column teachers.iterations is
    'PBKDF2 iteration count used for this row. See ADR-0008: the value is
     conditional on passwords staying machine-generated.';
comment on column teachers.password_set_at is
    'When the stored hash was last written. Tells a rotation apart from the
     account creation, which created_at cannot once a password is reset.';

-- A teacher number must never be usable as a student number. The constraint is
-- here as well as in the application because the database sees every write
-- path -- the import, a route handler, a psql session -- and the application
-- only sees its own.
--
-- Safe to apply to existing data: no id in src/data/ begins with 2042. The
-- prefixes in use are 2023, 2024 and 2025, and 2042 is a transposition of the
-- middle one, which is a usability problem recorded in the ADR rather than a
-- data problem here.
alter table students
    add constraint students_id_not_a_teacher check (id !~ '^2042');

comment on constraint students_id_not_a_teacher on students is
    'A 2042-prefixed number identifies a teacher (ADR-0008). Refusing it here
     means an import cannot create a student who shadows one.';

-- Only the hash of the token is stored. A database dump, or a backup, or a
-- careless select then yields nothing that can be replayed as a session.
create table teacher_sessions (
    token_hash   bytea       primary key check (length(token_hash) = 32),
    teacher_id   text        not null references teachers (id) on delete cascade,
    expires_at   timestamptz not null,
    last_seen_at timestamptz not null default now(),
    created_at   timestamptz not null default now()
);

comment on table teacher_sessions is
    'One row per live session. SHA-256 of a 32-byte random token; the token
     itself exists only in the cookie. Logging out deletes the row, so a
     stolen cookie stops working.';
comment on column teacher_sessions.expires_at is
    '12 hours by default, 30 sliding days when "stay signed in" was checked.
     A sliding session is extended by moving this column, not by issuing a new
     token.';

-- Expiry is the common filter on every authenticated request, and deleting
-- what has expired is the only housekeeping this table needs.
create index on teacher_sessions (expires_at);
create index on teacher_sessions (teacher_id);

-- Failures only. A successful login is in teacher_sessions; recording it twice
-- would mean keeping a log of who worked when, which is not something this
-- project needs to know.
create table login_attempts (
    id         bigint      generated always as identity primary key,
    -- Not a foreign key: the interesting case is a number that does not exist,
    -- and a rate limit that only counts attempts against real accounts tells
    -- an attacker which numbers are real.
    teacher_id text        not null,
    attempted_at timestamptz not null default now()
);

comment on table login_attempts is
    'Failed teacher logins, for the five-per-fifteen-minutes limit of ADR-0008.
     Deliberately carries no foreign key and no IP address: counting attempts
     against numbers that do not exist is what stops the limit from being an
     account-existence oracle.';

-- The limit asks one question -- how many failures for this number since a
-- point in time -- and this index is that question.
create index on login_attempts (teacher_id, attempted_at);
