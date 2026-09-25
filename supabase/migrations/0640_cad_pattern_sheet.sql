-- ============================================================================
-- Raagam ERP — 0640 the Pattern Maker's sheet (user 2026-09-25: "the pattern
-- status form fields … this for the pattern maker, he will update with this
-- form").
--
-- The register the pattern room keeps, column for column:
--
--   DATE · BUYER · RE-NO / STYLE NAME · STYLE          header — the date is
--                                                      `pattern_date` (new);
--                                                      the rest are the order's
--   FABRIC · GSM · TYPE of PARTS · COLOUR · SIZE ·     one LINE per part
--   TABLE DIA · TUBULAR & OPEN WIDTH ·                 (order_cad_pattern_lines)
--   AVG CAD PCS WEIGHT · REMARK
--
-- ON THE VERSION, LIKE EVERYTHING ELSE THE PATTERN MAKER RECORDS. A rework's
-- next version is a new pattern and gets its own sheet; a sent version's sheet
-- is what the buyer saw, so the lines freeze at dispatch (trigger below), as
-- 0638 froze the status.
--
-- REAL NUMBERS, NOT NOTES. Table dia, the width form and the piece weight are
-- what the Fabric BOM needs from the CAD (2026-09-25 spec §3, "auto-fill"), so
-- they are typed columns with CHECKs — 0638's free-text Notes could not feed a
-- calculation.
--
-- ONE WRITE, ONE TRANSACTION: `cad_save_pattern_sheet` sets the status and date
-- and replaces the lines together, so a half-saved sheet cannot exist.
-- ============================================================================

alter table public.order_cad_allocations
  add column if not exists pattern_date date;
comment on column public.order_cad_allocations.pattern_date is
  '0640 — DATE on the Pattern Maker''s sheet (when the pattern details were recorded).';

create table if not exists public.order_cad_pattern_lines (
  id                  uuid primary key default gen_random_uuid(),
  allocation_id       uuid not null references public.order_cad_allocations(id) on delete cascade,
  sno                 int  not null default 0,
  -- TYPE of PARTS: the style component (with its coordinate, TOP / BOTTOM).
  coordinate_id       uuid references public.items(id),
  component_id        uuid not null references public.components(id),
  -- FABRIC: the structure the part is cut from (a `categories` row, 0405).
  fabric_category_id  uuid references public.categories(id),
  gsm                 numeric(8,2)  check (gsm is null or gsm > 0),
  -- COLOUR by value: the order's colours are combo TEXT (color_name), not FKs.
  colour              text,
  size_id             uuid references public.config_lookups(id),
  table_dia           numeric(10,2) check (table_dia is null or table_dia > 0),
  width_form          text check (width_form is null or width_form in ('open_width','tubular')),
  -- AVG CAD PCS WEIGHT, grams per piece.
  avg_pcs_weight_g    numeric(10,3) check (avg_pcs_weight_g is null or avg_pcs_weight_g > 0),
  remark              text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now()
);
create index if not exists ix_ocpl_allocation on public.order_cad_pattern_lines (allocation_id);
comment on table public.order_cad_pattern_lines is
  '0640 — the Pattern Maker''s sheet, one line per part (× colour / size where they differ). Frozen once the version is dispatched.';

-- A SENT VERSION'S SHEET IS HISTORY. The FK cascade (a deleted allocation or
-- order) runs at depth > 1 and passes.
create or replace function public.cad_pattern_line_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_alloc uuid := coalesce(new.allocation_id, old.allocation_id);
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if exists (select 1 from public.order_cad_dispatches d where d.allocation_id = v_alloc) then
    raise exception using errcode = 'P0001',
      message = 'This CAD version has been sent — its pattern sheet can no longer be changed.';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.cad_pattern_line_guard() from public, anon, authenticated;

drop trigger if exists trg_ocpl_guard on public.order_cad_pattern_lines;
create trigger trg_ocpl_guard
  before insert or update or delete on public.order_cad_pattern_lines
  for each row execute function public.cad_pattern_line_guard();

-- THE ONE WRITE. p_lines = [{ coordinate_id, component_id, fabric_category_id,
-- gsm, colour, size_id, table_dia, width_form, avg_pcs_weight_g, remark }, …]
-- in display order. The allocation trigger (0638) refuses a status change on a
-- sent version; the line guard above refuses the lines.
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
  v_l  jsonb;
  v_i  int := 0;
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
    if nullif(v_l ->> 'component_id', '') is null then
      raise exception using errcode = 'P0001', message = format('Line %s: choose the Type of Part.', v_i);
    end if;
    insert into public.order_cad_pattern_lines
      (allocation_id, sno, coordinate_id, component_id, fabric_category_id, gsm, colour, size_id,
       table_dia, width_form, avg_pcs_weight_g, remark)
    values
      (p_allocation, v_i,
       nullif(v_l ->> 'coordinate_id', '')::uuid,
       (v_l ->> 'component_id')::uuid,
       nullif(v_l ->> 'fabric_category_id', '')::uuid,
       nullif(v_l ->> 'gsm', '')::numeric,
       nullif(btrim(coalesce(v_l ->> 'colour', '')), ''),
       nullif(v_l ->> 'size_id', '')::uuid,
       nullif(v_l ->> 'table_dia', '')::numeric,
       nullif(v_l ->> 'width_form', ''),
       nullif(v_l ->> 'avg_pcs_weight_g', '')::numeric,
       nullif(btrim(coalesce(v_l ->> 'remark', '')), ''));
  end loop;
end $$;
revoke all on function public.cad_save_pattern_sheet(uuid, text, date, jsonb) from public, anon;
grant execute on function public.cad_save_pattern_sheet(uuid, text, date, jsonb) to authenticated;

-- Reads: orders:view. Writes only through the function above.
alter table public.order_cad_pattern_lines enable row level security;
drop policy if exists ocpl_read on public.order_cad_pattern_lines;
create policy ocpl_read on public.order_cad_pattern_lines for select to authenticated
  using (public.has_permission('orders', 'view'));
revoke all on public.order_cad_pattern_lines from anon;
revoke insert, update, delete on public.order_cad_pattern_lines from authenticated;
grant select on public.order_cad_pattern_lines to authenticated;
