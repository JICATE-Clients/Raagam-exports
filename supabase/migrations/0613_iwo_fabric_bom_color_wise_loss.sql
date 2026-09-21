-- ============================================================================
-- Raagam ERP — 0613 IWO Fabric BOM ▸ COLOUR-WISE PROCESS LOSS on a step
--
-- 0606 gave the ORDER Fabric BOM a loss % per colourway on a route step and on
-- a yarn step (`color_wise_loss` + `color_losses`), and deliberately left the
-- IWO copy out: its tables had no such columns, so the IWO screens passed
-- neither `lossColours` nor `colourLoss` to the shared grids and kept the
-- older shape — a Colour ▾ naming ONE shade beside a flat Loss % box.
--
-- The client wants the IWO to work the way the Fabric BOM now does (screenshot
-- 2979, 2026-09-21: For = COLOR WISE on an IWO ▸ Yarn Process still opened a
-- shade dropdown instead of the [Color Loss] list). This is the schema half of
-- that: the same two columns, the same validator, the same CHECK, on the two
-- IWO tables that mirror 0606's pair (0581 made them column-for-column copies
-- of `order_fabric_bom_processes` / `order_fabric_bom_yarn_stages`).
--
-- WHAT THE KEYS MEAN ON AN IWO. An IWO has no colourways; a fabric line's own
-- Colour (0599) and a DYED yarn's shades (0592) are the buckets the engine
-- grosses per colour (`iwoFabricGross`, `iwoYarnModePurchase`), so the map is
-- keyed by THOSE names — the same `comboKey` the buckets are keyed by, which is
-- what lets `lossForCombo` inside `stagesForGroup` find them unchanged.
--
-- 0592's "one dyeing step per shade" is what this replaces on a Yarn-Dyeing
-- line: one dyeing step covers every shade and carries each shade's own loss.
-- The rule in `lib/orders/iwo-fabric-bom/lines.ts` is rewritten to match; a
-- stored step still scoped to one shade (`combo`) keeps working — the CHECK
-- below only ties the map to the toggle, exactly as 0606 does.
--
-- No data is written: every existing row reads as toggle off, map empty, which
-- is exactly the arithmetic it had before. `fabric_bom_color_losses_valid`
-- is 0606's function, reused — one definition of a valid map.
-- ============================================================================

alter table public.iwo_fabric_bom_processes
  add column if not exists color_wise_loss boolean not null default false,
  add column if not exists color_losses jsonb not null default '{}'::jsonb;

alter table public.iwo_fabric_bom_yarn_stages
  add column if not exists color_wise_loss boolean not null default false,
  add column if not exists color_losses jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_ifbp_color_losses') then
    alter table public.iwo_fabric_bom_processes
      add constraint chk_ifbp_color_losses check (
        public.fabric_bom_color_losses_valid(color_losses)
        and (color_wise_loss or color_losses = '{}'::jsonb)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_ifbys_color_losses') then
    alter table public.iwo_fabric_bom_yarn_stages
      add constraint chk_ifbys_color_losses check (
        public.fabric_bom_color_losses_valid(color_losses)
        and (color_wise_loss or color_losses = '{}'::jsonb)
      );
  end if;
end $$;

comment on column public.iwo_fabric_bom_processes.color_wise_loss is
  '0613 — For = COLOR WISE: this step loses a different % per line Colour (color_losses). Mirrors 0606.';
comment on column public.iwo_fabric_bom_processes.color_losses is
  '0613 — line Colour → loss %. A colour not listed uses loss_pct. Empty unless color_wise_loss.';
comment on column public.iwo_fabric_bom_yarn_stages.color_wise_loss is
  '0613 — For = COLOR WISE on a yarn step: a loss % per shade (color_losses). Mirrors 0606.';
comment on column public.iwo_fabric_bom_yarn_stages.color_losses is
  '0613 — shade (or line Colour) → loss %. A colour not listed uses loss_pct. Empty unless color_wise_loss.';
