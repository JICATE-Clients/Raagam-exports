-- 0827 — a draft order has no number, and that is not "row not visible".
--
-- 0517 read sales_orders.order_number and took NULL to mean RLS had hidden the
-- row: at the time every order was numbered on insert, so the two were the same
-- fact. 0700 (2026-10-09) stopped numbering drafts (number_deferred = true), and
-- from then on NULL also meant "a draft, correctly unnumbered". Every draft
-- delete raised "its SC No row is not visible to you" and rolled back.
--
-- The test is now whether the SELECT found the row (FOUND), which is the
-- question 0517 meant to ask. A row RLS really hides still raises, and a draft
-- goes through, returning order_number = NULL. The action ignores that value.
--
-- CREATE OR REPLACE keeps the function's ACL, so 0517's revoke from public, anon
-- still stands. Asserted below rather than assumed.

create or replace function public.delete_garment_order_document(p_id uuid)
returns table(deleted_order boolean, order_number text)
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_order uuid;
  v_no    text;
  v_docs  int;
  v_rows  int;
begin
  -- Read the order BEFORE the document goes: afterwards nothing points at it.
  select a.sales_order_id into v_order
    from public.garment_order_amendments a
   where a.id = p_id;

  delete from public.garment_order_amendments where id = p_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- RLS filtering every row out of a DELETE is not an error to PostgREST. It
    -- is one here.
    raise exception
      'Nothing was deleted — this garment order no longer exists, or it belongs '
      'to another unit.'
      using errcode = '42501';
  end if;

  deleted_order := false;
  order_number  := null;

  if v_order is not null then
    -- Does any OTHER document still name this order? An amendment does.
    -- COUNTED, never read off amend_type: that is a label, and a blank one
    -- would delete an order that still has documents.
    select count(*) into v_docs
      from public.garment_order_amendments
     where sales_order_id = v_order;

    if v_docs = 0 then
      select o.order_number into v_no
        from public.sales_orders o
       where o.id = v_order;

      -- NOT FOUND, never "v_no is null": a draft holds no number (0700).
      if not found then
        raise exception
          'The order''s number could not be released — its SC No row is not '
          'visible to you. Nothing was deleted.'
          using errcode = '42501';
      end if;

      delete from public.sales_orders where id = v_order;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception
          'The order''s number could not be released. Nothing was deleted.'
          using errcode = '42501';
      end if;

      deleted_order := true;
      order_number  := v_no;
    end if;
  end if;

  return next;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_garment_order_document'
       and (
         p.prosecdef
         or p.prosrc like '%v_no is null then%'
         or has_function_privilege('anon', p.oid, 'execute')
         or p.proacl is null
         or exists (select 1 from unnest(p.proacl) a where a::text like '=%')
       )
  ) then
    raise exception
      '0827: delete_garment_order_document is DEFINER, still tests v_no, or is callable by anon/PUBLIC.';
  end if;
end;
$$;
