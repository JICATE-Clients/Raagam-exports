-- ============================================================================
-- Raagam ERP — 0563 WHICH PROCESS MAY RUN IN WHICH FABRIC STAGE
-- (`process_fabric_stages`), and the two missing stages.
--
-- doc/order/fabriprocess.md §1 and §3, from the client recording of 2026-09-16.
--
--
-- ## §1 — WHY THIS IS A STOCK-LEDGER RULE AND NOT A TIDINESS RULE
--
-- Fabric inventory is four physically distinct ledgers: Greige (rolls straight
-- off the knitting machine or bought greige), Dyed (rolls that have finished
-- fabric dyeing or yarn dyeing), Washed (melange / yarn-dyed rolls that have
-- been washed) and Printed (rolls that have been all-over printed). The STAGE
-- on a Fabric Process row is what decides which of those four a step's weight
-- is logged against.
--
-- So `Stage = Dyed, Process = Knitting` is not a typo the operator can shrug
-- off: the weight lands in the Dyed ledger while the cloth is still greige,
-- and from there it corrupts warehouse stock, material availability and
-- financial valuation. Nothing in 0492 constrains that pair — Stage and
-- Process are two independent ▾ columns and every combination of them saves.
-- This migration is what makes the pair answerable.
--
--
-- ## A TABLE, NOT A FLAG PER PROCESS — AND THAT IS FORCED, NOT PREFERRED
--
-- 0528 (`is_print`) and 0557 (`is_dyeing`) are the two precedents for
-- classifying a process, and both are a single boolean column because both
-- answer a yes/no question about the process ALONE. This one cannot be:
-- §3's table puts **Stentering** in Dyed *and* Washed, and **Compacting** in
-- Dyed *and* Washed *and* Printed. A `processes.fabric_stage_id` column can
-- hold one answer, so it would have to pick one of those three and silently
-- refuse the other two — the rule would be wrong for the very processes that
-- occur most often. Many-to-many is the shape the data has.
--
-- `is_base` rides on the pairing rather than on the process for the same
-- reason: a process is the base of AT MOST ONE stage but is a secondary step
-- in several, so "is this the mandatory entry step" is a property of the pair.
--
-- SEEDED ONCE, OPERATOR-MAINTAINED FROM THEN ON — the sentence 0528 and 0557
-- both wrote and the reason they both wrote it. A name match is evidence, not
-- a rule: it is used HERE, once, to give the table a starting population, and
-- it is never re-evaluated at read time. `processesForFabric` reads rows from
-- this table and nothing else, so a process the seed misclassified is fixed by
-- an operator on the Process master (0565's grid) and stays fixed.
--
--
-- ## WHAT THE MASTER ACTUALLY HOLDS — CHECKED, NOT ASSUMED (2026-09-16)
--
-- The live `processes` master holds **17 rows, 7 of them `for_fabric`**:
-- COMPACTING [OPEN WIDTH], COMPACTING [TUBULAR], DYEING, FABRIC PURCHASE,
-- HEAT SETTING, KNITTING, STENTERING. 0294's 438-row legacy import is NOT in
-- this database. So of §3's four base processes only **two exist to be
-- seeded** — Knitting and Dyeing. There is no WASHING and no `for_fabric`
-- PRINTING row, so the Washed and Printed stages come out of this migration
-- with secondary steps and **NO BASE**.
--
-- That is a correct outcome, not a failed seed, and the rule file
-- (`lib/orders/fabric-bom/stage-routes.ts`) is built around it: the
-- "first step must be the base process" restriction STANDS DOWN on a stage
-- with no base, because a restriction that offers the operator nothing is not
-- stricter, it is unsatisfiable. The seed below is written so that every
-- pattern which matches nothing simply contributes no row — adding WASHING to
-- the master later, and ticking Fabric on it, is all that is needed for the
-- Washed stage to acquire its base.
--
-- `YARN DYEING` is deliberately NOT seeded although §3 names it beside Dyeing.
-- It is `for_yarn`, not `for_fabric`, so `processesForFabric` would never
-- offer it on a fabric route however this table classified it — and that is
-- right rather than an oversight: a yarn-dyed fabric's dyeing loss is carried
-- on the YARN side (`order_fabric_bom_yarn_stages`, 0493) and 0557 exists to
-- keep a second Fabric Dyeing step from doubling it. The consequence is that
-- on a Yarn-Dyed fabric the Dyed stage has no *offerable* base either, which
-- is the same stand-down as above and is covered by its own vector.
--
-- `FABRIC PURCHASE` is left UNCLASSIFIED on purpose. It is §2's procurement
-- route (Default Rule 2, "Greige Fabric Purchase"), which is declared per
-- fabric on `order_fabric_bom_process_scope` and not as a step in §3's table.
-- Unclassified means "offered in every stage" — see the rule file's header for
-- why that is the safe default and not weak enforcement.
--
--
-- ## THE TWO NEW STAGES, AND WHY `where not exists` HAD TO MATCH ON MEANING
--
-- §3 needs four stages and 0492 seeded two (`grey`, `dyed`). The obvious edit
-- is to insert `washed` and `printed` guarded by `where not exists ... code =`,
-- which is 0279's idiom and what every earlier lookup seed in this repo does.
--
-- AGAINST THIS DATABASE THAT WOULD HAVE SHIPPED FOUR STAGES MEANING TWO
-- THINGS. `config_lookups` kind `fabric_stage` already holds FOUR rows, not
-- 0492's two — an operator has added them by hand, under their own codes:
--
--     code 'grey'  -> name GREIGE     (0492's row, RENAMED since)
--     code 'dyed'  -> name DYED       (0492's row)
--     code 'WASH'  -> name WASH       (operator-added)
--     code 'PRINT' -> name PRINT      (operator-added)
--
-- A code-exact guard sees no `washed` and no `printed`, inserts both, and the
-- operator is left choosing between WASH and WASHED on the same ▾ — while the
-- routes seeded below key to whichever one this migration created. The `grey`
-- row being named GREIGE is the same lesson one step milder, and it is why
-- nothing here renames or re-codes the two existing rows: **the row's CODE is
-- not its meaning, and the operator owns both.**
--
-- So both guards below, and every stage lookup in the seed, match on MEANING —
-- code or name, case-insensitively, prefix where the operator's spelling can
-- legitimately differ (WASH / WASHED, PRINT / PRINTED). On this database they
-- insert nothing and bind to the operator's own rows. On a database seeded
-- only by 0492 they create WASHED and PRINTED as §3 asks.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The two stages §3 needs that 0492 did not seed.
--
--    NO `config_lookups_kind_check` SWAP: `fabric_stage` has been a permitted
--    kind since 0492, so the constraint is untouched here. (If it ever does
--    need widening, the idiom is to RE-STATE the whole list from the newest
--    migration that touched it — 0369 · 0372 · 0398 · 0415 · 0492 · 0504.)
-- ---------------------------------------------------------------------------
insert into public.config_lookups (kind, code, name, is_active)
select 'fabric_stage', 'washed', 'WASHED', true
where not exists (
  select 1 from public.config_lookups
  where kind = 'fabric_stage'
    and (lower(code) like 'wash%' or upper(name) like 'WASH%')
);

insert into public.config_lookups (kind, code, name, is_active)
select 'fabric_stage', 'printed', 'PRINTED', true
where not exists (
  select 1 from public.config_lookups
  where kind = 'fabric_stage'
    and (lower(code) like 'print%' or upper(name) like 'PRINT%')
);


-- ---------------------------------------------------------------------------
-- 2. The pairing table.
-- ---------------------------------------------------------------------------
create table if not exists public.process_fabric_stages (
  id         uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.processes(id) on delete cascade,
  stage_id   uuid not null references public.config_lookups(id),
  is_base    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (process_id, stage_id)
);

create index if not exists idx_process_fabric_stages_process
  on public.process_fabric_stages(process_id);

do $trg$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_process_fabric_stages_updated'
      and tgrelid = 'public.process_fabric_stages'::regclass
  ) then
    create trigger trg_process_fabric_stages_updated
      before update on public.process_fabric_stages
      for each row execute function public.set_updated_at();
  end if;
end $trg$;

comment on table public.process_fabric_stages is
  'Which fabric STAGES a process may run in, and where it is that stage''s '
  'mandatory entry step (0563, doc/order/fabriprocess.md §3). A table rather '
  'than a flag on processes because Stentering runs in two stages and '
  'Compacting in three — "which stage" has no single answer per process. Read '
  'by the Fabric BOM ▸ Fabric Process picker to refuse Stage = Dyed with '
  'Process = Knitting, which would log greige weight against the Dyed stock '
  'ledger (§1). Seeded once from the master''s own names; operator-maintained '
  'on the Process master from then on, never re-derived from the name at read '
  'time — the same rule is_print (0528) and is_dyeing (0557) state.';

comment on column public.process_fabric_stages.stage_id is
  'config_lookups kind ''fabric_stage''. The row''s CODE is not its meaning: '
  '0492 seeded code ''grey'' and an operator has since renamed it GREIGE, and '
  'added WASH and PRINT under their own codes. Anything resolving a stage by '
  'code alone will miss them — 0563''s own seed matches on code OR name, '
  'case-insensitively.';

comment on column public.process_fabric_stages.is_base is
  'This process is the stage''s MANDATORY entry step — Knitting opens Greige, '
  'Dyeing opens Dyed, Washing opens Washed, Printing opens Printed (§3). A '
  'property of the PAIRING, not of the process: a process is the base of at '
  'most one stage while being a secondary step in several. A stage may have '
  'more than one base, and may have none — with none, the "first step must be '
  'the base" restriction stands down rather than offering the operator an '
  'empty list. See lib/orders/fabric-bom/stage-routes.ts.';


-- ---------------------------------------------------------------------------
-- 3. RLS — 0227's masters shape (read open to authenticated, writes gated on
--    `masters`), because this table is maintained on the Process MASTER and
--    is read by every order. NOT 0492's `orders` shape: gating the read on
--    `orders:view` would leave the Process master unable to show its own grid.
-- ---------------------------------------------------------------------------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'process_fabric_stages'
  ) then
    create policy process_fabric_stages_read on public.process_fabric_stages
      for select to authenticated using (true);
    create policy process_fabric_stages_insert on public.process_fabric_stages
      for insert to authenticated with check (public.has_permission('masters','create'));
    create policy process_fabric_stages_update on public.process_fabric_stages
      for update to authenticated using (public.has_permission('masters','edit'))
      with check (public.has_permission('masters','edit'));
    create policy process_fabric_stages_delete on public.process_fabric_stages
      for delete to authenticated using (public.has_permission('masters','delete'));
  end if;
