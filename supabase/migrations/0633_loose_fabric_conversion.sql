-- 0633 — LOOSE FABRIC CONVERSION (unravelling), Fabric BOM ▸ Yarn Process.
--
-- Spec: "Developer Technical Specification: Loose Fabric Conversion Workflow"
-- (user, 2026-09-25). To get a collar / cuff / stripe yarn in EXACTLY the body's
-- shade, greige yarn is knitted into a temporary "loose fabric", dyed in the SAME
-- vessel as the body cloth, then unravelled back into dyed yarn cones, which
-- knit the yarn-dyed panels.
--
-- ## WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
--
--  1. `processes.is_unravelling` — a SYSTEM kind flag, like `is_knitting` /
--     `is_dyeing` / `is_print` (0571): seeded here, not on the Process master
--     form, read by the Fabric BOM only.
--
--     NOT `is_conversion`, WHICH THE SPEC NAMES. That column already exists and
--     means something else: "Use Conversion Process", a process run as vendor
--     CONVERSION JOB WORK (it is TRUE on YARN DYEING today). Re-using it would
--     turn every yarn-dyeing job into an unravelling step. One word, two facts
--     is the failure this repo keeps recording, so the new fact gets its own
--     column.
--
--  2. The process itself, `CONVERSION (UNRAVELLING)`, for yarn AND fabric: it
--     is the step on the yarn's route that says "this yarn comes from a loose
--     fabric", and the last step of that loose fabric's own route. Classified
--     as a BASE of the DYED stage (`process_fabric_stages`), because on the
--     yarn side it is a second way INTO dyed yarn beside YARN DYEING — without
--     that, `yarnBaseMissing` would demand YARN DYEING above it. On the fabric
--     side the screen and the save withhold it from every route except a
--     linked loose fabric's (`looseFabricRoute` gate, stage-routes.ts).
--
--  3. `order_fabric_bom_yarn_stages.source_loose_fabric_id` — the link. The
--     spec's `order_yarn_processes` IS this table; its `order_fabric_bom_items`
--     FK target does not exist here — a fabric is an `items` row.
--
--  4. NO `order_loose_fabric_conversions` TABLE. The spec's audit table would
--     be a fourth copy of figures three existing places already hold:
--       - converted yarn weight  → this stage row's `process_qty` (derived)
--       - unravelling loss       → the loose fabric's CONVERSION route step
--       - the greige yarn to buy → the yarn row's `purchase_qty`, CONSOLIDATED
--                                  with the body cloth's own demand for it
--     and a new derived table would also have to join the order-lock triggers
--     (0576), the amendment scope seed + its TS mirror (0604/0619,
--     `check:amendment-scope`) and the revision revert (0619/0626) to stay
--     correct. The existing columns are already inside all four.
--
-- The arithmetic is `lib/orders/fabric-bom/loose-conversion.ts`.

alter table public.processes
  add column if not exists is_unravelling boolean not null default false;

comment on column public.processes.is_unravelling is
  '0633: LOOSE FABRIC CONVERSION — unravelling a dyed loose fabric back into '
  'dyed yarn. System kind flag (seeded, not on the form). NOT is_conversion, '
  'which is "run as conversion job work".';

insert into public.processes (name, for_yarn, for_fabric, is_unravelling)
select 'CONVERSION (UNRAVELLING)', true, true, true
where not exists (select 1 from public.processes where is_unravelling)
  and not exists (select 1 from public.processes where upper(trim(name)) = 'CONVERSION (UNRAVELLING)');

-- An operator-created row of the same name gets the flag instead of a twin.
update public.processes
   set is_unravelling = true, for_yarn = true, for_fabric = true
 where upper(trim(name)) = 'CONVERSION (UNRAVELLING)'
   and not is_unravelling;

insert into public.process_fabric_stages (process_id, stage_id, is_base)
select p.id, s.id, true
  from public.processes p
  join public.config_lookups s
    on s.kind = 'fabric_stage'
   and (lower(s.code) = 'dyed' or upper(s.name) = 'DYED')
 where p.is_unravelling
   and not exists (select 1 from public.process_fabric_stages x where x.process_id = p.id and x.stage_id = s.id)
   and not exists (select 1 from public.process_fabric_stages x where x.process_id = p.id and x.is_base);

alter table public.order_fabric_bom_yarn_stages
  add column if not exists source_loose_fabric_id uuid references public.items(id);

comment on column public.order_fabric_bom_yarn_stages.source_loose_fabric_id is
  '0633: on a CONVERSION (UNRAVELLING) step — the loose fabric (an items row of '
  'class FABRIC) knitted from greige yarn, dyed with the body, and unravelled '
  'into this yarn. NULL on every other step.';

create index if not exists idx_ofbys_source_loose_fabric
  on public.order_fabric_bom_yarn_stages (source_loose_fabric_id)
  where source_loose_fabric_id is not null;

do $$
begin
  if not exists (select 1 from public.processes where is_unravelling and for_yarn and for_fabric) then
    raise exception '0633: CONVERSION (UNRAVELLING) not seeded';
  end if;
  if not exists (
    select 1 from public.process_fabric_stages x
      join public.processes p on p.id = x.process_id
     where p.is_unravelling and x.is_base
  ) then
    raise exception '0633: CONVERSION (UNRAVELLING) is not classified to the DYED stage';
  end if;
end $$;
