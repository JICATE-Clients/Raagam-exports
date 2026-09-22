-- ============================================================================
-- 0583 — A DYED ROLL CAN BE BOUGHT, AND A ROUTE STEP CAN NAME A SUB-CATEGORY
--
-- Client review of Fabric BOM ▸ Fabric Process, 2026-09-19 (recorded
-- discussion, three fixes). This migration carries the storage half of fix 1;
-- fixes 2 and 3 (the printing requirement, the lifted 4-row cap, the print
-- checkpoints) need no schema at all.
--
-- ## 1. DYED FABRIC PURCHASE — A PROCESS OF ITS OWN, AS 0570 SAID IT MUST BE
--
-- "When a fabric stage is set to Dyed, the system must permit Direct Fabric
-- Purchase" — buying ready-dyed rolls, with no yarn bought and nothing knitted
-- or dyed in-house. The engine has known how to COST that since 0564
-- (`suppressedBySource('dyed_purchase')`), but no route could SAY it: the Dyed
-- stage's only base is DYEING, and FABRIC PURCHASE is the base of GREIGE.
--
-- 0570's own header answered the design question in advance: "A DYED-CLOTH
-- PURCHASE IS A DIFFERENT PROCESS … When one is added it must be classified to
-- DYED — do NOT answer that case by widening FABRIC PURCHASE to the Dyed stage,
-- which would hand back exactly the mis-tag this statement closes." Widening
-- would also be refused by the Process master itself: `baseStageProblem`
-- allows one base stage per process, and FABRIC PURCHASE's is GREIGE.
--
-- So: DYED FABRIC PURCHASE, `for_fabric`, the SECOND base of DYED beside
-- DYEING. `narrowToStage` already offers every base a stage has, so the Dyed
-- stage's opening step becomes "DYEING or DYED FABRIC PURCHASE" with no code.
--
-- The live route that shows the operator reaching for this is
-- `[GREIGE] KNITTING → [DYED] DYEING → [DYED] FABRIC PURCHASE`. It is NOT
-- repaired here (0570's rule: rewriting a declared route from a migration is
-- inventing production history); the screen names it and Save refuses it.
--
-- ## 2. `processes.is_cloth_purchase` — WHY A FLAG AND NOT A DERIVATION
--
-- The screen now reads a purchase step in the route as "this fabric is bought"
-- (`sourceFromRoute`, `lib/orders/fabric-bom/fabric-source.ts`), which is what
-- finally wires 0564's Rule 2 to something the operator can see — the Source
-- ▾ it hangs off has been hidden since it shipped, so every live
-- `order_fabric_bom_process_scope.source` is NULL and yarn is still bought for
-- cloth whose route says it was purchased.
--
-- That needs to know WHICH steps are purchases, and nothing existing answers
-- it. "A base that is neither knitting nor dyeing" also matches WASHING (the
-- base of WASH). A name match is what 0563 used and four of its fifteen
-- patterns bound to nothing. So it is a flag, set here and by future
-- migrations only — the same regime 0571 left `is_print` / `is_dyeing` /
-- `is_knitting` under, and for the same reason: nothing on the Process master
-- form can quietly flip it and change what a BOM buys.
--
-- ## 3. `order_fabric_bom_processes.sub_category_id`
--
-- "Sub-categories created under master processes (e.g. Dyeing [With
-- Bio-Wash]) are not showing up in the process dropdown." They could not: no
-- order screen loaded `process_sub_categories`, and a route step had nowhere
-- to hold one. Legacy screenshot 2588 shows the value as one string, "DYEING
-- [WITH BIOWASH]", which is what the picker now offers.
--
-- ON DELETE RESTRICT, and the Process master's save is changed in the same
-- commit to reconcile its sub-category rows BY ID rather than delete-and-
-- reinsert — the shortcut `lib/masters/category-actions.ts`' `syncSubCategories`
-- records as "safe only when nothing references the children". With this FK
-- something does. RESTRICT rather than SET NULL: a sub-category an operator
-- removes while a route still names it should say so, not quietly turn
-- "DYEING [WITH BIOWASH]" back into plain DYEING on a stored BOM.
-- ============================================================================


-- 1. The flag -----------------------------------------------------------------
alter table public.processes
  add column if not exists is_cloth_purchase boolean not null default false;

comment on column public.processes.is_cloth_purchase is
  'A step that BUYS the cloth rather than making it (0583). A fabric route that opens with one is bought, not knitted: greige_purchase in the Greige stage, dyed_purchase in a coloured one. Set by migration only.';

update public.processes
   set is_cloth_purchase = true
 where for_fabric = true
   and btrim(name) ilike 'fabric purchase';


-- 2. DYED FABRIC PURCHASE -----------------------------------------------------
insert into public.processes (name, for_fabric, is_cloth_purchase)
select 'DYED FABRIC PURCHASE', true, true
where not exists (
  select 1 from public.processes p where btrim(p.name) ilike 'dyed fabric purchase'
);

-- An operator-typed row of the same name binds rather than being duplicated —
-- and gets the flag, since the name is the whole of what it claims to be.
update public.processes
   set is_cloth_purchase = true,
       for_fabric = true
 where btrim(name) ilike 'dyed fabric purchase';

-- A BASE of the Dyed stage, matched by meaning exactly as 0563 / 0570 match it
-- (the live stage is code `dyed`, name DYED — the operator owns both).
with dyed as (
  select id from public.config_lookups
   where kind = 'fabric_stage'
     and (lower(code) = 'dyed' or upper(name) = 'DYED')
   order by created_at
   limit 1
)
insert into public.process_fabric_stages (process_id, stage_id, is_base)
select p.id, d.id, true
from public.processes p
cross join dyed d
where btrim(p.name) ilike 'dyed fabric purchase'
on conflict (process_id, stage_id) do update set is_base = true;


-- 3. The sub-category a route step names --------------------------------------
alter table public.order_fabric_bom_processes
  add column if not exists sub_category_id uuid
    references public.process_sub_categories(id) on delete restrict;

create index if not exists ix_ofbp_sub_category
  on public.order_fabric_bom_processes (sub_category_id)
  where sub_category_id is not null;

comment on column public.order_fabric_bom_processes.sub_category_id is
  'Which of the process''s sub-categories this step runs, e.g. DYEING [WITH BIOWASH] (0583). Must belong to process_id — checked by the save action.';
