-- ============================================================================
-- Raagam ERP — 0643 a Pattern Sheet line holds SEVERAL parts (client spec
-- 2026-09-25, Task 2: "select multiple garment parts at once … FRONT BODY,
-- BACK, LEFT SLEEVE grouped under one fabric line"; user, screenshot 3085:
-- "inside the pattern sheet").
--
-- 0640 gave a line exactly one part (`component_id not null`), so three panels
-- cut from the same jersey at the same dia and weight were three rows that
-- differed only in the part. The parts now live in their own table, one row
-- per (coordinate, component) — FK'd to the component master like the line's
-- own column, never a jsonb list nothing can check.
--
-- THE LINE'S OWN `component_id` / `coordinate_id` STAY, AS THE FIRST PART.
-- Nothing is dropped: every row written under 0640 is backfilled here as a
-- one-part line, and a caller still sending the 0640 payload (no `parts`)
-- saves exactly what it did before.
--
-- The merge of lines that match on everything but the part is the ACTION's
-- job (`mergePatternLines`, lib/orders/cad-lifecycle/types.ts): this function
-- stores what it is handed.
-- ============================================================================

create table if not exists public.order_cad_pattern_line_parts (
  id            uuid primary key default gen_random_uuid(),
  line_id       uuid not null references public.order_cad_pattern_lines(id) on delete cascade,
  sno           int  not null default 0,
  coordinate_id uuid references public.items(id),
  component_id  uuid not null references public.components(id)
);
create index if not exists ix_ocplp_line on public.order_cad_pattern_line_parts (line_id);
create unique index if not exists uq_ocplp_line_part
  on public.order_cad_pattern_line_parts (line_id, coalesce(coordinate_id, '00000000-0000-0000-0000-000000000000'::uuid), component_id);
comment on table public.order_cad_pattern_line_parts is
  '0643 — the TYPE of PARTS of one Pattern Sheet line (several panels on one fabric line). The line''s component_id is the first.';

insert into public.order_cad_pattern_line_parts (line_id, sno, coordinate_id, component_id)
select l.id, 1, l.coordinate_id, l.component_id
  from public.order_cad_pattern_lines l
 where not exists (select 1 from public.order_cad_pattern_line_parts p where p.line_id = l.id);

-- A SENT VERSION'S SHEET IS HISTORY — the parts freeze with the line (0640's
-- rule). A cascade from a deleted line runs at depth > 1 and passes.
create or replace function public.cad_pattern_part_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_line uuid := coalesce(new.line_id, old.line_id);
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if exists (select 1
               from public.order_cad_pattern_lines l
               join public.order_cad_dispatches d on d.allocation_id = l.allocation_id
              where l.id = v_line) then
    raise exception using errcode = 'P0001',
      message = 'This CAD version has been sent — its pattern sheet can no longer be changed.';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.cad_pattern_part_guard() from public, anon, authenticated;

drop trigger if exists trg_ocplp_guard on public.order_cad_pattern_line_parts;
create trigger trg_ocplp_guard
  before insert or update or delete on public.order_cad_pattern_line_parts
  for each row execute function public.cad_pattern_part_guard();

alter table public.order_cad_pattern_line_parts enable row level security;
drop policy if exists ocplp_read on public.order_cad_pattern_line_parts;
create policy ocplp_read on public.order_cad_pattern_line_parts for select to authenticated
  using (public.has_permission('orders', 'view'));
revoke all on public.order_cad_pattern_line_parts from anon;
revoke insert, update, delete on public.order_cad_pattern_line_parts from authenticated;
grant select on public.order_cad_pattern_line_parts to authenticated;

-- THE ONE WRITE, now with `parts`: p_lines = [{ parts: [{ coordinate_id,
-- component_id }, …], fabric_category_id, gsm, colour, size_id, table_dia,
-- width_form, avg_pcs_weight_g, remark }, …]. A line without `parts` falls
-- back to its own coordinate_id / component_id (the 0640 payload).
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
  v_l     jsonb;
  v_parts jsonb;
  v_p     jsonb;
  v_i     int := 0;
  v_j     int;
  v_line  uuid;
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
       nullif(btrim(coalesce(v_l ->> 'colour', '')), ''),
       nullif(v_l ->> 'size_id', '')::uuid,
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
  end loop;
end $$;
revoke all on function public.cad_save_pattern_sheet(uuid, text, date, jsonb) from public, anon;
grant execute on function public.cad_save_pattern_sheet(uuid, text, date, jsonb) to authenticated;

-- VERIFY (run by hand)
--   select count(*) from public.order_cad_pattern_lines l
--    where not exists (select 1 from public.order_cad_pattern_line_parts p where p.line_id = l.id);  -- 0
--   select p.proname, p.proacl from pg_proc p where proname in ('cad_save_pattern_sheet','cad_pattern_part_guard');
