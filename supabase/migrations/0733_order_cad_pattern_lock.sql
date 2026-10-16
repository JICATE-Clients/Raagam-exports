-- ============================================================================
-- 0733 · CAD Pattern Lock — a per-order switch (user 2026-10-16)
-- ============================================================================
-- Since 2026-10-15 (Option A, `lib/orders/fabric-bom/pattern-components.ts`)
-- the CAD Pattern Sheet governs Fabric BOM: Components rows it covers have a
-- read-only Roll Form / Finish Dia, and Manual takes the sheet's dia and
-- weights automatically every time the BOM is opened. That was decided in
-- code with no way out. The user asked for the control on screen: Order
-- Entry ▸ CAD carries a Lock / Unlock switch, and Fabric BOM reads it.
--
--   locked   (default) — exactly the 10-15 behaviour.
--   unlocked           — the sheet is ignored by Fabric BOM: nothing is
--                        locked, nothing is filled or added from it.
--
-- NO ROW = LOCKED, so every existing order keeps today's behaviour and the
-- switch only ever writes a row when someone flips it.
--
-- ITS OWN TABLE, NOT A COLUMN ON garment_order_amendments: CAD is outside the
-- order lock (0576 / 0628), and a header column would be refused on an
-- approved order by `refuse_when_order_locked` — the CAD tab works there.
-- Location scope follows the order (lv_garment_order_amendments, 0680 rule).
-- ============================================================================

create table if not exists public.order_cad_settings (
  garment_order_id uuid primary key references public.garment_order_amendments(id) on delete cascade,
  pattern_lock     boolean not null default true,
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now()
);

comment on table public.order_cad_settings is
  '0733 — per-order CAD switches. pattern_lock: does the Pattern Sheet lock/fill Fabric BOM (no row = true).';

alter table public.order_cad_settings enable row level security;

drop policy if exists ocs_read on public.order_cad_settings;
create policy ocs_read on public.order_cad_settings for select to authenticated
  using (public.has_permission('orders', 'view') and public.lv_garment_order_amendments(garment_order_id));

drop policy if exists ocs_insert on public.order_cad_settings;
create policy ocs_insert on public.order_cad_settings for insert to authenticated
  with check (public.has_permission('orders', 'edit') and public.lv_garment_order_amendments(garment_order_id));

drop policy if exists ocs_update on public.order_cad_settings;
create policy ocs_update on public.order_cad_settings for update to authenticated
  using (public.has_permission('orders', 'edit') and public.lv_garment_order_amendments(garment_order_id))
  with check (public.has_permission('orders', 'edit') and public.lv_garment_order_amendments(garment_order_id));

revoke all on public.order_cad_settings from anon;
grant select, insert, update on public.order_cad_settings to authenticated;
