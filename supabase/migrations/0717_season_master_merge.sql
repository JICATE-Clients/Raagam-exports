-- 0717 · ONE SEASON LIST FOR ORDERS AND SAMPLE (user 2026-10-12: "order module
-- will list 4 winter, summer etc, this sample will list Q1, Q2 etc, so merge —
-- both modules should list all the seasons").
--
-- The Season master (Master Data ▸ System ▸ Season, 0308/0686) held Q1–Q4 and
-- fed Sample Entry; Orders offered a hard-coded SUMMER / WINTER / SPRING /
-- AUTUMN. The four words join the master here, and Order Entry, the Style
-- master and the Season report now read the master's names — so both modules
-- list the same eight, and a season added on the master reaches both.
--
-- CAPITALS (AGENTS.md): stored values are capitals. Orders saved "Summer"
-- before 2026-08-17; every reader compares seasons case-insensitively, so a
-- saved "Summer" still matches SUMMER.

insert into public.seasons (season, season_name)
select v, v
  from (values ('SUMMER'), ('WINTER'), ('SPRING'), ('AUTUMN')) as t(v)
 where not exists (
   select 1 from public.seasons s
    where upper(coalesce(nullif(s.season_name, ''), s.season)) = t.v
 );
