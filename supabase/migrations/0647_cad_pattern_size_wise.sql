-- ============================================================================
-- Raagam ERP — 0647 a Pattern Sheet line answers PER SIZE, like Fabric BOM ▸
-- Manual (user 2026-09-26: rebuild the Pattern Sheet as the Manual tab's
-- layout, and carry its figures into Manual — "GSM · Type of Parts · Colour ·
-- Size · Table Dia · Tubular / Open Width · Avg CAD Pcs Wt (g) — this details
-- only").
--
-- Manual holds a Dia and a gram weight PER SIZE behind a "Size Wise" toggle:
-- off = one answer for every size, on = each size its own. 0640/0644 gave a
-- pattern line ONE dia and ONE weight over a set of sizes, so an S at 180 g and
-- an XL at 210 g had to be two lines. Now the line carries the same toggle:
--
--   size_wise = false   the line's own table_dia / avg_pcs_weight_g answer
--                       every size of the style; no size rows are stored.
--   size_wise = true    each order_cad_pattern_line_sizes row carries its own
--                       table_dia / avg_pcs_weight_g.
--
-- BACKFILL KEEPS WHAT EXISTING LINES MEANT. A line saved with a set of sizes
-- said "these sizes measure this", so it becomes size_wise with the line's
-- figures copied onto each of those sizes. A line with no sizes keeps meaning
-- "every size" as size_wise = false. No saved line has been dispatched, so the
-- freeze triggers (0640 / 0643 / 0644) do not refuse the backfill.
-- ============================================================================

alter table public.order_cad_pattern_lines
  add column if not exists size_wise boolean not null default false;
comment on column public.order_cad_pattern_lines.size_wise is
  '0647 — false: table_dia / avg_pcs_weight_g answer every size; true: each line_sizes row carries its own.';

alter table public.order_cad_pattern_line_sizes
  add column if not exists table_dia        numeric(10,2) check (table_dia is null or table_dia > 0),
  add column if not exists avg_pcs_weight_g numeric(10,3) check (avg_pcs_weight_g is null or avg_pcs_weight_g > 0);

update public.order_cad_pattern_line_sizes z
   set table_dia = l.table_dia, avg_pcs_weight_g = l.avg_pcs_weight_g
  from public.order_cad_pattern_lines l
 where z.line_id = l.id and z.table_dia is null and z.avg_pcs_weight_g is null;

update public.order_cad_pattern_lines l
   set size_wise = true
 where exists (select 1 from public.order_cad_pattern_line_sizes z where z.line_id = l.id);

-- ---------------------------------------------------------------------------
-- The save, re-cut for the per-size figures. `sizes` is now an array of
-- { size_id, table_dia, avg_pcs_weight_g }; a bare uuid string (0644's
-- `size_ids`, a stale tab) is still read as a size with no figures of its own.
-- ---------------------------------------------------------------------------
create or replace function public.cad_save_pattern_sheet(
  p_allocation  uuid,
  p_status      text,
  p_date        date,
  p_lines       jsonb
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l       jsonb;
  v_parts   jsonb;
  v_colours jsonb;
  v_sizes   jsonb;
  v_p       jsonb;
  v_size    uuid;
  v_i       int := 0;
  v_j       int;
  v_line    uuid;
  v_wise    boolean;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using errcode = '42501', message = 'You do not have permission to update the pattern sheet.';
  end if;
  if not exists (select 1 from public.order_cad_allocations where id = p_allocation) then
    raise exception using errcode = 'P0001', message = 'That CAD assignment no longer exists.';
  end if;
  if p_date is not null and p_date > public.work_flow_today() then
    raise exception using errcode = 'P0001', message = 'The pattern sheet Date cannot be in the future.';
  end if;

  update public.order_cad_allocations
     set pattern_status = p_status, pattern_date = p_date
   where id = p_allocation;

  delete from public.order_cad_pattern_lines where allocation_id = p_allocation;
  for v_l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_parts := case
      when jsonb_typeof(v_l -> 'parts') = 'array' and jsonb_array_length(v_l -> 'parts') > 0 then v_l -> 'parts'
      when nullif(v_l ->> 'component_id', '') is not null then
        jsonb_build_array(jsonb_build_object('coordinate_id', v_l -> 'coordinate_id', 'component_id', v_l -> 'component_id'))
      else '[]'::jsonb
    end;
    v_colours := case
      when jsonb_typeof(v_l -> 'colours') = 'array' then v_l -> 'colours'
      when nullif(btrim(coalesce(v_l ->> 'colour', '')), '') is not null then jsonb_build_array(v_l ->> 'colour')
      else '[]'::jsonb
    end;
    v_sizes := case
      when jsonb_typeof(v_l -> 'sizes') = 'array' then v_l -> 'sizes'
      when jsonb_typeof(v_l -> 'size_ids') = 'array' then v_l -> 'size_ids'
      when nullif(v_l ->> 'size_id', '') is not null then jsonb_build_array(v_l ->> 'size_id')
      else '[]'::jsonb
    end;
    v_wise := coalesce((v_l ->> 'size_wise')::boolean, false);
    if jsonb_array_length(v_parts) = 0 or nullif(v_parts -> 0 ->> 'component_id', '') is null then
      raise exception using errcode = 'P0001', message = format('Line %s: choose the Type of Parts.', v_i);
    end if;
    insert into public.order_cad_pattern_lines
      (allocation_id, sno, coordinate_id, component_id, fabric_category_id, gsm, colour, size_id,
       table_dia, width_form, avg_pcs_weight_g, remark, size_wise)
    values
      (p_allocation, v_i,
       nullif(v_parts -> 0 ->> 'coordinate_id', '')::uuid,
       (v_parts -> 0 ->> 'component_id')::uuid,
       nullif(v_l ->> 'fabric_category_id', '')::uuid,
       nullif(v_l ->> 'gsm', '')::numeric,
       nullif(btrim(coalesce(v_colours ->> 0, '')), ''),
       case when jsonb_typeof(v_sizes -> 0) = 'object'
            then nullif(v_sizes -> 0 ->> 'size_id', '')::uuid
            else nullif(v_sizes ->> 0, '')::uuid end,
       nullif(v_l ->> 'table_dia', '')::numeric,
       nullif(v_l ->> 'width_form', ''),
       nullif(v_l ->> 'avg_pcs_weight_g', '')::numeric,
       nullif(btrim(coalesce(v_l ->> 'remark', '')), ''),
       v_wise)
    returning id into v_line;

    v_j := 0;
    for v_p in select * from jsonb_array_elements(v_parts) loop
      v_j := v_j + 1;
      if nullif(v_p ->> 'component_id', '') is null then
        raise exception using errcode = 'P0001', message = format('Line %s: choose the Type of Parts.', v_i);
      end if;
      insert into public.order_cad_pattern_line_parts (line_id, sno, coordinate_id, component_id)
      values (v_line, v_j, nullif(v_p ->> 'coordinate_id', '')::uuid, (v_p ->> 'component_id')::uuid)
      on conflict do nothing;
    end loop;

    v_j := 0;
    for v_p in select * from jsonb_array_elements(v_colours) loop
      continue when nullif(btrim(coalesce(v_p #>> '{}', '')), '') is null;
      v_j := v_j + 1;
      insert into public.order_cad_pattern_line_colours (line_id, sno, colour)
      values (v_line, v_j, upper(btrim(v_p #>> '{}')))
      on conflict do nothing;
    end loop;

    v_j := 0;
    for v_p in select * from jsonb_array_elements(v_sizes) loop
      v_size := case when jsonb_typeof(v_p) = 'object'
                     then nullif(v_p ->> 'size_id', '')::uuid
                     else nullif(v_p #>> '{}', '')::uuid end;
      continue when v_size is null;
      v_j := v_j + 1;
      insert into public.order_cad_pattern_line_sizes (line_id, sno, size_id, table_dia, avg_pcs_weight_g)
      values (v_line, v_j, v_size,
              case when jsonb_typeof(v_p) = 'object' then nullif(v_p ->> 'table_dia', '')::numeric end,
              case when jsonb_typeof(v_p) = 'object' then nullif(v_p ->> 'avg_pcs_weight_g', '')::numeric end)
      on conflict do nothing;
    end loop;
  end loop;
end $$;
revoke all on function public.cad_save_pattern_sheet(uuid, text, date, jsonb) from public, anon;
grant execute on function public.cad_save_pattern_sheet(uuid, text, date, jsonb) to authenticated;

-- VERIFY (run by hand)
--   select l.size_wise, count(z.*) filter (where z.avg_pcs_weight_g is not null)
--     from public.order_cad_pattern_lines l
--     left join public.order_cad_pattern_line_sizes z on z.line_id = l.id
--    group by l.id, l.size_wise;          -- every size_wise line has its figures
