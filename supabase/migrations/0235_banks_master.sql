-- ============================================================================
-- Raagam ERP — 0235 Master Data ▸ Associates ▸ Banks (master-detail)
-- Legacy EDP2 "Bank" form: header (Code · Foreign/Local · Name · Blocked) + a
-- "Bank Detail" branch grid (Country → countries · State · City · Pin · Street ·
-- Land Line · Fax · E-Mail · Swift/RTGS code · Current Acc No · IFS Code).
-- The one code column is labelled "Swift Code" (Foreign) or "RTGS/NIFT Code"
-- (Local) in the UI — same stored field. RLS = masters.
-- ============================================================================

create table if not exists public.banks (
  id         uuid primary key default gen_random_uuid(),
  code       text,
  bank_type  text check (bank_type is null or bank_type in ('Foreign','Local')),
  name       text not null,
  blocked    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_banks_updated before update on public.banks
  for each row execute function public.set_updated_at();

create table if not exists public.bank_branches (
  id              uuid primary key default gen_random_uuid(),
  bank_id         uuid not null references public.banks(id) on delete cascade,
  sno             integer not null default 0,
  country_id      uuid references public.countries(id),
  state           text,
  city            text,
  pin             text,
  street          text,
  land_line       text,
  fax             text,
  email           text,
  swift_rtgs_code text,   -- "Swift Code" (Foreign) / "RTGS/NIFT Code" (Local)
  current_acc_no  text,
  ifs_code        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_bank_branches_updated before update on public.bank_branches
  for each row execute function public.set_updated_at();
create index if not exists idx_bank_branches_bank on public.bank_branches(bank_id);
create index if not exists idx_bank_branches_country on public.bank_branches(country_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['banks','bank_branches'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
