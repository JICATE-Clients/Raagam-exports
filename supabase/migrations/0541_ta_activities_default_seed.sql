-- ============================================================================
-- Raagam ERP — 0541 A NEW order's T&A ladder seeds the client's named chain
--
-- Client, 2026-09-07: "Inspection, Packing, Ironing, Checking, Sewing,
-- Cutting, PP Approval, PP Send, Material Inhouse — default. If I open that
-- T&A tab it should list [these] by default." Confirmed against a screenshot
-- of a brand-new order's T&A tab seeding every ACTIVE `ta_activities` row —
-- Fabric Plan, Accessories BOM, Yarn Purchase, Knitting, Dyeing, Shipment
-- included, none of which are in the client's named chain.
--
-- `seedTaLadder()` (`garment-order-screen.tsx`) filters `!isInactive(a)` and
-- nothing narrower, because until now there was no narrower thing to filter
-- ON — every active row was fair game for a default ladder. This column is
-- that narrower thing: which rows a BLANK order starts with, as its own flag
-- on the master rather than a hardcoded name list in application code (the
-- same reasoning `is_active`/`inactive` already use everywhere in this app —
-- AGENTS.md, "Disabled rows").
--
-- EVERY OTHER ACTIVE ROW STAYS REACHABLE. `default_seed = false` narrows what
-- a NEW order starts with, never what an operator can add — Fabric Plan,
-- Accessories BOM, Yarn Purchase, Knitting, Dyeing and Shipment are still
-- full rows in the "+ Add activity" picker and on any order that already
-- saved one.
-- ============================================================================

alter table public.ta_activities
  add column if not exists default_seed boolean not null default false;

comment on column public.ta_activities.default_seed is
  'Seeded automatically onto a brand-new order''s T&A ladder (0541, client-named 9-step chain). Every other active row is still reachable via "+ Add activity" — this only narrows what a blank order starts with, never the master itself.';

update public.ta_activities
   set default_seed = true
 where short_name in ('INSP', 'PACK', 'IRON', 'CHECK', 'SEW', 'CUT', 'PPAPPR', 'PPSEND', 'MATIH');


-- ---------- assertions ------------------------------------------------------

do $assert$
declare
  v_count int;
begin
  select count(*) into v_count from public.ta_activities where default_seed;
  if v_count <> 9 then
    raise exception '0541: expected exactly 9 default-seed activities, found %', v_count;
  end if;

  if exists (
    select 1 from public.ta_activities
     where short_name in ('FABPLAN', 'ACCBOM', 'YRNPUR', 'KNIT', 'DYE', 'SHIP')
       and default_seed
  ) then
    raise exception '0541: an activity outside the client''s named chain was marked default_seed';
  end if;
end $assert$;
