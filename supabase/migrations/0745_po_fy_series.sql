-- 0745 · Purchase Order numbers on the house series: HO/PO/26-27/0001
--
-- User 2026-10-23 (screenshot 3699): "there is no field for PO number, auto
-- generating — need to add it". Every other document already counts per UNIT and
-- per FINANCIAL YEAR (HO/RE/26-27/0013, HO/IWO/2627/0003, SWO/26-27/0001 — 0486
-- "a DOCUMENT series is per unit"); a PO still took `PO-0009` from one global
-- sequence (assign_code, 0008). This puts the PO on the RE's pattern:
--
--   <location code>/PO/<fiscal_year_label>/<0001>   restarting each April, per unit
--
-- Scope: a PO raised from a requirement (`master_vendor_id`, 0737) — the screen
-- this was asked on. The older PO screens still write `vendor_id` and keep
-- `PO-00nn` until they move to this screen; nothing already numbered is renumbered.
--
-- Same mechanism as `assign_order_number` (the RE): an advisory lock per
-- (unit, FY) so two saves cannot take one number, a counter row per (unit, FY),
-- and a BEFORE INSERT trigger named to run ahead of `trg_po_code` — triggers fire
-- in name order, and `assign_code` only fills a code that is still empty.
-- `po_peek_number()` shows the next number on the screen; it is a preview, the
-- trigger decides.

create table if not exists public.po_no_counters (
  location_id uuid not null references public.locations(id),
  fy text not null,
  last_no integer not null default 0,
  primary key (location_id, fy)
);
-- Written only by the SECURITY DEFINER trigger below; no client policy at all.
alter table public.po_no_counters enable row level security;

create or replace function public.po_no_format(p_location_code text, p_fy text, p_next integer)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_location_code || '/PO/' || public.fiscal_year_label(p_fy) || '/'
      || lpad(p_next::text, greatest(4, length(p_next::text)), '0');
$$;

create or replace function public.assign_po_fy_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_loc text;
  v_fy text;
  v_next integer;
begin
  if new.master_vendor_id is null or coalesce(new.code, '') <> '' then
    return new;
  end if;
  select l.code into v_loc from public.locations l where l.id = new.location_id;
  if v_loc is null or v_loc = '' then
    raise exception 'Pick your working unit in the top bar — a PO number counts per unit'
      using errcode = '23502';
  end if;
  v_fy := public.fiscal_year_segment(coalesce(new.order_date, current_date));
  perform pg_advisory_xact_lock(hashtext('po_no'), hashtext(new.location_id::text || v_fy));
  insert into public.po_no_counters as c (location_id, fy, last_no)
  values (new.location_id, v_fy, 1)
  on conflict (location_id, fy) do update set last_no = c.last_no + 1
  returning last_no into v_next;
  new.code := public.po_no_format(v_loc, v_fy, v_next);
  return new;
end;
$$;

drop trigger if exists trg_po_a_fy_code on public.purchase_orders;
create trigger trg_po_a_fy_code
  before insert on public.purchase_orders
  for each row execute function public.assign_po_fy_code();

-- The number the next PO in the caller's working unit will take (a preview).
create or replace function public.po_peek_number()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.po_no_format(
           l.code,
           public.fiscal_year_segment(current_date),
           coalesce((select c.last_no from public.po_no_counters c
                      where c.location_id = l.id and c.fy = public.fiscal_year_segment(current_date)), 0) + 1)
    from public.locations l
   where l.id = public.current_location()
     and public.has_permission('materials_purchase', 'view');
$$;

revoke all on function public.po_no_format(text, text, integer) from public, anon;
grant execute on function public.po_no_format(text, text, integer) to authenticated;
revoke all on function public.assign_po_fy_code() from public, anon;
revoke all on function public.po_peek_number() from public, anon;
grant execute on function public.po_peek_number() to authenticated;
