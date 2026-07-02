-- ============================================================================
-- Raagam ERP — 0039 Purchase ▸ Lab / QC
-- Additive sub-module (legacy EDP2: Materials ▸ Lab — Test Standard · Test ·
-- Test Standard for Customer/Order · Requisition · In-House Test Report ·
-- Issue to / Receipt from Outside Lab). Two tables: test standards (master) and
-- test reports (in-house or outside, with issue→result flow). Gated by the
-- EXISTING 'materials_purchase' permission (Lab lives under Purchase per the map).
-- ============================================================================

create sequence if not exists public.seq_lab_standard;
create table if not exists public.lab_test_standards (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- LTS-0001
  name           text not null,
  parameter      text,
  method         text,
  spec_min       numeric(14,4),
  spec_max       numeric(14,4),
  unit           text,
  applies_to     text not null default 'general'
                   check (applies_to in ('general','customer','order')),
  buyer_id       uuid references public.buyers(id) on delete set null,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_lts_code before insert on public.lab_test_standards
  for each row execute function public.assign_code('LTS','public.seq_lab_standard');
create trigger trg_lts_updated before update on public.lab_test_standards
  for each row execute function public.set_updated_at();
create index if not exists idx_lts_applies on public.lab_test_standards(applies_to);

create sequence if not exists public.seq_lab_test;
create table if not exists public.lab_tests (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,                           -- LTT-0001
  standard_id           uuid references public.lab_test_standards(id) on delete set null,
  sales_order_id        uuid references public.sales_orders(id) on delete set null,
  item_id               uuid references public.items(id) on delete set null,
  sample_ref            text,
  mode                  text not null default 'in_house'
                          check (mode in ('in_house','outside')),
  outside_lab_vendor_id uuid references public.vendors(id) on delete set null,
  requisition_ref       text,
  status                text not null default 'draft'
                          check (status in ('draft','issued','passed','failed')),
  result_value          numeric(14,4),
  result_note           text,
  tested_date           date,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ltt_code before insert on public.lab_tests
  for each row execute function public.assign_code('LTT','public.seq_lab_test');
create trigger trg_ltt_updated before update on public.lab_tests
  for each row execute function public.set_updated_at();
create index if not exists idx_ltt_status on public.lab_tests(status);

do $$
declare t text;
begin
  foreach t in array array['lab_test_standards','lab_tests'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('materials_purchase','edit')) with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
