-- 0838 (ledger: 0837_knitting_receipt_transporter_party_stock — same number as the parallel dc_cap_override, renamed after apply; the ledger keys on timestamp) · KNITTING RECEIPTS: TRANSPORTER, KNITTER DC REQUIRED, PARTY-STOCK YARN RETURN
-- (client spec for Process ▸ Knitting ▸ Fabric Receipts / Yarn Returns ▸ New, 2026-11-12).
--
-- 1. `knitting_receipts.transporter` — saved from `knitting_receipt_post`'s header jsonb
--    (`p_header->>'transporter'`), in capitals like every other header text.
--
-- 2. A FABRIC receipt needs the Knitter DC No and Knitter DC Date. A yarn return does not —
--    the knitter often sends unknitted yarn back with no paper of its own.
--
-- 3. PARTY STOCK. A yarn return line may say the yarn goes from this knitter straight to
--    ANOTHER knitter's Knitting Order, without coming back to HO. That is exactly 0833's
--    at-knitter move — a paper DC on the target order (`knit_transfer_from`), the source rows
--    kind 'transferred', the stock moving between the two lines' owners inside the unit's
--    Processing store (0836 `knit_line_owner`, per line, so a move across REs is handled) — but
--    0833 refuses a different knitter ("is with another knitter").
--      - `knitting_transfer_at_knitter_core(…, p_any_knitter)` is the LIVE body of
--        `knitting_transfer_at_knitter` (pg_get_functiondef at apply time, so 0836's per-line
--        owners are carried), with the knitter test made conditional and the DC's purpose
--        worded for a party move. Every replacement must match exactly once or this aborts.
--      - `knitting_transfer_at_knitter(uuid,uuid,numeric,text)` keeps its signature and
--        behaviour: it is now a wrapper calling the core with p_any_knitter = false, so the
--        same-knitter move refuses another knitter exactly as before.
--        A LATER MIGRATION THAT PATCHES THE TRANSFER FROM ITS LIVE BODY PATCHES THE CORE.
--      - `knitting_transfer_to_party(from_yarn, to_order, kg, note)` picks the target order's
--        line(s) for the same yarn item (sno order, by what is left to send on each) and calls
--        the core with p_any_knitter = true. No line for the yarn → refused with a sentence.
--      - `knitting_yarn_return_post(order, header, returns, party)` posts a yarn return that
--        mixes Own Store lines (through `knitting_receipt_post`, unchanged path) and Party Stock
--        lines in ONE call, so it cannot half-succeed.
--
-- 4. NO MD APPROVAL ON CLOSE (user 2026-11-12, overriding 0830's D1). `knitting_order_close` is
--    re-created from its LIVE body so it never returns 'pending' and never parks the order for
--    the `knitting_close` approval: it records the loss % it closed at and writes the balance off
--    (`knitting_close_write_off`, unchanged) at once. The reason is still required whenever a
--    balance is written off. An order already `close_pending` (none on 2026-11-12) is no longer
--    refused — closing it directly clears the flag (write_off sets close_pending = false).
--    The screen's "Final receipt — close this order" posts the receipt, then calls this.
--    `knitting_close_apply_decision` / `_withdraw` are left in place, now unreached.
--
-- Function grants (AGENTS.md): every function revoked from public, anon; the client-called ones
-- are granted to authenticated; the core is reachable only through its wrappers.

alter table public.knitting_receipts
  add column if not exists transporter text;

-- ---------------------------------------------------------------------------
-- 1 + 2. knitting_receipt_post: live body, transporter saved, knitter DC required on fabric
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.knitting_receipt_post(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  r record;
begin
  for r in
    select * from (values
      ('insert into public.knitting_receipts (kind, process_order_id, location_id, receipt_date, vendor_dc_no, vendor_dc_date, vehicle_no, notes)',
       'insert into public.knitting_receipts (kind, process_order_id, location_id, receipt_date, vendor_dc_no, vendor_dc_date, vehicle_no, notes, transporter)'),
      (E'          nullif(upper(btrim(coalesce(p_header->>\'notes\', \'\'))), \'\'))\n  returning id, code into v_rcpt, v_code;',
       E'          nullif(upper(btrim(coalesce(p_header->>\'notes\', \'\'))), \'\'),\n          nullif(upper(btrim(coalesce(p_header->>\'transporter\', \'\'))), \'\'))\n  returning id, code into v_rcpt, v_code;'),
      (E'  v_kind := case when jsonb_array_length(coalesce(p_fabrics, \'[]\'::jsonb)) > 0 then \'fabric\' else \'yarn_return\' end;\n',
       E'  v_kind := case when jsonb_array_length(coalesce(p_fabrics, \'[]\'::jsonb)) > 0 then \'fabric\' else \'yarn_return\' end;\n'
       || E'  -- 0837: the knitter''s own DC is the paper the fabric came on — both halves are asked for.\n'
       || E'  if v_kind = \'fabric\' and (nullif(btrim(coalesce(p_header->>\'vendor_dc_no\', \'\')), \'\') is null\n'
       || E'                           or nullif(p_header->>\'vendor_dc_date\', \'\') is null) then\n'
       || E'    raise exception \'Enter the Knitter DC No and Knitter DC Date the fabric came with\' using errcode = \'P0001\';\n'
       || E'  end if;\n')
    ) t(old_s, new_s)
  loop
    if (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s) <> 1 then
      raise exception '0837: knitting_receipt_post — the statement to replace was found % times, expected once: %',
        (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s), r.old_s;
    end if;
    v_def := replace(v_def, r.old_s, r.new_s);
  end loop;
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 3a. The transfer core: the LIVE body of knitting_transfer_at_knitter, knitter test optional
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.knitting_transfer_at_knitter(uuid,uuid,numeric,text)'::regprocedure);
  r record;
begin
  if position('knitting_transfer_at_knitter_core' in v_def) > 0 then
    raise exception '0837: knitting_transfer_at_knitter is already a wrapper — this migration ran before';
  end if;
  for r in
    select * from (values
      ('public.knitting_transfer_at_knitter(p_from_yarn uuid, p_to_yarn uuid, p_kg numeric, p_note text)',
       'public.knitting_transfer_at_knitter_core(p_from_yarn uuid, p_to_yarn uuid, p_kg numeric, p_note text, p_any_knitter boolean)'),
      ('  if fo.vendor_id is distinct from tor.vendor_id then',
       '  if not coalesce(p_any_knitter, false) and fo.vendor_id is distinct from tor.vendor_id then'),
      (E'\'Yarn already at the knitter — moved from \' || coalesce(fo.code, \'\')',
       E'case when fo.vendor_id is distinct from tor.vendor_id\n'
       || E'          then \'Party stock — yarn sent straight from the knitter of \' || coalesce(fo.code, \'\')\n'
       || E'          else \'Yarn already at the knitter — moved from \' || coalesce(fo.code, \'\') end')
    ) t(old_s, new_s)
  loop
    if (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s) <> 1 then
      raise exception '0837: knitting_transfer_at_knitter — the statement to replace was found % times, expected once: %',
        (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s), r.old_s;
    end if;
    v_def := replace(v_def, r.old_s, r.new_s);
  end loop;
  execute v_def;
end $$;
revoke all on function public.knitting_transfer_at_knitter_core(uuid, uuid, numeric, text, boolean) from public, anon, authenticated;

-- 3b. The same-knitter move, unchanged in behaviour: the core with the knitter test on.
create or replace function public.knitting_transfer_at_knitter(p_from_yarn uuid, p_to_yarn uuid, p_kg numeric, p_note text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.knitting_transfer_at_knitter_core(p_from_yarn, p_to_yarn, p_kg, p_note, false)
$$;
revoke all on function public.knitting_transfer_at_knitter(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.knitting_transfer_at_knitter(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3c. Party stock: from one yarn line of this order to ANOTHER knitter's Knitting Order
-- ---------------------------------------------------------------------------
create or replace function public.knitting_transfer_to_party(p_from_yarn uuid, p_to_order uuid, p_kg numeric, p_note text)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  fy     record;
  tor    record;
  t      record;
  v_left numeric := round(coalesce(p_kg, 0), 3);
  v_room numeric;
  v_take numeric;
  v_dcs  uuid[] := '{}';
  v_any  boolean := false;
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to move yarn between knitting orders' using errcode = '42501';
  end if;
  if v_left <= 0 then
    raise exception 'Enter the kg to send to the other knitter' using errcode = 'P0001';
  end if;
  select py.id, py.yarn_item_id, pf.process_order_id, i.name as yarn_name into fy
    from public.process_order_knit_yarns py
    join public.process_order_knit_fabrics pf on pf.id = py.knit_fabric_id
    join public.items i on i.id = py.yarn_item_id
   where py.id = p_from_yarn;
  if fy.id is null then
    raise exception 'Yarn line not found' using errcode = 'P0002';
  end if;
  select id, code, process_type into tor from public.process_orders where id = p_to_order;
  if tor.id is null or tor.process_type <> 'knitting' then
    raise exception 'Pick the Knitting Order the yarn goes to' using errcode = 'P0001';
  end if;

  -- The target's lines for the same yarn, each with what it may still be sent (its DC cap).
  for t in
    select py.id, py.process_order_line_id,
           coalesce(l.sent_qty, 0) - coalesce((
             select sum(x.sent_qty) from public.dc_line_items x
               join public.delivery_challans d on d.id = x.delivery_challan_id
              where x.process_order_line_id = py.process_order_line_id and d.status not in ('draft', 'cancelled')), 0) as room
      from public.process_order_knit_yarns py
      join public.process_order_knit_fabrics pf on pf.id = py.knit_fabric_id
      left join public.process_order_lines l on l.id = py.process_order_line_id
     where pf.process_order_id = tor.id and py.yarn_item_id = fy.yarn_item_id
     order by pf.sno, py.sno
  loop
    v_any := true;
    exit when v_left <= 0.0005;
    v_room := round(greatest(t.room, 0), 3);
    continue when v_room <= 0.0005;
    v_take := least(v_room, v_left);
    v_dcs := v_dcs || public.knitting_transfer_at_knitter_core(fy.id, t.id, v_take, p_note, true);
    v_left := round(v_left - v_take, 3);
  end loop;

  if not v_any then
    raise exception '% is not on % — pick a Knitting Order that uses this yarn', fy.yarn_name, coalesce(tor.code, 'that order')
      using errcode = 'P0001';
  end if;
  if v_left > 0.0005 then
    raise exception '% on %: only % kg more can be sent to it', fy.yarn_name, coalesce(tor.code, ''),
      round(round(coalesce(p_kg, 0), 3) - v_left, 3) using errcode = 'P0001';
  end if;
  return v_dcs;
end;
$$;
revoke all on function public.knitting_transfer_to_party(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.knitting_transfer_to_party(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3d. One yarn return, Own Store + Party Stock lines, in one transaction
-- ---------------------------------------------------------------------------
-- p_returns: as knitting_receipt_post's (store lines). p_party: [ { knit_yarn_id, to_order_id, kg } ].
-- Returns { receipt_id, dc_ids }.
create or replace function public.knitting_yarn_return_post(p_order_id uuid, p_header jsonb, p_returns jsonb, p_party jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f      jsonb;
  v_rcpt uuid;
  v_dcs  uuid[] := '{}';
  v_kg   numeric;
  v_n    integer := 0;
  v_name text;
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to post a yarn return' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_returns, '[]'::jsonb)) > 0 then
    v_rcpt := public.knitting_receipt_post(p_order_id, p_header, '[]'::jsonb, p_returns);
  end if;
  for f in select * from jsonb_array_elements(coalesce(p_party, '[]'::jsonb)) loop
    v_kg := nullif(f->>'kg', '')::numeric;
    continue when v_kg is null or v_kg <= 0;
    select i.name into v_name
      from public.process_order_knit_yarns py
      join public.process_order_knit_fabrics pf on pf.id = py.knit_fabric_id
      join public.items i on i.id = py.yarn_item_id
     where py.id = nullif(f->>'knit_yarn_id', '')::uuid and pf.process_order_id = p_order_id;
    if v_name is null then
      raise exception 'A returned yarn is not on this knitting order' using errcode = 'P0001';
    end if;
    if nullif(f->>'to_order_id', '')::uuid is null then
      raise exception '%: pick the Knitting Order the yarn goes to', v_name using errcode = 'P0001';
    end if;
    if nullif(f->>'to_order_id', '')::uuid = p_order_id then
      raise exception '%: Party Stock goes to ANOTHER knitter''s Knitting Order', v_name using errcode = 'P0001';
    end if;
    v_dcs := v_dcs || public.knitting_transfer_to_party(
      (f->>'knit_yarn_id')::uuid, (f->>'to_order_id')::uuid, v_kg,
      nullif(btrim(coalesce(p_header->>'notes', '')), ''));
    v_n := v_n + 1;
  end loop;
  if v_rcpt is null and v_n = 0 then
    raise exception 'Enter the yarn returned' using errcode = 'P0001';
  end if;
  return jsonb_build_object('receipt_id', v_rcpt, 'dc_ids', to_jsonb(v_dcs));
end;
$$;
revoke all on function public.knitting_yarn_return_post(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.knitting_yarn_return_post(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. knitting_order_close: live body, always direct
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.knitting_order_close(uuid,text)'::regprocedure);
  r record;
begin
  for r in
    select * from (values
      (E'  if o.close_pending then\n    raise exception \'The close is already with the MD\' using errcode = \'P0001\';\n  end if;\n',
       E'  -- 0837: no MD approval any more — an order left close_pending by the old flow closes directly.\n'),
      (E'  if b.balance_kg <= 0.0005 or (o.allowed_loss_pct is not null and coalesce(b.loss_pct, 0) <= o.allowed_loss_pct + 0.0005) then\n'
       || E'    perform public.knitting_close_write_off(o.id, v_reason);\n'
       || E'    return \'closed\';\n'
       || E'  end if;\n'
       || E'\n'
       || E'  update public.process_orders\n'
       || E'     set close_pending = true, close_reason = v_reason, close_loss_pct = b.loss_pct, close_remark = null\n'
       || E'   where id = o.id;\n'
       || E'  return \'pending\';\n',
       E'  -- 0837 (user 2026-11-12): a close is ALWAYS direct, over the Allowed Loss % or not — the loss\n'
       || E'  -- shows red on the receipt screen and the Knitting Analysis; the reason above is still asked for.\n'
       || E'  update public.process_orders set close_loss_pct = b.loss_pct, close_remark = null where id = o.id;\n'
       || E'  perform public.knitting_close_write_off(o.id, v_reason);\n'
       || E'  return \'closed\';\n')
    ) t(old_s, new_s)
  loop
    if (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s) <> 1 then
      raise exception '0837: knitting_order_close — the statement to replace was found % times, expected once: %',
        (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s), r.old_s;
    end if;
    v_def := replace(v_def, r.old_s, r.new_s);
  end loop;
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare
  v_post text := pg_get_functiondef('public.knitting_receipt_post(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  v_core text := pg_get_functiondef('public.knitting_transfer_at_knitter_core(uuid,uuid,numeric,text,boolean)'::regprocedure);
begin
  if position('transporter' in v_post) = 0 or position('Knitter DC No and Knitter DC Date' in v_post) = 0 then
    raise exception '0837: knitting_receipt_post was not patched';
  end if;
  if position('knit_line_owner(ty.' in v_core) = 0 or position('p_any_knitter' in v_core) = 0 then
    raise exception '0837: the transfer core lost 0836''s per-line owner or the knitter switch';
  end if;
  if position('''pending''' in pg_get_functiondef('public.knitting_order_close(uuid,text)'::regprocedure)) > 0 then
    raise exception '0837: knitting_order_close can still return pending';
  end if;
  if position('knitting_transfer_at_knitter_core' in pg_get_functiondef('public.knitting_transfer_at_knitter(uuid,uuid,numeric,text)'::regprocedure)) = 0 then
    raise exception '0837: knitting_transfer_at_knitter is not the wrapper';
  end if;
end $$;
