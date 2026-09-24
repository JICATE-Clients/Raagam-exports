-- 0627 — A PICKED MODULE OPENS WHOLE (client 2026-09-24)
--
-- "Merchandisers can simply click back into any chosen module, Order Entry
-- section, Material BOM, or Fabric BOM line to edit and re-save freely."
--
-- Until now Order Entry was opened BY KIND: ticking "PO Qty" opened the
-- quantity grids and two header columns and nothing else, "Delivery Date"
-- opened one column, and Styles / Pack Types were closed to every kind (0604).
-- So a merchandiser inside a revision found most of the order they had chosen
-- to revise still read-only — and a Quantity Addition could not even balance,
-- because Style PO Qty sits on the closed styles table.
--
-- The rule now: the MODULE is the lock boundary, not the kind.
--
--   * An entry whose frozen scope names ANY Order Entry table opens the WHOLE
--     order document — every header column, every child grid for insert and
--     delete. The kinds stay on the entry as what the MD is told changed.
--   * An entry that picked the Fabric BOM also opens the order's colour and
--     print tables, which the Fabric BOM's Colour/Print tab writes.
--   * An UNPICKED module is unchanged: still read-only (derived BOM rows still
--     recalculate). An approved order with no open revision is unchanged:
--     still locked whole.
--
-- READ-TIME, LIKE 0622's FILES OVERLAY, NOT A RE-SEED. The scope is frozen on
-- each entry at raise; re-seeding `order_amendment_scopes` would reach only
-- entries raised from now on and leave today's open ones narrow. Laying the
-- widening over the stored scope inside `order_amendment_of` reaches every
-- open entry at once, and the stored scope stays an honest record of what was
-- asked. The seed is untouched, so `check:amendment-scope`'s seed parity holds.
--
-- Mirrored in TS by `scopeFromJson` (ORDER_ENTRY_WHOLE / FABRIC_BOM_PALETTE in
-- lib/orders/amendments/amendment-entry.ts); check:amendment-scope holds the
-- two literals together.

create or replace function public.order_amendment_order_entry_whole()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"garment_order_amendments": {"columns": null, "insert": false, "delete": false}, "garment_order_amendment_approval_qtys": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_assort_line_sizes": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_assort_lines": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_charges": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_combo_components": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_combo_structures": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_combos": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_country_sizes": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_dyeings": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_files": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_pack_components": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_pack_type_lines": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_pack_types": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_price_details": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_prints": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_quantities": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_structures": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_style_components": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_style_coordinates": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_style_prices": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_style_processes": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_style_sizes": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_styles": {"columns": null, "insert": true, "delete": true}}'::jsonb;
$$;

comment on function public.order_amendment_order_entry_whole() is
  'The whole Order Entry document, opened under any entry whose frozen scope names an Order Entry table (0627). Mirrored by ORDER_ENTRY_WHOLE in lib/orders/amendments/amendment-entry.ts.';

create or replace function public.order_amendment_fabric_bom_palette()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"garment_order_amendment_dyeings": {"columns": null, "insert": true, "delete": true}, "garment_order_amendment_prints": {"columns": null, "insert": true, "delete": true}}'::jsonb;
$$;

comment on function public.order_amendment_fabric_bom_palette() is
  'The order''s colour / print tables, opened under any entry that picked the Fabric BOM — its Colour/Print tab writes them (0627). Mirrored by FABRIC_BOM_PALETTE in lib/orders/amendments/amendment-entry.ts.';

revoke all on function public.order_amendment_order_entry_whole() from public, anon;
revoke all on function public.order_amendment_fabric_bom_palette() from public, anon;
grant execute on function public.order_amendment_order_entry_whole() to authenticated, service_role;
grant execute on function public.order_amendment_fabric_bom_palette() to authenticated, service_role;

/* THE READ, WIDENED. Same signature and the same row choice as 0622; only the
   scope expression changes. Order of the overlays: the stored scope, then the
   module widenings (tested against the STORED scope, so the files overlay can
   never be what makes an entry "touch Order Entry"), then 0622's always-open
   files on the right, winning as before. A picked Fabric BOM is one whose
   parent row is open WHOLE (`columns` null) — BOM_DERIVED_SCOPE names it with
   a column list, so a quantity kind's recalculation rows never qualify. */
