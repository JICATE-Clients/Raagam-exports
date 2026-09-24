-- 0630 — WHAT CHANGES INSIDE EACH MODULE (client 2026-09-24, screenshot 3051)
--
-- Raise Revision listed Order Entry's detail (PO Qty, Delivery Date, FOB
-- Price, Color Combos) under its tick, and printed the other three modules'
-- detail only as grey hint text — Material BOM (Trims, Accessories, Packaging
-- Items), Fabric BOM (Yarn Structure, Process Loss, Fabric Allocations), Order
-- Budget (Overheads, Freight, Operational Rates) — with nothing to tick.
--
-- A RECORD, NOT A SCOPE. Since 0627 a picked module opens whole, so these do
-- not narrow anything and are deliberately NOT amendment kinds (a kind carries
-- seeded scope rows). They say what the revision touches, for the register,
-- the revision page and the MD. Values are `<module>.<detail>`, the vocabulary
-- is MODULE_DETAILS in lib/orders/amendments/amendment-entry.ts.
--
-- WRITTEN BY AN RPC, like every other column here: the table has no UPDATE
-- policy (0576), and adding one for this column would open the whole row.

alter table public.order_budget_revisions
  add column if not exists module_details text[] not null default '{}';

comment on column public.order_budget_revisions.module_details is
  'What changes inside each non-Order-Entry module, `<module>.<detail>` (0630). A record for the register / MD, never a scope.';

create or replace function public.set_order_amendment_details(p_entry uuid, p_details text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'You do not have permission to revise an order';
  end if;
  if exists (select 1 from unnest(coalesce(p_details, '{}')) d
              where d !~ '^(material_bom|fabric_bom|order_budget)\.[a-z_]+$') then
    raise exception 'Unknown module detail';
  end if;
  /* Only an OPEN entry — a decided revision's record is history. */
  update public.order_budget_revisions
     set module_details = (select coalesce(array_agg(distinct d order by d), '{}')
                             from unnest(coalesce(p_details, '{}')) d)
   where id = p_entry and outcome = 'open';
  if not found then
    raise exception 'That revision is not open';
  end if;
end;
$$;

revoke all on function public.set_order_amendment_details(uuid, text[]) from public, anon;
grant execute on function public.set_order_amendment_details(uuid, text[]) to authenticated, service_role;

do $verify$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_budget_revisions'
                    and column_name = 'module_details') then
    raise exception '0630: module_details was not added';
  end if;
  if exists (select 1 from pg_proc
              where oid = 'public.set_order_amendment_details(uuid,text[])'::regprocedure
                and (proacl is null or proacl::text like '%anon=%' or proacl::text ~ '(^|[{,])=X/')) then
    raise exception '0630: set_order_amendment_details is executable by anon or PUBLIC';
  end if;
  raise notice '0630 verified: module_details column + its writer, closed to anon';
end $verify$;
