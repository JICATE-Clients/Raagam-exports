-- ============================================================================
-- Raagam ERP — 0016 System Integration
-- Tally Prime XML export batches (sales invoices, customer orders, purchase
-- orders, supplier payments) triggered manually by admin/accounts; exported
-- records are tracked so they can be shown in an "Exported" section and
-- re-exported. Daily crisis summary + unified MD approval digest are COMPUTED
-- (read-only across modules) — no tables needed for them.
-- ============================================================================

create sequence if not exists public.seq_tally_export;
create table if not exists public.tally_exports (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  export_type   text not null check (export_type in
                  ('sales_invoices','customer_orders','purchase_orders',
                   'supplier_payments','all')),
  period_start  date,
  period_end    date,
  format        text not null default 'tally_xml',
  record_count  int not null default 0,
  status        text not null default 'generated' check (status in ('generated','failed')),
  error_message text,
  xml_content   text,                       -- the generated Tally XML
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create trigger trg_tallyexp_code before insert on public.tally_exports
  for each row execute function public.assign_code('EXP','public.seq_tally_export');
create index if not exists idx_tallyexp_created on public.tally_exports(created_at desc);

-- which source records went into an export (for the "Exported" section + replace)
create table if not exists public.tally_export_items (
  id          uuid primary key default gen_random_uuid(),
  export_id   uuid not null references public.tally_exports(id) on delete cascade,
  entity_type text not null,   -- receivable | sales_order | purchase_order | payable_payment
  entity_id   uuid not null,
  exported_at timestamptz not null default now()
);
create index if not exists idx_tallyitems_export on public.tally_export_items(export_id);
create index if not exists idx_tallyitems_entity on public.tally_export_items(entity_type, entity_id);

-- ---------- RLS (gated by 'integration') ----------
do $$
declare t text;
begin
  foreach t in array array['tally_exports','tally_export_items'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('integration','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('integration','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('integration','edit'))
        with check (public.has_permission('integration','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('integration','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- grants ----------
-- Accountant + admin/accounts trigger Tally exports (PRD)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'integration' and p.action in ('view','create','export')
where r.name = 'Accountant' on conflict do nothing;

-- Manager / MD see the dashboards (approvals digest, crisis summary)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'integration' and p.action = 'view'
where r.name = 'Manager' on conflict do nothing;
