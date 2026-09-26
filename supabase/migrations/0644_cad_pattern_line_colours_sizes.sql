-- ============================================================================
-- Raagam ERP — 0644 a Pattern Sheet line holds SEVERAL colours and sizes
-- (user 2026-09-25: "Colour Size this is missing multi select").
--
-- The same step 0643 took for TYPE of PARTS: a line that measures the same for
-- WHITE and NAVY, or for XS, S and M, is one line — not one per colour × size
-- that differ in nothing the pattern room measured. Each list is its own table
-- (sizes FK'd to config_lookups, as the line's column is); the line's own
-- `colour` / `size_id` stay as the FIRST value, so every 0640/0643 reader and
-- payload keeps working. Every existing line is backfilled.
--
-- The frozen-at-dispatch guard is 0643's `cad_pattern_part_guard`, which reads
-- only `line_id` and so serves all three child tables.
-- ============================================================================

create table if not exists public.order_cad_pattern_line_colours (
  id       uuid primary key default gen_random_uuid(),
  line_id  uuid not null references public.order_cad_pattern_lines(id) on delete cascade,
  sno      int  not null default 0,
  colour   text not null check (btrim(colour) <> '')
);
create index if not exists ix_ocplc_line on public.order_cad_pattern_line_colours (line_id);
create unique index if not exists uq_ocplc_line_colour
  on public.order_cad_pattern_line_colours (line_id, upper(btrim(colour)));

create table if not exists public.order_cad_pattern_line_sizes (
  id       uuid primary key default gen_random_uuid(),
  line_id  uuid not null references public.order_cad_pattern_lines(id) on delete cascade,
  sno      int  not null default 0,
  size_id  uuid not null references public.config_lookups(id)
);
create index if not exists ix_ocpls_line on public.order_cad_pattern_line_sizes (line_id);
create unique index if not exists uq_ocpls_line_size
  on public.order_cad_pattern_line_sizes (line_id, size_id);

comment on table public.order_cad_pattern_line_colours is
  '0644 — the COLOURs of one Pattern Sheet line. The line''s colour is the first.';
comment on table public.order_cad_pattern_line_sizes is
  '0644 — the SIZEs of one Pattern Sheet line. The line''s size_id is the first.';

insert into public.order_cad_pattern_line_colours (line_id, sno, colour)
select l.id, 1, l.colour from public.order_cad_pattern_lines l
 where nullif(btrim(coalesce(l.colour, '')), '') is not null
   and not exists (select 1 from public.order_cad_pattern_line_colours c where c.line_id = l.id);
insert into public.order_cad_pattern_line_sizes (line_id, sno, size_id)
select l.id, 1, l.size_id from public.order_cad_pattern_lines l
 where l.size_id is not null
   and not exists (select 1 from public.order_cad_pattern_line_sizes z where z.line_id = l.id);

drop trigger if exists trg_ocplc_guard on public.order_cad_pattern_line_colours;
create trigger trg_ocplc_guard
  before insert or update or delete on public.order_cad_pattern_line_colours
  for each row execute function public.cad_pattern_part_guard();
drop trigger if exists trg_ocpls_guard on public.order_cad_pattern_line_sizes;
create trigger trg_ocpls_guard
  before insert or update or delete on public.order_cad_pattern_line_sizes
  for each row execute function public.cad_pattern_part_guard();

alter table public.order_cad_pattern_line_colours enable row level security;
drop policy if exists ocplc_read on public.order_cad_pattern_line_colours;
create policy ocplc_read on public.order_cad_pattern_line_colours for select to authenticated
  using (public.has_permission('orders', 'view'));
revoke all on public.order_cad_pattern_line_colours from anon;
revoke insert, update, delete on public.order_cad_pattern_line_colours from authenticated;
grant select on public.order_cad_pattern_line_colours to authenticated;

alter table public.order_cad_pattern_line_sizes enable row level security;
drop policy if exists ocpls_read on public.order_cad_pattern_line_sizes;
create policy ocpls_read on public.order_cad_pattern_line_sizes for select to authenticated
  using (public.has_permission('orders', 'view'));
revoke all on public.order_cad_pattern_line_sizes from anon;
revoke insert, update, delete on public.order_cad_pattern_line_sizes from authenticated;
grant select on public.order_cad_pattern_line_sizes to authenticated;

-- THE ONE WRITE, now with `colours` and `size_ids` lists beside 0643's
-- `parts`. A line without them falls back to its own `colour` / `size_id`.
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
  v_i       int := 0;
  v_j       int;
  v_line    uuid;
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
      when jsonb_typeof(v_l -> 'size_ids') = 'array' then v_l -> 'size_ids'
      when nullif(v_l ->> 'size_id', '') is not null then jsonb_build_array(v_l ->> 'size_id')
      else '[]'::jsonb
    end;
    if jsonb_array_length(v_parts) = 0 or nullif(v_parts -> 0 ->> 'component_id', '') is null then
      raise exception using errcode = 'P0001', message = format('Line %s: choose the Type of Parts.', v_i);
    end if;
    insert into public.order_cad_pattern_lines
      (allocation_id, sno, coordinate_id, component_id, fabric_category_id, gsm, colour, size_id,
       table_dia, width_form, avg_pcs_weight_g, remark)
    values
      (p_allocation, v_i,
       nullif(v_parts -> 0 ->> 'coordinate_id', '')::uuid,
       (v_parts -> 0 ->> 'component_id')::uuid,
       nullif(v_l ->> 'fabric_category_id', '')::uuid,
       nullif(v_l ->> 'gsm', '')::numeric,
       nullif(btrim(coalesce(v_colours ->> 0, '')), ''),
       nullif(v_sizes ->> 0, '')::uuid,
       nullif(v_l ->> 'table_dia', '')::numeric,
       nullif(v_l ->> 'width_form', ''),
       nullif(v_l ->> 'avg_pcs_weight_g', '')::numeric,
       nullif(btrim(coalesce(v_l ->> 'remark', '')), ''))
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
      continue when nullif(v_p #>> '{}', '') is null;
      v_j := v_j + 1;
      insert into public.order_cad_pattern_line_sizes (line_id, sno, size_id)
      values (v_line, v_j, (v_p #>> '{}')::uuid)
      on conflict do nothing;
    end loop;
  end loop;
end $$;
revoke all on function public.cad_save_pattern_sheet(uuid, text, date, jsonb) from public, anon;
grant execute on function public.cad_save_pattern_sheet(uuid, text, date, jsonb) to authenticated;

-- VERIFY (run by hand)
--   select (select count(*) from public.order_cad_pattern_lines where colour is not null),
--          (select count(*) from public.order_cad_pattern_line_colours),
--          (select count(*) from public.order_cad_pattern_lines where size_id is not null),
--          (select count(*) from public.order_cad_pattern_line_sizes);          -- pairs equal
