-- Two catalogue codes, renamed for consistency and readability.
--
-- 0005 is already pushed, so it is not edited: migrations are forward-only,
-- which is the rule ADR-0003 sets and the way a schema behaves in production.
--
-- 'algo' becomes 'algo2'. The course is Data & Algorithms II — the exam titles
-- in src/data/algo/ say so — and it sat between algo1 and algo3 under a name
-- that made it look like a different kind of entry.
--
-- Note that 'algo2' no longer matches its folder name in src/data/. The rule
-- "code = folder name" now has one exception, and the import will stop with
-- "no course with code algo" the day that folder is added to import-map.json:
-- the map will have to carry the course code alongside the promotion.

update courses set code = 'algo2'    where code = 'algo';
update courses set code = 'database' where code = 'db_intro';
