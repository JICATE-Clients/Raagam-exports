-- ============================================================================
-- Raagam ERP — 0344 Reference-check RPC for delete-or-deactivate
--
-- The masters delete guard (lib/masters/delete-guard.ts) used to decide "is this
-- row in use?" reactively — attempt the DELETE and only deactivate if Postgres
-- raised FK-violation 23503. That is blind to `ON DELETE SET NULL` foreign keys
-- (e.g. items.stock_uom_id -> uoms): deleting an in-use unit raised no error, it
-- silently NULLed every material's unit and the row was hard-deleted anyway.
--
-- This SECURITY DEFINER function makes the check PROACTIVE by inspecting
-- Postgres's own FK catalog: given a table + row id it returns the name of the
-- first child table that still references the row (or NULL if none), so the guard
-- can deactivate-and-report BEFORE deleting. It is blind to nothing — SET NULL,
-- RESTRICT/NO ACTION and any future FK are all covered with no per-table list.
--
-- CASCADE children are excluded (confdeltype = 'c'): those rows are meant to be
-- deleted together with the parent, so they must not count as "in use" — that
-- keeps document/register masters (whose detail lines cascade) deletable.
--
-- SECURITY DEFINER so the check sees all referencing rows regardless of the
-- caller's RLS. ADD-ONLY.
-- ============================================================================

create or replace function public.first_referencing_table(p_table text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r   record;
  hit int;
begin
  for r in
    select
      ns.nspname  as child_schema,
      cl.relname  as child_table,
      att.attname as child_column
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class cl        on cl.oid = con.conrelid
    join pg_catalog.pg_namespace ns    on ns.oid = cl.relnamespace
    join pg_catalog.pg_attribute att   on att.attrelid = con.conrelid
                                      and att.attnum   = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = ('public.' || p_table)::regclass
      and con.confdeltype <> 'c'            -- ignore ON DELETE CASCADE children
      and array_length(con.conkey, 1) = 1   -- single-column FKs only
  loop
    execute format(
      'select 1 from %I.%I where %I = $1 limit 1',
      r.child_schema, r.child_table, r.child_column
    ) using p_id into hit;
    if hit is not null then
      return r.child_table;
    end if;
  end loop;
  return null;
end;
$$;

grant execute on function public.first_referencing_table(text, uuid) to authenticated;
