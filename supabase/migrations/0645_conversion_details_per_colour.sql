-- ============================================================================
-- Raagam ERP — 0645 a CONVERSION step's per-colour Details (user 2026-09-25,
-- legacy screenshots 3093–3096: the conversion row's "Click" opens Details —
-- Description (colour) · Loss % · Loose Fabric · GSM · Dia, one row per colour).
--
-- 0633 gave a conversion step ONE loose fabric and no loss of its own. Legacy
-- answers it per colourway, so the step now carries a list:
--
--   conversion_details = [{ combo, loss_pct, source_loose_fabric_id, gsm, dia }]
--
-- A COLUMN ON THE STEP, NOT A TABLE — for 0633's own reason: a new table needs
-- its own lock trigger, amendment-scope seed + TS mirror and revert branch.
-- The step table already has all three, and `fabric_bom_revision` opens it
-- with a NULL column list (every column), so this column is locked, opened and
-- reverted with the row. Same shape as 0606's `color_losses` beside it.
--
-- NULLABLE, deliberately: a revision revert rebuilds rows from snapshots taken
-- before this column existed, and a NOT NULL here would refuse them.
--
-- The engine (`planConversions`, lib/orders/fabric-bom/loose-conversion.ts)
-- reads it; `source_loose_fabric_id` stays as the step's default fabric.
-- ============================================================================

alter table public.order_fabric_bom_yarn_stages
  add column if not exists conversion_details jsonb default '[]'::jsonb;
alter table public.iwo_fabric_bom_yarn_stages
  add column if not exists conversion_details jsonb default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_ofbys_conversion_details') then
    alter table public.order_fabric_bom_yarn_stages
      add constraint chk_ofbys_conversion_details
      check (conversion_details is null or jsonb_typeof(conversion_details) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_ifbys_conversion_details') then
    alter table public.iwo_fabric_bom_yarn_stages
      add constraint chk_ifbys_conversion_details
      check (conversion_details is null or jsonb_typeof(conversion_details) = 'array');
  end if;
end $$;

comment on column public.order_fabric_bom_yarn_stages.conversion_details is
  '0645 — CONVERSION step Details per colourway: [{combo, loss_pct, source_loose_fabric_id, gsm, dia}]. Empty on every other step.';
comment on column public.iwo_fabric_bom_yarn_stages.conversion_details is
  '0645 — see order_fabric_bom_yarn_stages.conversion_details.';
