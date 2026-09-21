-- ============================================================================
-- Raagam ERP — 0611 Yarn stage logic (client spec 2026-09-21, "Yarn & YD Stage
-- Logic Rules for Process Listing"). Plan: doc/order/yarn-stage-logic-plan.md
--
-- Three small things the spec asked for that the schema did not yet say:
--
-- 1. A PROCESS IS THE BASE (entry step) OF AT MOST ONE STAGE. `baseStageProblem`
--    has refused it at Save since 0563; the table never did. The spec's
--    `idx_single_base_process` partial index, under this repo's name. A process
--    may still RUN in several stages (COMPACTING under DYED, WASH and PRINT) —
--    only `is_base` is limited, so plain rows are untouched.
--
-- 2. YARN PROCESSES ARE CLASSIFIED ON THE SAME TABLE. `process_fabric_stages`
--    was fed only for `for_fabric` processes (the master's normaliser dropped
--    the rows otherwise — code change in this same commit). The stage list is
--    still `fabric_stage`; the Yarn Process tab matches its own `yarn_stage`
--    rows to it BY CODE (`grey`, `dyed`), never by id. No schema change for
--    that: the FK to `config_lookups` never cared what kind the row was.
--
-- 3. THE SPEC'S TWO YARN-SIDE ROWS, seeded: YARN PURCHASE (GREIGE, base) and
--    YARN DYEING → DYED (base). Matched by name and by stage MEANING (code or
--    name, case-insensitive — 0563's own rule, because an operator renamed
--    grey → GREIGE). Nothing existing is overwritten; a row already there is
--    left as the operator set it.
--
-- VERIFY FROM THE CATALOG, never from "the SQL ran":
--   select process_id, count(*) from process_fabric_stages
--    where is_base group by 1 having count(*) > 1;            -- must be 0 rows
--   select indexname from pg_indexes
--    where indexname = 'uq_process_fabric_stages_one_base';   -- must be 1 row
-- ============================================================================

-- 1. Name any offender BEFORE the index, so a failure says which process.
do $$
declare
  bad text;
begin
  select string_agg(p.name, ', ') into bad
    from (select process_id from public.process_fabric_stages
           where is_base group by process_id having count(*) > 1) d
    join public.processes p on p.id = d.process_id;
  if bad is not null then
    raise exception '0611: these processes are Base on more than one stage — untick all but one on Master Data ▸ Processes first: %', bad;
  end if;
end $$;

create unique index if not exists uq_process_fabric_stages_one_base
  on public.process_fabric_stages (process_id)
  where is_base;

comment on index public.uq_process_fabric_stages_one_base is
  '0611: a process is the entry (base) step of at most one stage; it may still run in several.';

-- 3. Seeds.
insert into public.processes (name, for_yarn)
select 'YARN PURCHASE', true
where not exists (select 1 from public.processes where upper(trim(name)) = 'YARN PURCHASE');

-- YARN PURCHASE → GREIGE, base. YARN DYEING → DYED, base. Only where the pair
-- is absent; an existing pairing keeps whatever `is_base` the operator chose.
insert into public.process_fabric_stages (process_id, stage_id, is_base)
select p.id, s.id, true
  from public.processes p
  join public.config_lookups s
    on s.kind = 'fabric_stage'
   and (lower(s.code) in ('grey', 'greige') or upper(s.name) in ('GREY', 'GREIGE'))
 where upper(trim(p.name)) = 'YARN PURCHASE'
   and not exists (select 1 from public.process_fabric_stages x where x.process_id = p.id and x.stage_id = s.id)
   and not exists (select 1 from public.process_fabric_stages x where x.process_id = p.id and x.is_base);

insert into public.process_fabric_stages (process_id, stage_id, is_base)
select p.id, s.id, true
  from public.processes p
  join public.config_lookups s
    on s.kind = 'fabric_stage'
   and (lower(s.code) = 'dyed' or upper(s.name) = 'DYED')
 where upper(trim(p.name)) = 'YARN DYEING'
   and not exists (select 1 from public.process_fabric_stages x where x.process_id = p.id and x.stage_id = s.id)
   and not exists (select 1 from public.process_fabric_stages x where x.process_id = p.id and x.is_base);

-- Smoke test.
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_process_fabric_stages_one_base') then
    raise exception '0611: uq_process_fabric_stages_one_base missing';
  end if;
  if not exists (select 1 from public.processes where upper(trim(name)) = 'YARN PURCHASE' and for_yarn) then
    raise exception '0611: YARN PURCHASE not seeded';
  end if;
end $$;
