-- ============================================================================
-- Raagam ERP — 0215 HR ▸ Statutory documents (ESI forms + Strength Correction)
-- [Lane B]  Additive (legacy EDP2: HRD ▸ "Form 3 / Form 5 / Form 10 (ESI)",
-- "Strength Corrections"). A statutory compliance record per employee; draft →
-- filed. Gated by the EXISTING 'hr_payroll' permission.
-- ============================================================================

create sequence if not exists public.seq_hr_statutory;
create table if not exists public.hr_statutory_docs (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                  -- STA-0001
  employee_type text not null check (employee_type in ('worker','staff','contractor')),
  employee_id   uuid not null,
  employee_name text,
  form_type     text not null
                  check (form_type in ('esi_form3','esi_form5','esi_form10','strength_correction')),
  reference_no  text,
  doc_date      date,
  notes         text,
  status        text not null default 'draft' check (status in ('draft','filed')),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_sta_code before insert on public.hr_statutory_docs
  for each row execute function public.assign_code('STA','public.seq_hr_statutory');
create trigger trg_sta_updated before update on public.hr_statutory_docs
  for each row execute function public.set_updated_at();
create index if not exists idx_sta_emp on public.hr_statutory_docs(employee_type, employee_id);

do $$
declare t text;
begin
  foreach t in array array['hr_statutory_docs'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('hr_payroll','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('hr_payroll','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('hr_payroll','edit')) with check (public.has_permission('hr_payroll','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('hr_payroll','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
