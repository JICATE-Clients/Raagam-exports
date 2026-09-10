-- ============================================================================
-- Raagam ERP — 0535 which approvals apply to which buyer, and at what lead
-- time.
--
-- BACKFILLED ONTO MAIN (2026-09-09) — see 0534's header for why. Content
-- unchanged from the worktree original; policy creation is additionally
-- guarded so this file is a true no-op against a database where the table
-- and policies already exist (as they do on this session's dev database).
--
-- Same shape and reasoning as customer_nominated_vendors: a buyer's list is
-- maintained on the Customer master, and an order for that buyer seeds its
-- approval list from here. `customer_id`, matching the nominated-vendor
-- precedent (AGENTS.md ▸ Nominated vendors) — never `buyer_id`: nominations
-- and buyer-level defaults both hang off `customers`, not the `buyers`
-- scaffold spine.
-- ============================================================================

create table if not exists public.customer_approval_defaults (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers(id) on delete cascade,
  approval_id    uuid not null references public.ta_approvals(id) on delete cascade,

  -- Overrides ta_approvals.standard_days for THIS buyer. A local Tirupur
  -- buyer might be 1-2 days; an international buyer with a courier/transit
  -- buffer might be 10+. Not nullable: 0 is a real, valid "no buffer" answer,
  -- and a NULL here would be ambiguous between "not set" and "zero days" —
  -- the row's mere EXISTENCE is what "applies" means, so there is nothing
  -- else for null to mean.
  lead_time_days int not null default 0,

  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),

  unique (customer_id, approval_id)
);

create index if not exists idx_customer_approval_defaults_customer
  on public.customer_approval_defaults (customer_id);

comment on table public.customer_approval_defaults is
  'Which ta_approvals apply to which customer by default, and that '
  'customer''s own lead-time override (0535). A row existing IS "this '
  'approval applies to this buyer" — there is no separate boolean.';

do $rls$
begin
  alter table public.customer_approval_defaults enable row level security;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_approval_defaults' and policyname='customer_approval_defaults_read') then
    create policy customer_approval_defaults_read on public.customer_approval_defaults
      for select to authenticated using (public.has_permission('orders','view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_approval_defaults' and policyname='customer_approval_defaults_insert') then
    create policy customer_approval_defaults_insert on public.customer_approval_defaults
      for insert to authenticated with check (public.has_permission('orders','create'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_approval_defaults' and policyname='customer_approval_defaults_update') then
    create policy customer_approval_defaults_update on public.customer_approval_defaults
      for update to authenticated using (public.has_permission('orders','edit'))
      with check (public.has_permission('orders','edit'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customer_approval_defaults' and policyname='customer_approval_defaults_delete') then
    create policy customer_approval_defaults_delete on public.customer_approval_defaults
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

do $verify$
declare
  n_pol  int;
  rls_on boolean;
begin
  select c.relrowsecurity into rls_on
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'customer_approval_defaults';
  if not coalesce(rls_on, false) then
    raise exception '0535: row level security is not enabled';
  end if;

  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'customer_approval_defaults';
  if n_pol <> 4 then
    raise exception '0535: expected 4 policies, found %', n_pol;
  end if;

  raise notice '0535: ok — RLS on, 4 policies';
end $verify$;
