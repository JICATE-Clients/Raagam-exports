-- =============================================================================
-- 0355 — Point every state_id at the State master instead of config_lookups
-- -----------------------------------------------------------------------------
-- LIVE BUG, found 2026-07-28. Seven address-bearing tables declare
--
--     state_id uuid references public.config_lookups(id) on delete set null
--
-- from their original migrations (0238, 0239, 0240, 0245, 0246, 0252, 0318),
-- and no later migration repointed them. But States became a master of their own
-- in 0262, and the screens now feed every State picker from `public.states` —
-- `app/(app)/masters/[submodule]/[entity]/page.tsx` calls `listStates()` and maps
-- it through `statesAsLookups()` (lib/masters/lookup-compat.ts), which only
-- reshapes a `states` row to look like a ConfigLookup. Nothing anywhere reads
-- `config_lookups` where kind = 'state'.
--
-- It has not blown up yet purely by coincidence: there is exactly ONE state on
-- file — Tamil Nadu, code 33 — and it happens to exist in BOTH tables under the
-- SAME uuid (974bf3cd-dcfb-40f6-b787-a64139ffc9bd), so the constraint is
-- satisfied. The first state added through Masters ▸ GST ▸ State lands only in
-- `public.states`, and selecting it fails every save with a foreign-key
-- violation — on a field the operator has no way to connect to the error.
--
-- Cheap now, expensive later: ONE row across all seven tables currently carries
-- a state_id (an applicant), and it already resolves in `public.states`, so this
-- is a pure constraint swap with no data migration. Left until the masters are
-- populated, it becomes a data-repair job across every customer, vendor and
-- consignee address on file.
--
-- SCOPE — deliberately narrow:
--   * `city_id` is NOT touched. Cities genuinely are config_lookups rows
--     (kind = 'city'); there is no city master. Those six FKs are correct.
--   * ON DELETE SET NULL is PRESERVED rather than tightened to RESTRICT. This
--     migration does one thing. Deleting an in-use state is already blocked at
--     the application layer by the deleteOrDeactivate / first_referencing_table
--     guard from 0344, so the DB rule is a backstop, not the primary defence.
--     Tightening it is a separate, arguable change.
--   * The vestigial `config_lookups` row with kind = 'state' is left in place.
--     After this migration nothing can reference it and nothing reads it, but
--     deleting live data is not required to fix the constraint and is not this
--     migration's job.
-- =============================================================================

do $$
declare
  t text;
  orphans bigint;
begin
  foreach t in array array[
    'applicants',
    'company_profile',
    'consignees',
    'courier_delivery_addresses',
    'customers',
    'master_vendor_addresses',
    'notifies'
  ] loop
    -- Fail loudly rather than half-applying. If some row points at a
    -- config_lookups entry that is not in `states`, the ALTER below would abort
    -- anyway; this raises a message naming the table so the cause is obvious.
    execute format(
      'select count(*) from public.%I x
        where x.state_id is not null
          and not exists (select 1 from public.states s where s.id = x.state_id)',
      t
    ) into orphans;

    if orphans > 0 then
      raise exception
        '0355: %.state_id has % row(s) pointing outside public.states — resolve these before repointing the FK',
        t, orphans;
    end if;

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_state_id_fkey');
    execute format(
      'alter table public.%I
         add constraint %I foreign key (state_id)
         references public.states(id) on delete set null',
      t, t || '_state_id_fkey'
    );
  end loop;
end $$;

comment on column public.customers.state_id is
  'FK to public.states (the State master), NOT config_lookups — see 0355.';
comment on column public.consignees.state_id is
  'FK to public.states (the State master), NOT config_lookups — see 0355.';
comment on column public.master_vendor_addresses.state_id is
  'FK to public.states (the State master), NOT config_lookups — see 0355.';
