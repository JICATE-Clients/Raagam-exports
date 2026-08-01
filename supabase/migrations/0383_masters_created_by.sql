-- ============================================================================
-- Raagam ERP — 0383  Masters: created_by everywhere
--
-- Every MASTER table gains
--     created_by uuid references public.profiles(id) default auth.uid()
-- so "Created User" is answerable on every listing screen (client 2026-08-01).
-- Child / detail tables are out of scope: a line's creator is its parent's, and
-- 0333/0334 already state that convention.
--
-- FOUR THINGS THIS DELIBERATELY DOES NOT DO
--
--  1. It does not touch a table that already has a `created_by` of ANY type.
--     That is what protects the seven legacy `text` columns — config_lookups,
--     processes, components, items, exchange_rate_details — whose verbatim
--     usernames ("SELVARAJ", "admin") are NOT Supabase Auth accounts and must
--     stay readable. See 0290 for that decision.
--
--  2. It does not touch a table with no `created_at`. The UI gate is
--     `rows.some(r => r.created_at != null)` — column and filter appear
--     together — so a creator with no creation date could never be displayed.
--     This drops `uoms`, `currencies` and the join tables automatically.
--
--  3. It does not backfill. A row created before the column existed has no
--     creator to name; it renders "—". Inventing one would be a lie in an
--     audit column.
--
--  4. It does not add NOT NULL. A service-role insert has no `auth.uid()`, and
--     a masters import that hard-fails is worse than a blank column.
--
-- The table list below is derived from what the app actually LISTS
-- (lib/masters/*-service.ts), not from the schema. A schema-wide loop would
-- have put an FK and an auth.uid() default on all 464 tables, ledgers included.
-- ============================================================================

-- ---------------------------------------------------------------- 0. safety
-- Every FK added below points at public.profiles. An auth user with no profile
-- row would make EVERY master insert fail with a 23503 the operator cannot
-- read. `handle_new_user` (0001) should make this a no-op; it is here because
-- "should" is not a guarantee and the failure mode is total.
insert into public.profiles (id, email, phone, full_name)
select u.id, u.email, u.phone, u.raw_user_meta_data->>'full_name'
from auth.users u
on conflict (id) do nothing;

-- ------------------------------------------- 1. add the column where missing
do $$
declare
  t text;
  master_tables constant text[] := array[
    -- Associates
    'applicants','banks','bank_branches','buyers','consignees','customers',
    'master_vendors','vendors','notifies','transporters','couriers',
    'courier_delivery_addresses','merchandising_teams','our_banks',
    -- Materials
    'attributes','categories','certifications','commodities','components',
    'compositions','defect_details','defect_groups','garment_rejection_rules',
    'hsn_details','material_attributes','seasons','size_groups','uoms',
    'yarn_compositions','colors','shades','styles',
    -- Geography / logistics
    'countries','states','destinations','ports','zones','locations','stores',
    'bins',
    -- HR
    'advance_loan_types','allowances','deductions','departments','designations',
    'divisions','employees','employee_categories','holidays','hostel_categories',
    'leave_types','pf_esi_controls','work_timings','working_hours','workers',
    'staff',
    -- Finance / commercial
    'account_groups','account_heads','default_account_heads','cost_centres',
    'gl_accounts','payment_terms','receivable_terms','out_document_terms',
    'document_no_formats','exchange_rate_entries','levies'
  ];
begin
  foreach t in array master_tables loop
    -- 0381/0382 dropped masters and more will go; a stale name here must not
    -- abort the other fifty.
    if to_regclass('public.' || t) is null then
      raise notice '0383 skip %: table does not exist', t;
      continue;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'created_by'
    ) then
      raise notice '0383 skip %: already has created_by', t;   -- incl. the text ones
      continue;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'created_at'
    ) then
      raise notice '0383 skip %: no created_at, so the pair could never show', t;
      continue;
    end if;

    execute format(
      'alter table public.%I add column created_by uuid '
      'references public.profiles(id) default auth.uid()', t);
    raise notice '0383 added created_by to %', t;
  end loop;
end $$;

-- ------------------- 2. give the 0333/0334 tables the default they never had
-- Twenty-six tables declared `created_by uuid references public.profiles(id)`
-- with NO default, and nothing ever set it — `simple-master-actions.ts` inserts
-- only {code, name, is_active} — so the column has been 100% NULL since it
-- shipped. Scoped to uuid columns that have no default, so the seven text ones
-- and anything already defaulted are untouched.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name  = 'created_by'
      and c.data_type    = 'uuid'
      and c.column_default is null
      and tb.table_type  = 'BASE TABLE'
  loop
    execute format(
      'alter table public.%I alter column created_by set default auth.uid()',
      r.table_name);
    raise notice '0383 defaulted created_by on %', r.table_name;
  end loop;
end $$;

-- ------------------------------------------------- 3. name resolution vs RLS
-- `profiles_read_own` (0001_foundation.sql:150) lets a user select only their
-- OWN profile row unless they hold system_admin:view. So the PostgREST embed
-- `creator:profiles!created_by(full_name)` — the pattern in levy-service,
-- category-service and orders/approve-amendments — resolves to NULL for every
-- record created by anybody else. It has looked fine only because created_by
-- was NULL on those tables; the moment part 1 starts populating it, that embed
-- would show "—" to every non-admin in the company.
--
-- SECURITY DEFINER is therefore not a shortcut here, it is the fix. The
-- function returns nothing but an id and a display name — no email, no phone,
-- no employee_code, no is_super_admin — so it cannot become a way to read the
-- staff directory.
create or replace function public.creator_names(ids uuid[])
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1))
  from public.profiles p
  where p.id = any(ids);
$$;

revoke all on function public.creator_names(uuid[]) from public;
grant execute on function public.creator_names(uuid[]) to authenticated;

comment on function public.creator_names(uuid[]) is
  'Batch uuid -> display name for Created User columns. SECURITY DEFINER '
  'because profiles_read_own (0001) hides other users'' profiles from a '
  'non-admin, which silently breaks a PostgREST embed on profiles.';
