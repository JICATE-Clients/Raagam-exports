-- ============================================================================
-- Raagam ERP — 0041 Record Audit (field-level change history)
-- A generic AFTER INSERT/UPDATE/DELETE trigger captures who changed a record,
-- when, and the OLD → NEW values (previous values) for every core business
-- table — automatically, on any write path. Complements the existing
-- app-level event log (audit_log / writeAudit). Read-gated to system_admin.
-- ADD-ONLY: new table + function + triggers; touches no existing objects.
-- ============================================================================

create table if not exists public.record_audit (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,
  record_id     uuid,
  operation     text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id      uuid references public.profiles(id),
  old_data      jsonb,
  new_data      jsonb,
  changed_fields text[],
  created_at    timestamptz not null default now()
);

create index if not exists idx_record_audit_record
  on public.record_audit (table_name, record_id, created_at desc);
create index if not exists idx_record_audit_created
  on public.record_audit (created_at desc);
create index if not exists idx_record_audit_actor
  on public.record_audit (actor_id);

alter table public.record_audit enable row level security;

-- Read-only for system admins (rows are written by the SECURITY DEFINER trigger,
-- so no INSERT policy is needed).
create policy record_audit_read on public.record_audit
  for select to authenticated
  using (public.has_permission('system_admin', 'view'));

-- ---------- the generic capture trigger --------------------------------------
create or replace function public.audit_record_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_record_id uuid;
begin
  if (tg_op = 'DELETE') then
    v_old := to_jsonb(old);
    v_record_id := (old).id;
  elsif (tg_op = 'INSERT') then
    v_new := to_jsonb(new);
    v_record_id := (new).id;
  else -- UPDATE
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record_id := (new).id;
    -- fields whose value actually changed (ignore the updated_at bookkeeping col)
    select array_agg(n.key order by n.key)
      into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key)
      and n.key <> 'updated_at';
    -- nothing meaningful changed (e.g. only updated_at bumped) → don't log
    if v_changed is null then
      return new;
    end if;
  end if;

  insert into public.record_audit(
    table_name, record_id, operation, actor_id, old_data, new_data, changed_fields
  ) values (
    tg_table_name, v_record_id, tg_op, auth.uid(), v_old, v_new, v_changed
  );

  return coalesce(new, old);
end;
$$;
revoke execute on function public.audit_record_change() from public, anon, authenticated;

-- ---------- attach to core business tables (guarded by existence) ------------
do $$
declare t text;
begin
  foreach t in array array[
    'opportunities', 'quotes', 'sales_orders', 'order_amendments', 'budgets',
    'purchase_orders', 'grns', 'purchase_indents', 'payables', 'receivables',
    'journal_entries', 'shipments', 'proforma_invoices', 'workers',
    'payroll_runs', 'production_job_orders', 'process_jobs', 'buyers', 'items'
  ] loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('drop trigger if exists trg_audit_%1$s on public.%1$s', t);
      execute format(
        'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s '
        || 'for each row execute function public.audit_record_change()', t);
    end if;
  end loop;
end $$;
