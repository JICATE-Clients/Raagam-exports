-- 0624 — NEW REVISION ENTRIES ARE NUMBERED REV/…, NOT AMD/… (user 2026-09-24,
-- screenshot 3049: the page says Order Revisions, the button Raise Revision,
-- the badge Rev #4 — and the entry number still AMD/26-27/0004).
--
-- 0623 renamed every LABEL to "Revision" and kept the AMD numbering on purpose,
-- so no stored number or link changed. This keeps that promise and changes only
-- what is MINTED from now on:
--
--   * the 4 existing entries keep their AMD/… numbers — a document number is
--     never rewritten after it has been printed and quoted;
--   * a new entry is REV/<fy>/<n>, and <n> CONTINUES the year's one count across
--     BOTH prefixes. After AMD/26-27/0004 comes REV/26-27/0005, never a second
--     "0004" that differs only by its prefix.
--
-- Everything else in 0604's function is unchanged: financial year April–March
-- in Asia/Kolkata, four digits, minted not sequenced (`uq_obr_entry_no` refuses
-- a same-instant collision). `create or replace` keeps the function's grants.

create or replace function public.next_order_amendment_no()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with fy as (
    select case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
                then extract(year from (now() at time zone 'Asia/Kolkata'))::int
                else extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1
           end as y
  ),
  yy as (
    select y, to_char(y % 100, 'FM00') || '-' || to_char((y + 1) % 100, 'FM00') as tag from fy
  )
  select 'REV/' || yy.tag
         || '/' || to_char(coalesce(max(substring(r.entry_no from '(\d+)$')::int), 0) + 1, 'FM0000')
    from yy
    left join public.order_budget_revisions r
      on r.entry_no like 'AMD/' || yy.tag || '/%'
      or r.entry_no like 'REV/' || yy.tag || '/%'
   group by yy.tag;
$$;

do $$
begin
  if public.next_order_amendment_no() not like 'REV/__-__/____' then
    raise exception '0624: next_order_amendment_no() did not mint a REV number: %',
      public.next_order_amendment_no();
  end if;
end $$;
