-- 0798 — Rejection / Replacement DCs take the DC number series (user 2026-11-03, screenshot 3995:
-- "that dc no is not following our format").
--
-- Purchase ▸ Delivery Challan lists five kinds of DC. Process / Production / General live in
-- `delivery_challans` and are numbered `assign_code('DC', seq_dc)` → DC-0001. Rejection and
-- Replacement are `vendor_returns` rows (0781) and kept 0202's own `VRT` prefix and sequence, so
-- one register read DC-0003 on one line and VRT-0005 on the next.
--
-- Fix: the vendor-return trigger draws from the SAME `seq_dc`, so every DC on that screen has one
-- series and two tables can never hand out the same number. The three rows numbered VRT before
-- this (VRT-0005 / 0007 / 0008, 2026-10-31 and 11-02) are renumbered in entry order — user chose
-- "renumber them too"; a VRT code was stored nowhere else (checked: only vendor_returns.code).
-- `seq_vendor_return` is left in place, unused, so nothing that names it breaks.

drop trigger if exists trg_vrt_code on public.vendor_returns;
create trigger trg_vrt_code before insert on public.vendor_returns
  for each row execute function public.assign_code('DC', 'public.seq_dc');

-- A loop, not UPDATE … FROM (ordered subquery): only a loop guarantees nextval() follows entry order.
do $$
declare r record;
begin
  for r in select id from public.vendor_returns where code like 'VRT-%' order by created_at, code loop
    update public.vendor_returns
       set code = 'DC-' || lpad(nextval('public.seq_dc')::text, 4, '0')
     where id = r.id;
  end loop;
end $$;
