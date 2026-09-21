-- ============================================================================
-- Raagam ERP — 0606 Fabric BOM ▸ COLOUR-WISE PROCESS LOSS on a route step
--
-- Client spec 2026-09-21 ("Color-Wise Process Loss Engine"): one flat Loss %
-- per stage is wrong across a dye lot. BLACK / NAVY run longer vat cycles and
-- lose 4–5%; WHITE / pastels lose 2–3%. A step may now say "Assort Color-Wise
-- Loss" and carry one percentage per colourway, set in a [Set Color Loss]
-- dialog opened from the row.
--
--
-- ON THE ROW, NOT IN A CHILD TABLE — AND THE SPEC ASKED FOR A CHILD TABLE
--
-- The spec sketched `fabric_process_color_loss_overrides (process_stage_id FK
-- … ON DELETE CASCADE)`. That shape cannot survive this module's save: both
-- `order_fabric_bom_processes` and `order_fabric_bom_yarn_stages` are DELETED
-- AND RE-INSERTED on every Save (`writeLines` / `writeYarns`), so every row id
-- is new each time and a child keyed to it is cascaded away by the very save
-- that meant to keep it. A column travels with its row through the re-insert
-- for free, and is read in the same select every route builder already runs.
--
-- The overrides are a map `{ "GREEN": 5, "RED": 4 }` keyed by the colourway's
-- own text — the same key `combo` uses on these rows and `stageCoversCombo`
-- matches on. Not a uuid: colourways have no table of their own here.
--
--
-- TWO COLUMNS, AND THE CHECK TIES THEM
--
-- `color_wise_loss` is the toggle, `color_losses` the map. Off ⇒ the map is
-- empty, enforced here: an override the screen no longer shows must not keep
-- changing the purchase figure — the "requiring a hidden field" trap turned
-- round, a hidden value still computing.
--
-- A colourway ABSENT from the map falls back to the step's own `loss_pct` —
-- the "Default Stage %" column of the dialog. That is what makes a colourway
-- added to the order after the losses were set degrade to the stated default
-- rather than to zero.
--
-- Each value obeys the range every loss column in this module carries:
-- 0 ≤ loss < 100, since the markup is `/(1 - loss/100)` (0427 · 0568).
--
-- No data is written: every existing row reads as toggle off, map empty, which
-- is exactly the arithmetic it had before.
-- ============================================================================

create or replace function public.fabric_bom_color_losses_valid(m jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(m) = 'object'
     and not exists (
       select 1
         from jsonb_each(m) as e(k, v)
        where btrim(e.k) = ''
           or jsonb_typeof(e.v) <> 'number'
           or (e.v)::text::numeric < 0
           or (e.v)::text::numeric >= 100
     );
$$;

comment on function public.fabric_bom_color_losses_valid(jsonb) is
  '0606 — a colour-wise loss map is an object of non-blank colourway → number, 0 ≤ n < 100.';

-- FUNCTION GRANTS (STANDING): both grants a new function is born with.
revoke all on function public.fabric_bom_color_losses_valid(jsonb) from public, anon;
grant execute on function public.fabric_bom_color_losses_valid(jsonb) to authenticated, service_role;

alter table public.order_fabric_bom_processes
  add column if not exists color_wise_loss boolean not null default false,
  add column if not exists color_losses jsonb not null default '{}'::jsonb;

alter table public.order_fabric_bom_yarn_stages
  add column if not exists color_wise_loss boolean not null default false,
  add column if not exists color_losses jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_ofbp_color_losses') then
    alter table public.order_fabric_bom_processes
      add constraint chk_ofbp_color_losses check (
        public.fabric_bom_color_losses_valid(color_losses)
        and (color_wise_loss or color_losses = '{}'::jsonb)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_ofbys_color_losses') then
    alter table public.order_fabric_bom_yarn_stages
      add constraint chk_ofbys_color_losses check (
        public.fabric_bom_color_losses_valid(color_losses)
        and (color_wise_loss or color_losses = '{}'::jsonb)
      );
  end if;
end $$;

comment on column public.order_fabric_bom_processes.color_wise_loss is
  '0606 — Assort Color-Wise Loss: this step loses a different % per colourway (color_losses).';
comment on column public.order_fabric_bom_processes.color_losses is
  '0606 — colourway → loss %. A colourway not listed uses loss_pct. Empty unless color_wise_loss.';
comment on column public.order_fabric_bom_yarn_stages.color_wise_loss is
  '0606 — Assort Color-Wise Loss on a yarn step; see order_fabric_bom_processes.color_wise_loss.';
comment on column public.order_fabric_bom_yarn_stages.color_losses is
  '0606 — colourway → loss %. A colourway not listed uses loss_pct. Empty unless color_wise_loss.';
