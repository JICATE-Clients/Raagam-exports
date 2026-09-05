-- ============================================================================
-- Raagam ERP — 0534 Orders ▸ T&A ▸ Approvals master.
--
-- `ta_approvals` — the ~20 standard approvals (Fit Sample, Photo Sample, Size
-- Set, SMS, Lap Dip, Strike-off, Trims, PP Sample, ...). Same shape as
-- `ta_activities` (sequence, is_active) plus what an approval needs that a
-- production step does not: which date it counts from, and whether a proof
-- file is required to mark it sent/received.
--
-- PP SAMPLE IS A ROW HERE, AND ITS `standard_days` IS NEVER USED TO COMPUTE
-- ITS OWN target_date. See `lib/orders/ta/approval-schedule.ts`'s own header:
-- PP Sample's date comes from the production backward-walk (Cutting − 1 day),
-- read out of `garment_order_amendment_ta_activities`, not computed here. This
-- row exists so the buyer-approval-defaults join table (0535) has something to
-- point PP Sample's BUYER LEAD TIME override at, and so the approvals tracker
-- (0537) has a name/proof-requirement to show. Two columns, one used by two
-- different engines for two different purposes — documented so a reader does
-- not "fix" the apparent dead column.
-- ============================================================================

create table if not exists public.ta_approvals (
  id              uuid primary key default gen_random_uuid(),

  -- CAPS, matching every stored value in this app since 2026-08-18.
  short_name      text not null,
  name            text not null,

  apply_condition text not null
                    check (apply_condition in ('AFTER_ORDER_DATE','BEFORE_SHIPMENT_DATE')),

  -- Default lead time in working days. A buyer's own row in
  -- customer_approval_defaults (0535) overrides this per customer; this is
  -- the fallback when no override exists.
  standard_days   int not null default 0,

  sequence        int not null default 0,

  -- Whether the merchandiser board requires a courier-slip/challan/email scan
  -- before this approval can be marked sent or received. Per-approval, not
  -- global: a StrikeOff round-trip might not need one, a PP Sample dispatch
  -- always does.
  requires_proof  boolean not null default true,

  is_active       boolean not null default true,

  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_ta_approvals_short_name
  on public.ta_approvals (upper(short_name));

comment on table public.ta_approvals is
  'The T&A approvals master (0534) — Fit Sample, Photo Sample, PP Sample, '
  'Lap Dip, Strike-off, Trims, etc. PP Sample''s standard_days is read by '
  'customer_approval_defaults only; its per-order target_date is computed by '
  'the PRODUCTION ladder (Cutting - 1 day), never by this table''s own '
  'apply_condition. See lib/orders/ta/approval-schedule.ts.';

-- ----------------------------------------------------------------------------
-- Seed the eight named approvals from the spec. Idempotent on short_name,
-- same guard shape as 0481's ta_activities seed.
-- ----------------------------------------------------------------------------
insert into public.ta_approvals
  (short_name, name, apply_condition, standard_days, sequence, requires_proof, is_active)
select v.short_name, v.name, v.apply_condition, v.standard_days, v.sequence, true, true
from (values
  ('FITSAMPLE',  'FIT SAMPLE',       'AFTER_ORDER_DATE',    7,  1),
  ('PHOTOSAMPLE','PHOTO SAMPLE',     'AFTER_ORDER_DATE',    10, 2),
  ('SIZESET',    'SIZE SET',         'AFTER_ORDER_DATE',    12, 3),
  ('SMS',        'SMS',              'AFTER_ORDER_DATE',    14, 4),
  ('LAPDIP',     'LAP DIP',          'BEFORE_SHIPMENT_DATE',45, 5),
  ('STRIKEOFF',  'STRIKE-OFF',       'BEFORE_SHIPMENT_DATE',45, 6),
  ('TRIMS',      'TRIMS APPROVAL',   'BEFORE_SHIPMENT_DATE',40, 7),
  ('PPSAMPLE',   'PP SAMPLE',        'BEFORE_SHIPMENT_DATE',0,  8)
) as v(short_name, name, apply_condition, standard_days, sequence)
where not exists (
  select 1 from public.ta_approvals a where upper(a.short_name) = v.short_name
);

-- ----------------------------------------------------------------------------
-- RLS — same 'orders' module permissions as every T&A table.
-- ----------------------------------------------------------------------------
do $rls$
begin
  alter table public.ta_approvals enable row level security;

  create policy ta_approvals_read on public.ta_approvals
    for select to authenticated using (public.has_permission('orders','view'));
  create policy ta_approvals_insert on public.ta_approvals
    for insert to authenticated with check (public.has_permission('orders','create'));
  create policy ta_approvals_update on public.ta_approvals
    for update to authenticated using (public.has_permission('orders','edit'))
    with check (public.has_permission('orders','edit'));
  create policy ta_approvals_delete on public.ta_approvals
    for delete to authenticated using (public.has_permission('orders','delete'));
end $rls$;

-- ----------------------------------------------------------------------------
-- Verify, from the catalog.
-- ----------------------------------------------------------------------------
do $verify$
declare
  n_seeded int;
  n_pol    int;
  rls_on   boolean;
begin
  select count(*) into n_seeded from public.ta_approvals
   where upper(short_name) in
     ('FITSAMPLE','PHOTOSAMPLE','SIZESET','SMS','LAPDIP','STRIKEOFF','TRIMS','PPSAMPLE');
  if n_seeded <> 8 then
    raise exception '0534: expected 8 seeded approvals, found %', n_seeded;
  end if;

  select c.relrowsecurity into rls_on
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'ta_approvals';
  if not coalesce(rls_on, false) then
    raise exception '0534: row level security is not enabled';
  end if;

  select count(*) into n_pol from pg_policies
   where schemaname = 'public' and tablename = 'ta_approvals';
  if n_pol <> 4 then
    raise exception '0534: expected 4 policies, found %', n_pol;
  end if;

  raise notice '0534: ok — ta_approvals seeded (8 rows), RLS on, 4 policies';
end $verify$;
