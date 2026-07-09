-- ============================================================================
-- Raagam ERP — 0257 Master Data ▸ HR ▸ Advance and Loan Type
-- Legacy EDP2 "Advance and Loan Type" form (Configure ▸ HR): Short Name ·
-- Blocked · Description · Type (Salary Advance / Monthly Repayment / Loan).
-- Flat master. RLS = masters.
-- ============================================================================

create table if not exists public.advance_loan_types (
  id          uuid primary key default gen_random_uuid(),
  short_name  text not null,
  description text,
  loan_type   text not null default 'Salary Advance'
                check (loan_type in ('Salary Advance','Monthly Repayment','Loan')),
  blocked     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_advance_loan_types_updated before update on public.advance_loan_types
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy advance_loan_types_read on public.advance_loan_types for select to authenticated using (true);
    create policy advance_loan_types_insert on public.advance_loan_types for insert to authenticated with check (public.has_permission('masters','create'));
    create policy advance_loan_types_update on public.advance_loan_types for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy advance_loan_types_delete on public.advance_loan_types for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.advance_loan_types enable row level security;
end $$;