create or replace function public.order_amendment_of(p_order uuid, p_sales_order uuid default null)
returns table (
  amending_order_id uuid,
  entry_id          uuid,
  entry_no          text,
  amendment_type    text,
  amendment_types   text[],
  scope             jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select coalesce(
      p_sales_order,
      (select a.sales_order_id from public.garment_order_amendments a where a.id = p_order)
    ) as so
  )
  select a.id, r.id, r.entry_no, r.amendment_type, r.amendment_types,
         coalesce(r.scope, '{}'::jsonb)
         || case when exists (select 1 from jsonb_object_keys(coalesce(r.scope, '{}'::jsonb)) k
                               where k like 'garment\_order\_amendment%')
                 then public.order_amendment_order_entry_whole() else '{}'::jsonb end
         || case when r.scope ? 'order_fabric_boms'
                  and jsonb_typeof(r.scope -> 'order_fabric_boms' -> 'columns') = 'null'
                 then public.order_amendment_fabric_bom_palette() else '{}'::jsonb end
         || public.order_amendment_always_open()
    from public.garment_order_amendments a
    cross join me
    join public.order_budget_revisions r on r.id = a.re_amendment_id
   where a.re_status = 'amending'
     and (a.id = p_order or (me.so is not null and a.sales_order_id = me.so))
   order by (a.id = p_order) desc
   limit 1;
$$;

revoke all on function public.order_amendment_of(uuid, uuid) from public, anon;
grant execute on function public.order_amendment_of(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verify — against the catalog and the live open entries, never by reading
-- this file (AGENTS.md "Function grants").
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_missing text;
begin
  if exists (select 1 from pg_proc
              where oid in ('public.order_amendment_order_entry_whole()'::regprocedure,
                            'public.order_amendment_fabric_bom_palette()'::regprocedure,
                            'public.order_amendment_of(uuid,uuid)'::regprocedure)
                and (proacl is null or proacl::text like '%anon=%' or proacl::text ~ '(^|[{,])=X/')) then
    raise exception '0627: a scope function is executable by anon or PUBLIC';
  end if;

  /* The literal names every Order Entry table the lock guards — a table 0576
     locks and this list forgets would stay closed inside a picked module. */
  select string_agg(distinct c.relname, ', ') into v_missing
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where t.tgname = 'trg_order_lock'
     and c.relname like 'garment\_order\_amendment%'
     and not (public.order_amendment_order_entry_whole() ? c.relname);
  if v_missing is not null then
    raise exception '0627: locked Order Entry tables missing from order_amendment_order_entry_whole(): %', v_missing;
  end if;

  /* Every open entry that touches Order Entry now reads it whole … */
  if exists (select 1 from public.garment_order_amendments a
              join public.order_budget_revisions r on r.id = a.re_amendment_id
              cross join lateral public.order_amendment_of(a.id, null) m
             where a.re_status = 'amending'
               and exists (select 1 from jsonb_object_keys(coalesce(r.scope, '{}'::jsonb)) k
                            where k like 'garment\_order\_amendment%' and k <> 'garment_order_amendment_files')
               and (m.scope -> 'garment_order_amendment_styles') is distinct from
                   '{"columns": null, "insert": true, "delete": true}'::jsonb) then
    raise exception '0627: an open Order Entry revision does not read the styles table whole';
  end if;

  /* … and one that does NOT touch it is not widened by this (a BOM-only or
     budget-only entry keeps the order read-only, bar 0622's files). */
  if exists (select 1 from public.garment_order_amendments a
              join public.order_budget_revisions r on r.id = a.re_amendment_id
              cross join lateral public.order_amendment_of(a.id, null) m
             where a.re_status = 'amending'
               and not exists (select 1 from jsonb_object_keys(coalesce(r.scope, '{}'::jsonb)) k
                                where k like 'garment\_order\_amendment%')
               and m.scope ? 'garment_order_amendment_pack_types') then
    raise exception '0627: a revision that did not pick Order Entry was widened to it';
  end if;

  raise notice '0627 verified: a picked Order Entry opens whole, a picked Fabric BOM opens the palette, unpicked modules unchanged';
end $verify$;
