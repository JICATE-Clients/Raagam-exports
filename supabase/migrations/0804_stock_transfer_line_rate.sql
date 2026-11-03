-- 0804 · A posted transfer line keeps the rate it moved at (follows 0803, same day).
--
-- The screen and the slip print Rate and Value per line. Reading them back off the ledger would
-- mean matching a line to its two ledger rows by item · lot · qty, and a GRN receipt row can
-- carry no rate at all (Stock Statement falls back to the PO line's price) — so the post stamps
-- the rate it used onto the line itself. Who may SEE it is unchanged: the app shows a rate only
-- to a holder of the Stock Statement with Value screen grant (0793).
--
-- stock_transfer_post is patched IN PLACE on its live body (anchor asserted), like 0803 did
-- po_requirement_lines, so this cannot re-create it from a stale copy.

alter table public.stock_transfer_lines add column if not exists rate numeric(14,4);
comment on column public.stock_transfer_lines.rate is
  'Stamped by stock_transfer_post (0804): the layer rate both ledger legs were posted at. Null on a draft.';

do $mig$
declare
  v_def text := pg_get_functiondef('public.stock_transfer_post(uuid)'::regprocedure);
  a1 text := E'    update pg_temp._str_avail set';
begin
  if position('set rate = v_rate' in v_def) > 0 then
    raise notice 'stock_transfer_post already stamps the line rate — skipped';
    return;
  end if;
  if position(a1 in v_def) = 0 then
    raise exception 'stock_transfer_post has changed since 0803 — patch it by hand from its latest body';
  end if;
  execute replace(v_def, a1,
    E'    update public.stock_transfer_lines set rate = v_rate where id = l.id;\n' || a1);
end
$mig$;
