-- ============================================================================
-- Raagam ERP — 0517 Deleting a garment order takes BOTH its rows
--
-- A garment order is two rows, and only one of them was being deleted:
--
--   sales_orders               holds the SC No, minted by assign_order_number()
--   garment_order_amendments   the document — style lines, combos, prices, T&A
--
-- `deleteAmendment` deleted the document and nothing else, so every order the
-- operator removed left its NUMBERED sales_orders row behind, referenced by
-- nothing and visible on no screen. On 2026-09-03 all eight Head Office orders
-- were in that state: the list was empty, and New Garment Order offered
-- HO/RE/26-27/0013 (client: "i have deleted all order so it should start from 1
-- know?").
--
-- THE NUMBER WAS THE SYMPTOM. 0516 made the serial follow the rows, which is
-- right on its own terms and fixed nothing here — the husks ARE rows, so
-- "in use" counted them and answered 13. An orphan that no screen can show is
-- invisible to every check that reads a screen; the only thing that disagreed
-- was a number on a different page, which is why it was reported as a numbering
-- bug. The eight were deleted by hand once the cause was found.
--
-- ---------------------------------------------------------------------------
-- WHY AN RPC AND NOT TWO CALLS FROM THE ACTION.
--
-- `createAmendment` does the mirror image of this in TypeScript and says so:
-- "NOT ATOMIC: two PostgREST calls, no transaction … The correct end state is
-- one plpgsql RPC doing both inserts; this is the honest version until there is
-- one." On the DELETE side the non-atomic version is not honest enough, because
-- its failure mode IS THE BUG BEING FIXED: delete the document, fail to delete
-- the order, and you have made another orphan — the exact state this migration
-- exists to stop. One function, one transaction, so a refusal at the second
-- step puts the first one back.
--
-- ---------------------------------------------------------------------------
-- THE RULE: THE ORDER GOES WITH THE LAST DOCUMENT THAT NAMES IT.
--
-- An AMENDMENT is another `garment_order_amendments` row pointing at the SAME
-- `sales_orders` row (`createAmendment` reuses `sales_order_id` and mints only
-- when there is none). So deleting one amendment of an amended order must not
-- take the order with it, and deleting the last document must.
--
-- COUNTED, NOT READ OFF `amend_type`. The column exists and would look like the
-- obvious test — "is this the original or an amendment?" — but it is a label,
-- and a label that is blank, or wrong, or set by an import silently deletes an
-- order that still has documents, or strands one that does not. Counting the
-- rows that actually point at the order cannot be wrong about it.
--
-- ---------------------------------------------------------------------------
-- A DELETE THAT DELETES NOTHING IS NOT A SUCCESS.
--
-- PostgREST returns no error when RLS filters every row out of a DELETE — the
-- request succeeds and removes nothing, and `deleteAmendment` returned
-- `{ ok: true }` for it. That is a second silent failure sitting in the same
-- function as the first, and the same shape as the one AGENTS.md records for
-- reads ("A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST"). `get diagnostics
-- row_count` is checked at both steps and a zero raises.
--
-- ---------------------------------------------------------------------------
-- WHAT STOPS A DELETE, AND THAT IS THE POINT OF DOING IT IN THE DATABASE.
--
-- 30-odd children of `sales_orders` are ON DELETE CASCADE — prices, so_line_
-- items, order_fabrics, ta_plans — and those are the order's own data, which
-- SHOULD go with it. Nine are ON DELETE NO ACTION: po_line_items,
-- shipment_lines, material_bom_amendments, ta_completions, worker_piece_records
-- and friends. Those are downstream commitments — a PO raised against the
-- order, a shipment, work booked by a worker — and a foreign-key violation
-- there is the correct answer, not an obstacle. It aborts the whole function,
-- so the document survives too: an order somebody has already purchased against
-- is not deleted halfway.
--
-- SECURITY INVOKER, deliberately. RLS on both tables requires
-- `has_permission('orders','delete')` AND `is_current_location(location_id)`,
-- which is exactly the check that should govern this. A DEFINER function here
-- would let any authenticated caller delete any order at any unit.
-- ============================================================================

create or replace function public.delete_garment_order_document(p_id uuid)
returns table (
  deleted_order boolean,
  order_number  text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
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
    select count(*) into v_docs
      from public.garment_order_amendments
     where sales_order_id = v_order;

    if v_docs = 0 then
      select o.order_number into v_no
        from public.sales_orders o
       where o.id = v_order;

      if v_no is null then
        -- The order exists (the FK it was just released from is NO ACTION, so
        -- it cannot have vanished) but this caller cannot see it. Refusing puts
        -- the document back rather than leaving the husk this fixes.
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

comment on function public.delete_garment_order_document(uuid) is
  'Deletes one garment order document AND, when it was the last document '
  'naming it, the sales_orders row that holds its SC No — in ONE transaction, '
  'so a refusal at the second step puts the first one back. Before 0517 the '
  'document was deleted alone and every removed order left a numbered orphan '
  'behind (client 2026-09-03). An amendment is another document on the same '
  'order, so the order survives while any document still names it — counted, '
  'never read off amend_type, which is a label and can be blank. Raises when a '
  'step deletes nothing: RLS filtering a DELETE is not an error to PostgREST '
  'and used to report as success. SECURITY INVOKER — orders:delete at the '
  'record''s own location, which is what both tables'' policies require.';

revoke all on function public.delete_garment_order_document(uuid) from public, anon;
grant execute on function public.delete_garment_order_document(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Self-verification. `{"success": true}` means the SQL ran, not that it
-- achieved its stated goal (0383 and 0386 both applied cleanly and both left a
-- function anon-callable). Read the CATALOG, never this file.
-- ---------------------------------------------------------------------------
do $$
declare
  v_orphans int;
begin
  -- 1. The function exists with the signature the action calls.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_garment_order_document'
       and pg_get_function_identity_arguments(p.oid) = 'p_id uuid'
  ) then
    raise exception '0517: delete_garment_order_document(uuid) is not there.';
  end if;

  -- 2. It is INVOKER. A definer here would delete any unit's orders.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_garment_order_document'
       and p.prosecdef
  ) then
    raise exception
      '0517: delete_garment_order_document is SECURITY DEFINER — it must be '
      'INVOKER so RLS applies the orders:delete + current-location check.';
  end if;

  -- 3. Not anon-callable. PUBLIC's acl entry has an EMPTY grantee ('=X/owner'),
  --    so this anchors on the start of an acl ITEM — '%=X/%' over the joined
  --    array matches 'postgres=X/postgres', the owner's own grant, and failed
  --    0516 on its first apply.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_garment_order_document'
       and (
         has_function_privilege('anon', p.oid, 'execute')
         or p.proacl is null
         or exists (select 1 from unnest(p.proacl) a where a::text like '=%')
       )
  ) then
    raise exception '0517: delete_garment_order_document is callable by anon or PUBLIC.';
  end if;

  -- 4. Report the orphans that already exist. NOT an assertion and not a
  --    cleanup: Unit 2's 86 are the seeded demo order book, which has never had
  --    documents and which the dashboard reads. Deleting them here would empty
  --    it. The eight Head Office husks this migration was written for were
  --    removed by hand on 2026-09-03.
  select count(*) into v_orphans
    from public.sales_orders o
   where not exists (
     select 1 from public.garment_order_amendments a where a.sales_order_id = o.id
   );
  raise notice
    '0517 OK — % sales_orders rows carry no document. Every one made from here '
    'on is deleted with its document.', v_orphans;
end;
$$;
