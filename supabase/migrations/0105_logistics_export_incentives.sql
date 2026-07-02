-- ============================================================================
-- Raagam ERP — 0105 Logistics ▸ Export Incentives File
-- Commercial lane (band 0100–0199). Additive sub-module of Logistics
-- (legacy EDP2: Logistics ▸ Export Incentives ▸ "Export Incentive File").
-- Government export-incentive claim (RoDTEP / Drawback / RoSCTL). Gated by 'logistics'.
-- ============================================================================

create sequence if not exists public.seq_export_incentive;
create table if not exists public.export_incentive_files (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                             -- EIF-0001 (assign_code)
  scheme            text not null default 'rodtep'
                      check (scheme in ('rodtep','drawback','rosctl','other')),
  shipping_bill_no  text,
  invoice_ref       text,
  currency_code     text references public.currencies(code),
  fob_value         numeric(16,2) not null default 0,
  incentive_rate    numeric(7,3) not null default 0,          -- percent
  incentive_amount  numeric(16,2) not null default 0,
  filing_date       date,
  reference_no      text,
  status            text not null default 'draft'
                      check (status in ('draft','filed','received','rejected')),
  remarks           text,
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_eif_code before insert on public.export_incentive_files
  for each row execute function public.assign_code('EIF','public.seq_export_incentive');
create trigger trg_eif_updated before update on public.export_incentive_files
  for each row execute function public.set_updated_at();
create index if not exists idx_eif_status on public.export_incentive_files(status);
create index if not exists idx_eif_scheme on public.export_incentive_files(scheme);

-- ---------- RLS (reuse the existing 'logistics' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['export_incentive_files'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('logistics','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('logistics','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('logistics','edit'))
        with check (public.has_permission('logistics','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('logistics','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
