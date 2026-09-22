-- ============================================================================
-- Raagam ERP — 0580 The IWO number, shown BEFORE Save.
--
-- Client, 2026-09-18: opening a new Internal Work Order left the I.WO No box
-- blank — "why it need to display the actual IWO number in the field". The
-- legacy screen (2936) shows U2/IWO/2627/0005 the moment the form opens.
--
-- 0559 deliberately built no peek ("add one if/when the form grows a
-- preview"); this is that one. Same shape as `peek_sales_order_number` (0395),
-- which the Garment Order screen's SC No box already reads.
--
-- IT CALLS THE SAME TWO FUNCTIONS THE TRIGGER DOES — `iwo_no_format()` (0578)
-- and `fiscal_year_segment()` (0395) — so the box can never show a different
-- spelling or a different fiscal year from the number that gets saved.
--
-- A PREDICTION, NOT A RESERVATION. It reads the counter and never writes it:
-- opening a form and abandoning it burns no number. The cost is that two
-- operators entering at once at the same unit see the same number, and only
-- the first to save gets it — `assign_iwo_number()` stays the sole authority,
-- so the STORED number is always right. The screen swaps in the stored number
-- after Save.
-- ============================================================================

create or replace function public.peek_iwo_number(
  p_location_id uuid,
  p_on          date default null
)
returns text
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select public.iwo_no_format(
           l.code,
           public.fiscal_year_segment(coalesce(p_on, current_date)),
           coalesce(
             (select c.last_no
                from public.iwo_no_counters c
               where c.location_id = p_location_id
                 and c.fy = public.fiscal_year_segment(coalesce(p_on, current_date))),
             0) + 1)
    from public.locations l
   where l.id = p_location_id;
$$;

comment on function public.peek_iwo_number(uuid, date) is
  'The IWO number the next work order raised at p_location_id dated p_on WOULD '
  'receive (0580). Reads iwo_no_counters, never writes it — a prediction, not a '
  'reservation; assign_iwo_number() alone assigns. NULL for an unknown location.';

revoke all on function public.peek_iwo_number(uuid, date) from public, anon;
grant execute on function public.peek_iwo_number(uuid, date) to authenticated;

do $$
declare
  v_u2 uuid := (select id from public.locations where code = 'U2');
begin
  if has_function_privilege('anon', 'public.peek_iwo_number(uuid, date)', 'EXECUTE') then
    raise exception '0580: peek_iwo_number is executable by anon';
  end if;
  if v_u2 is not null
     and public.peek_iwo_number(v_u2, date '2026-09-18') !~ '^U2/IWO/2627/[0-9]{4,}$' then
    raise exception '0580: peek for U2 on 2026-09-18 = %, expected U2/IWO/2627/nnnn',
      public.peek_iwo_number(v_u2, date '2026-09-18');
  end if;
end $$;
