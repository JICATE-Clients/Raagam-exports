-- 0848 · KNITTING — YARN THAT CAME BACK IS OWED AGAIN (user 2026-11-14, screenshot 4189)
--
-- KO/26-27/0002: 280 kg sent on DC-0021, 100 kg knitted, 180 kg RETURNED to our store, order still
-- Partly Received. The knitter no longer holds the yarn for the 180 kg of fabric still to come, yet
-- every "left to send" read 0 — the list, the editor and this function all counted GROSS sent.
--
-- `process_dc_dispatch` (live body: 0832, owner line patched by 0836) checked a new DC line against
-- `process_order_lines.sent_qty − Σ sent on other DCs`. It now nets out yarn of that line that came
-- back: `knitting_receipt_yarns` kind 'returned' (to our store, 0831) and 'transferred' (moved onto
-- another KO at the knitter, 0833). `dc_line_items.returned_qty` is NOT used — it counts used +
-- returned (the DC's accounting, 280 of 280 here), not what is back on our shelf.
--
-- Patched IN PLACE from the live body, one statement inserted; the anchor must match exactly once.
-- A non-knitting process order line has no knit yarn row, so the subtraction is 0 and it is unchanged.

do $$
declare
  v_def    text := pg_get_functiondef('public.process_dc_dispatch(uuid)'::regprocedure);
  v_anchor text := E'       and y.status not in (''draft'', ''cancelled'');\n    if l.sent_qty > v_ordered - v_sent + 0.0005 then';
  v_new    text := E'       and y.status not in (''draft'', ''cancelled'');\n'
               || E'    -- 0848: yarn of this line that came back (returned / moved onto another KO) is owed again.\n'
               || E'    v_sent := v_sent - coalesce((select sum(k.qty_kg) from public.knitting_receipt_yarns k\n'
               || E'                                   join public.process_order_knit_yarns py on py.id = k.knit_yarn_id\n'
               || E'                                  where py.process_order_line_id = l.process_order_line_id\n'
               || E'                                    and k.kind in (''returned'', ''transferred'')), 0);\n'
               || E'    if l.sent_qty > v_ordered - v_sent + 0.0005 then';
begin
  if position('0848: yarn of this line that came back' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception '0848: process_dc_dispatch — the balance check was not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_new);
end $$;

do $$
begin
  if position('0848: yarn of this line that came back' in pg_get_functiondef('public.process_dc_dispatch(uuid)'::regprocedure)) = 0
     or position('knit_line_owner' in pg_get_functiondef('public.process_dc_dispatch(uuid)'::regprocedure)) = 0 then
    raise exception '0848: process_dc_dispatch was not patched (or lost 0836)';
  end if;
end $$;
