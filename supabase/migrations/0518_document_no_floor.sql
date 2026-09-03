-- ============================================================================
-- Raagam ERP — 0518 A reclaimed number may never fall below the CUTOVER FLOOR
--
-- 0516 made the serial follow the rows so that clearing test orders restarts at
-- 0001 (client 2026-09-03). Correct for Head Office, and it silently defeated a
-- decision the client took on 2026-08-23 for Unit 2.
--
-- ---------------------------------------------------------------------------
-- WHAT 0516 BROKE, AND WHY NOTHING WOULD HAVE SAID SO.
--
-- RP Software has been issuing this same SC No format all year. Unit 2's
-- imported order book tops out at 2086, so the client chose strategy 2 (JUMP)
-- and seeded `sales_order_no_counters` at 2100 — the next Raagam order is
-- U2/RE/26-27/2101, with ~14 of headroom over anything legacy might have
-- issued that was never imported (the import is a PENDING-BALANCE report, so a
-- shipped or cancelled order is not in it and still consumed its number).
--
-- 0516's rule is "if the counter has run ahead of the rows, pull it back". A
-- cutover seed IS a counter deliberately ahead of the rows. So the JUMP became
-- unrepresentable: set 2100, get 2087 — straight back into the band the gap
-- exists to clear. Re-running `supabase/seed/sales-order-no-cutover.sql` would
-- have looked like it worked and changed nothing.
--
-- AND THE COLLISION WOULD NOT BE CAUGHT. The two eras are different STRINGS:
--
--     legacy   U2/RE//2627/2087    double slash, undashed year
--     ours     U2/RE/26-27/2087    single slash, dashed
--
-- `sales_orders_order_number_key` sees no conflict. What duplicates is the
-- number the floor actually quotes — two live orders called 2087 in one year,
-- with nothing refusing either. A loud constraint violation would have been the
-- good outcome.
--
-- THE LIVE COUNTER WAS ALREADY AT 2086, NOT 2100, when this was written — the
-- 08-23 seed had been overwritten by something between then and now. So the
-- exposure predates 0516; what 0516 added was making it unfixable by the means
-- the seed file documents. Both halves are closed here.
--
-- ---------------------------------------------------------------------------
-- THE FIX: A FLOOR, NOT A SPECIAL CASE.
--
-- `floor_no` on each counter — "no serial at or below this may ever be issued
-- here again, whatever the rows say". The rule becomes
--
--     next = greatest(floor_no, <0516's answer>) + 1
--
-- and 0516's answer is unchanged underneath it. Head Office's floor is 0, so
-- clearing every test order still gives 0001. Unit 2's is 2100, so clearing
-- every U2 order STILL gives 2101 — which is the point: the floor is a
-- statement about what RP SOFTWARE issued, not about what rows we hold, and it
-- must survive a table being emptied.
--
-- A COLUMN RATHER THAN A CONSTANT IN A FUNCTION, because it is per (location,
-- year) and because Head Office is still exposed: the client's legacy
-- screenshots show HO/RE//2627/0001, so RP issued HO numbers too, and no HO
-- legacy rows were ever imported — there is no high-water mark to read and none
-- has been supplied. HO's floor stays 0 today, deliberately, because that is
-- what the operator is currently testing against. When RP gives the figure it
-- is one UPDATE, not a migration.
--
-- IT ALSO SURVIVES WHAT ERASED THE FIRST SEED. `last_no` is written by the
-- assigner on every insert; `floor_no` is written by nothing but a human
-- decision, so a counter reset, a re-import or a bad `on conflict … do update`
-- cannot quietly lower it.
--
-- ADDITIVE AND IDEMPOTENT: `add column if not exists`, `create or replace`, and
-- an `on conflict` that raises the floor rather than setting it — a floor is a
-- ratchet, and a re-run with a smaller number must not lower one.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The column, on both counters.
-- ---------------------------------------------------------------------------
alter table public.sales_order_no_counters
  add column if not exists floor_no int not null default 0;

alter table public.garment_style_code_counters
  add column if not exists floor_no int not null default 0;

comment on column public.sales_order_no_counters.floor_no is
  'The cutover high-water mark: no serial at or below this is ever issued at '
  'this location and year again, whatever rows the table holds. 0 = no legacy '
  'numbering to clear. It is what makes the client''s 2026-08-23 JUMP strategy '
  'survive 0516''s follow-the-rows rule AND survive the orders being deleted — '
  'it states what RP Software issued, not what we hold. Written only by a human '
  'decision; the assigner touches last_no, never this.';

comment on column public.garment_style_code_counters.floor_no is
  'The cutover high-water mark for the style serial — see the same column on '
  'sales_order_no_counters. 0 everywhere today: no legacy style codes were ever '
  'imported. Present so the two documents cannot drift in how they are numbered.';


-- ---------------------------------------------------------------------------
-- 2. The rule, with the floor over the top of it.
--
-- 0516's expression is untouched inside the `greatest` — this raises a bound,
-- it does not re-decide anything.
-- ---------------------------------------------------------------------------
create or replace function public.next_sales_order_serial(
  p_location_id uuid,
  p_fy          text
)
returns int
language sql
stable
set search_path = pg_catalog, public
as $$
  select greatest(
           floor_no,
           case
             when public.document_no_reclaims() and counter > in_use then in_use
             else greatest(counter, in_use)
           end
         ) + 1
  from (
    select
      coalesce((select c.last_no
                  from public.sales_order_no_counters c
                 where c.location_id = p_location_id and c.fy = p_fy), 0) as counter,
      coalesce((select c.floor_no
                  from public.sales_order_no_counters c
                 where c.location_id = p_location_id and c.fy = p_fy), 0) as floor_no,
      public.sales_order_serial_in_use(p_location_id, p_fy)               as in_use
  ) s;
$$;

comment on function public.next_sales_order_serial(uuid, text) is
  'The serial the next order at this location and fiscal year would receive. '
  'THE one definition — assign_order_number() records what this says and '
  'peek_sales_order_number() shows it, so a preview cannot differ from the '
  'number saved (0395''s rule). Follows the rows while document_no_reclaims() '
  'is true (0516), but NEVER below floor_no (0518), which is the legacy cutover '
  'high-water mark and must survive the table being emptied.';

revoke all on function public.next_sales_order_serial(uuid, text) from public, anon;
grant execute on function public.next_sales_order_serial(uuid, text) to authenticated;


create or replace function public.next_garment_style_serial(p_fy text)
returns int
language sql
stable
set search_path = pg_catalog, public
as $$
  select greatest(
           floor_no,
           case
             when public.document_no_reclaims() and counter > in_use then in_use
             else greatest(counter, in_use)
           end
         ) + 1
  from (
    select
      coalesce((select c.last_no
                  from public.garment_style_code_counters c
                 where c.fy = p_fy), 0)         as counter,
      coalesce((select c.floor_no
                  from public.garment_style_code_counters c
                 where c.fy = p_fy), 0)         as floor_no,
      public.garment_style_serial_in_use(p_fy)  as in_use
  ) s;
$$;

comment on function public.next_garment_style_serial(text) is
  'The serial the next garment style of this fiscal year would receive. THE '
  'one definition — assign_garment_style_code() records it and '
  'peek_garment_style_code() shows it. Follows the rows (0516) but never below '
  'floor_no (0518).';

revoke all on function public.next_garment_style_serial(text) from public, anon;
grant execute on function public.next_garment_style_serial(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Restore the client's 2026-08-23 cutover for Unit 2.
--
-- Not a new decision: strategy 2, floor 2100, taken with the analysis in front
-- of them and recorded in supabase/seed/sales-order-no-cutover.sql. The live
-- counter had drifted back to 2086 and the seed no longer had any way to hold.
--
-- A RATCHET. `greatest(...)` in the DO UPDATE, so re-running this — or the seed
-- file — can raise a floor and never lower one. A placeholder that silently
-- lowered a live counter is exactly the hazard that file already records.
--
-- HEAD OFFICE IS DELIBERATELY NOT GIVEN A FLOOR. RP issued HO numbers too and
-- no high-water mark exists for them; inventing one would either strand the
-- operator's current 0001 testing or under-guess and mint a duplicate. It stays
-- an open question for RP Software, and 0 is the honest placeholder.
-- ---------------------------------------------------------------------------
insert into public.sales_order_no_counters (location_id, fy, last_no, floor_no)
select l.id, '2627', 0, 2100
  from public.locations l
 where l.code = 'U2'
    on conflict (location_id, fy) do update
       set floor_no = greatest(public.sales_order_no_counters.floor_no, excluded.floor_no);


-- ---------------------------------------------------------------------------
-- 4. Self-verification. Read the DATA, never this file.
-- ---------------------------------------------------------------------------
do $$
declare
  v_u2 uuid;
  v_ho uuid;
  v_n  int;
begin
  select id into v_u2 from public.locations where code = 'U2';
  select id into v_ho from public.locations where code = 'HO';

  -- 4a. THE CUTOVER HOLDS. This is the assertion 0516 needed and did not have.
  if v_u2 is not null then
    v_n := public.next_sales_order_serial(v_u2, '2627');
    if v_n <= 2100 then
      raise exception
        '0518: the next U2 serial is %, which is at or below the 2100 cutover '
        'floor. The client''s 2026-08-23 JUMP is not holding and a Raagam order '
        'could take a number RP Software already issued.', v_n;
    end if;
  end if;

  -- 4b. AND IT HOLDS WITH THE ROWS GONE, which is the whole difference between
  --     a floor and a counter. Deleting every U2 order must NOT free 2101.
  if v_u2 is not null then
    if (select floor_no from public.sales_order_no_counters
         where location_id = v_u2 and fy = '2627') <> 2100 then
      raise exception '0518: U2''s floor is not 2100.';
    end if;
  end if;

  -- 4c. HEAD OFFICE IS UNAFFECTED — the operator is testing against 0001 and a
  --     floor leaking onto HO would strand them at a number they cannot reach.
  if v_ho is not null then
    if coalesce((select floor_no from public.sales_order_no_counters
                  where location_id = v_ho and fy = '2627'), 0) <> 0 then
      raise exception
        '0518: Head Office has picked up a floor. It has no legacy high-water '
        'mark and must stay at 0 until RP Software supplies one.';
    end if;
  end if;

  raise notice '0518 OK — next U2 serial %, HO floor 0.',
    public.next_sales_order_serial(v_u2, '2627');
end;
$$;