end $rls$;

alter table public.process_fabric_stages enable row level security;


-- ---------------------------------------------------------------------------
-- 4. The seed — §3's table, name-matched against `for_fabric` processes.
--
--    ONE STATEMENT, and the `bool_or` is what makes it one. A process can
--    match both a stage's base pattern and one of its secondary patterns
--    (DYEING matches 'dyeing' and '%dyeing%'), and two inserts guarded by
--    `on conflict do nothing` would then decide basehood by whichever ran
--    first. Aggregating instead means the BASE pattern always wins, whatever
--    order the rows come out in.
--
--    `on conflict do nothing` for the re-run case and, more importantly, for
--    the operator: a pairing they have already corrected by hand is never
--    overwritten by a later re-application of this migration.
--
--    A pattern that matches nothing contributes nothing — which is exactly
--    what happens to 'washing', 'printing', '%bio%wash%', '%dip%wash%' and
--    '%gum%cutting%' on this database today. See the header.
-- ---------------------------------------------------------------------------
with stages as (
  select distinct on (role) role, id
  from (
    -- §3's "Greige Stage". 0492's row, whichever of its two spellings the
    -- operator has settled on.
    select 'greige' as role, id, created_at from public.config_lookups
      where kind = 'fabric_stage'
        and (lower(code) in ('grey', 'greige') or upper(name) in ('GREY', 'GREIGE'))
    union all
    select 'dyed', id, created_at from public.config_lookups
      where kind = 'fabric_stage'
        and (lower(code) = 'dyed' or upper(name) = 'DYED')
    union all
    select 'washed', id, created_at from public.config_lookups
      where kind = 'fabric_stage'
        and (lower(code) like 'wash%' or upper(name) like 'WASH%')
    union all
    select 'printed', id, created_at from public.config_lookups
      where kind = 'fabric_stage'
        and (lower(code) like 'print%' or upper(name) like 'PRINT%')
  ) s
  -- Oldest row wins if a database somehow holds two rows meaning one stage
  -- (a WASH the operator added and a WASHED an earlier run of this migration
  -- created). Deterministic, and it prefers the operator's own.
  order by role, created_at
),
routes(role, name_pat, is_base) as (values
  -- Greige: everything before dyeing is greige. Dyeing is refused here (§3).
  ('greige',  'knitting',        true),
  ('greige',  '%heat%setting%',  false),
  -- Dyed: the base is DYEING exactly; the other fabric-dyeing variants
  -- (OVER DYEING, DYEING AFTER AOP) are secondary steps of the same stage.
  -- YARN DYEING is not here — it is for_yarn; see the header.
  ('dyed',    'dyeing',          true),
  ('dyed',    '%dyeing%',        false),
  ('dyed',    '%stentering%',    false),
  ('dyed',    'compacting%',     false),
  -- Washed: melange / yarn-dyed cloth that bypasses fabric dyeing.
  ('washed',  'washing',         true),
  ('washed',  '%stentering%',    false),
  ('washed',  'compacting%',     false),
  ('washed',  '%bio%wash%',      false),
  -- Printed: all-over print, after dyeing or washing.
  ('printed', 'printing',        true),
  ('printed', '%dip%wash%',      false),
  ('printed', '%gum%cutting%',   false),
  ('printed', 'compacting%',     false)
)
insert into public.process_fabric_stages (process_id, stage_id, is_base)
select p.id, s.id, bool_or(r.is_base)
from routes r
join stages s on s.role = r.role
-- `for_fabric` scoping is what keeps this table meaning "a FABRIC-stage
-- route" rather than "any process whose name contains DYE" — the same
-- scoping 0557 states for is_dyeing, and for the same reason: GARMENT DYEING
-- and TRIMS DYEING are different stages of a different document.
join public.processes p
  on p.for_fabric = true
 and p.name ilike r.name_pat
group by p.id, s.id
on conflict (process_id, stage_id) do nothing;
