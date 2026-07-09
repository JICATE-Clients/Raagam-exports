-- ============================================================================
-- Raagam ERP — 0259 Master Data ▸ HR ▸ Leave Type
-- Legacy EDP2 "Leave Type" form: ID (code, key) · Loss Of Pay · Blocked ·
-- Description · Encash Possible (Yes/No) · For (Both/Male/Female) · No of Days
-- (yearly allotment).
--
-- Flat header master. RLS = masters (read open, write gated by
-- has_permission('masters', …)). Next free number 0259 (0256/0257 duplicated by
-- the parallel lane — holidays/hostel + advance_loan/work_timings; accepted drift).
-- ============================================================================

create table if not exists public.leave_types (
  id              uuid primary key default gen_random_uuid(),
  code            text,                                   -- "ID"
  description     text,
  loss_of_pay     boolean not null default false,
  encash_possible boolean not null default false,
  applies_to      text check (applies_to is null or applies_to in ('Both','Male','Female')),
  no_of_days      numeric(6,2) not null default 0,        -- yearly
  blocked         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_leave_types_updated before update on public.leave_types
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy leave_types_read on public.leave_types for select to authenticated using (true);
    create policy leave_types_insert on public.leave_types for insert to authenticated with check (public.has_permission('masters','create'));
    create policy leave_types_update on public.leave_types for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy leave_types_delete on public.leave_types for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.leave_types enable row level security;
end $$;
