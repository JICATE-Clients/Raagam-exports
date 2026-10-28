-- 0762 · FABRIC GAUGE + LOOP LENGTH ON THE FABRIC BOM, READ BY THE PO (user 2026-10-28)
--
-- The knitter's PO must carry the cloth's construction — GSM, Gauge (GG) and Loop
-- Length — and the user's rule is that purchasing READS them from planning and never
-- retypes them ("read-only from the Fabric BOM … prevents data drift").
--
-- GSM already lives on the order (`garment_order_amendment_combo_structures.gsm`, one
-- per colourway × structure, 0408). Gauge and Loop Length lived NOWHERE upstream —
-- the Gauge master existed (config_lookups kind 'gauge') but nothing named which gauge
-- an order's cloth is knitted on. So:
--
--   1. Fabric BOM ▸ Manual entry gains `gauge_id` and `loop_length`, beside the fabric
--      it already names. The merchandiser types them once per fabric entry. Both
--      nullable: every BOM saved before today has neither, and a NOT NULL here would
--      refuse the next save of each one.
--   2. `po_fabric_specs(source_ids)` (NULL = every order, as 0737) answers GSM / Gauge / Loop Length per Raise PO
--      line, keyed by the SAME (source_id, req_key) `po_requirement_lines` produces, so
--      the screen joins the two without re-deriving a key. SECURITY DEFINER with the
--      same gates as 0737: a Purchase Manager need not hold `orders:view`.
--   3. `po_line_items` gains `gsm`, `gauge`, `loop_length` — the PRINT'S COPY. A PO is
--      a document sent to a vendor; what it said on the day it was raised must not
--      change when the BOM is revised later. Written by the save from (2), never from
--      the browser, so the Purchase Manager still cannot type them.
--
-- ONE DISTINCT ANSWER OR NOTHING, the rule `gsmByStructureOf` already applies on the
-- Fabric BOM (lib/orders/fabric-bom/actions.ts): where two entries feeding one PO line
-- disagree on a number, the line shows nothing rather than one of them at random.
-- Gauge is a name, so two gauges are printed both ("24 GG / 28 GG").

-- ---------------------------------------------------------------------------
-- 1. The Fabric BOM ▸ Manual entry
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_manual_entries
  add column if not exists gauge_id    uuid references public.config_lookups(id),
  add column if not exists loop_length numeric(10,3);

alter table public.order_fabric_bom_manual_entries
  drop constraint if exists chk_ofbme_loop_length;
alter table public.order_fabric_bom_manual_entries
  add constraint chk_ofbme_loop_length check (loop_length is null or loop_length > 0);

comment on column public.order_fabric_bom_manual_entries.gauge_id is
  'Knitting gauge (config_lookups kind ''gauge'') this fabric is knitted on (0762). Read by the PO.';
comment on column public.order_fabric_bom_manual_entries.loop_length is
  'Loop length in mm (0762). Read by the PO.';

-- ---------------------------------------------------------------------------
-- 2. The PO line's printed copy
-- ---------------------------------------------------------------------------
alter table public.po_line_items
  add column if not exists gsm         numeric(10,2),
  add column if not exists gauge       text,
  add column if not exists loop_length numeric(10,3);

comment on column public.po_line_items.gsm is
  'Fabric GSM as the order declared it when the PO was raised (0762). Copied by the save, never typed.';
comment on column public.po_line_items.gauge is
  'Knitting gauge name(s) from the Fabric BOM when the PO was raised (0762). Copied by the save, never typed.';
comment on column public.po_line_items.loop_length is
  'Loop length (mm) from the Fabric BOM when the PO was raised (0762). Copied by the save, never typed.';

-- ---------------------------------------------------------------------------
-- 3. The specs per Raise PO fabric line
-- ---------------------------------------------------------------------------
create or replace function public.po_fabric_specs(p_source_ids uuid[] default null)
returns table (
  source_id   uuid,
  req_key     text,
  gsm         numeric,
  gauge       text,
  loop_length numeric
)
language sql
stable
security definer
set search_path = public
as $$
  -- The order's CURRENT Fabric BOM — the same rule 0760's `fab_bom` applies.
  with fab_bom as (
    select distinct on (b.garment_order_id) b.id, b.garment_order_id
    from public.order_fabric_boms b
    where not b.is_draft
      and (p_source_ids is null or b.garment_order_id = any (p_source_ids))
    order by b.garment_order_id, b.bom_date desc nulls last, b.created_at desc
  ),
  per_req as (
    select
      g.id as source_id,
      -- 0760's req_key, built from the same three parts the same way.
      upper(r.item_id::text || '|' ||
            coalesce('DIA ' || nullif(trim(ms.dia), ''), '') || '|' ||
            coalesce(nullif(trim(r.combo), ''), '')) as req_key,
      st.gsm,
      gl.name as gauge,
      e.loop_length
    from fab_bom fb
    join public.order_fabric_bom_requirements r on r.bom_id = fb.id
    join public.garment_order_amendments g on g.id = fb.garment_order_id and not g.is_draft
    left join public.order_fabric_bom_manual_entries e on e.id = r.entry_id
    left join public.config_lookups gl on gl.id = e.gauge_id
    left join lateral (
      select s.dia from public.order_fabric_bom_manual_sizes s
      where s.entry_id = r.entry_id and s.size_id is not distinct from r.size_id
      order by s.sno limit 1
    ) ms on true
    -- GSM: the order's colourway × structure, for this entry's style (NULL = any).
    left join lateral (
      select max(cs.gsm) as gsm
      from public.garment_order_amendment_combos c
      join public.garment_order_amendment_combo_structures cs on cs.combo_id = c.id
      where c.amendment_id = g.id
        and upper(trim(c.combo)) = upper(trim(r.combo))
        and cs.structure_id = e.structure_id
        and (e.style_ref_no is null or c.style_ref_no is not distinct from e.style_ref_no)
      having count(distinct cs.gsm) = 1
    ) st on true
    where r.required_qty is not null and r.required_qty > 0
      and public.has_permission('materials_purchase', 'view')
      and public.has_order_access(g.sales_order_id)
  )
  select
    source_id,
    req_key,
    case when count(distinct gsm) = 1 then max(gsm) end,
    nullif(string_agg(distinct gauge, ' / '), ''),
    case when count(distinct loop_length) = 1 then max(loop_length) end
  from per_req
  group by source_id, req_key
$$;

revoke all on function public.po_fabric_specs(uuid[]) from public, anon;
grant execute on function public.po_fabric_specs(uuid[]) to authenticated;
