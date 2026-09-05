-- ============================================================================
-- Raagam ERP — 0537 Orders ▸ T&A ▸ Approvals — the order's own approval
-- tracker. One row per applicable approval per order.
--
-- row_uid IS THE ANCHOR, EXACTLY AS IN 0481. `writeChildren` deletes every
-- child row and reinserts on save; actual_sent_date, actual_received_date and
-- proof_path are entered on the merchandiser board, not on this order screen,
-- so they must be merged back by row_uid or an unrelated order edit destroys
-- every approval's tracking history silently. See 0481's own header for the
-- full argument — it is not repeated here.
--
-- target_date IS WRITTEN, NEVER COMPUTED HERE. For PP Sample specifically it
-- is copied from garment_order_amendment_ta_activities' PPAPPR row in the
-- SAME save (see lib/orders/amendments/actions.ts); for the other ~19
-- approvals it comes from lib/orders/ta/approval-schedule.ts's forward/
-- backward walk. Both are computed ONCE by the application and written down
-- — this table has no calculation of its own, on purpose.
-- ============================================================================

create table if not exists public.garment_order_amendment_ta_approvals (
  id            uuid primary key default gen_random_uuid(),
  amendment_id  uuid not null
                  references public.garment_order_amendments(id) on delete cascade,

  row_uid       uuid not null default gen_random_uuid(),

  approval_id   uuid references public.ta_approvals(id) on delete set null,

  target_date   date,

  actual_sent_date     date,
  actual_received_date date,
  proof_path            text,

  status        text not null default 'pending',

  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint garment_order_amendment_ta_approvals_status_check
    check (status in ('pending','sent','received'))
);

drop trigger if exists trg_goa_ta_approvals_updated
  on public.garment_order_amendment_ta_approvals;
create trigger trg_goa_ta_approvals_updated
  before update on public.garment_order_amendment_ta_approvals
  for each row execute function public.set_updated_at();

create unique index if not exists uq_goa_ta_approvals_row_uid
  on public.garment_order_amendment_ta_approvals (amendment_id, row_uid);

create index if not exists idx_goa_ta_approvals_amend
  on public.garment_order_amendment_ta_approvals (amendment_id);

-- The merchandiser board's own index: "what is due to be sent/received today
-- across every open order" — same reasoning as idx_goa_ta_activities_due.
create index if not exists idx_goa_ta_approvals_due
  on public.garment_order_amendment_ta_approvals (target_date, status);

comment on table public.garment_order_amendment_ta_approvals is
  'The order''s approval tracker (0537) — one row per applicable approval. '
  'target_date is WRITTEN by the application, never computed in SQL. Merged '
  'on save by row_uid, never replaced wholesale — see 0481 for why.';

do $rls$
begin
  alter table public.garment_order_amendment_ta_approvals enable row level security;

  create policy goa_ta_approvals_read on public.garment_order_amendment_ta_approvals
    for select to authenticated using (public.has_permission('orders','view'));
  create policy goa_ta_approvals_insert on public.garment_order_amendment_ta_approvals
    for insert to authenticated with check (public.has_permission('orders','create'));
  create policy goa_ta_approvals_update on public.garment_order_amendment_ta_approvals
    for update to authenticated using (public.has_permission('orders','edit'))
    with check (public.has_permission('orders','edit'));
  create policy goa_ta_approvals_delete on public.garment_order_amendment_ta_approvals
    for delete to authenticated using (public.has_permission('orders','delete'));
end $rls$;

do $verify$
declare
  n_pol   int;
  rls_on  boolean;
  a1      uuid;
  probe   uuid := gen_random_uuid();
  dup_refused boolean := false;
begin
  select c.relrowsecurity into rls_on
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'garment_order_amendment_ta_approvals';
  if not coalesce(rls_on, false) then
    raise exception '0537: row level security is not enabled';
  end if;

  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'garment_order_amendment_ta_approvals';
  if n_pol <> 4 then
    raise exception '0537: expected 4 policies, found %', n_pol;
  end if;

  select id into a1 from public.garment_order_amendments order by created_at limit 1;
  if a1 is null then
    raise notice '0537: no amendment to probe against — unique key NOT exercised';
    return;
  end if;

  insert into public.garment_order_amendment_ta_approvals (amendment_id, row_uid)
    values (a1, probe);
  begin
    insert into public.garment_order_amendment_ta_approvals (amendment_id, row_uid)
      values (a1, probe);
  exception when unique_violation then
    dup_refused := true;
  end;
  delete from public.garment_order_amendment_ta_approvals where row_uid = probe;

  if not dup_refused then
    raise exception '0537: one row_uid twice under one amendment was accepted';
  end if;

  raise notice '0537: ok — RLS on, 4 policies, unique key refuses a repeated row_uid';
end $verify$;
