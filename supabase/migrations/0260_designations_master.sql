-- ============================================================================
-- Raagam ERP — 0260 Master Data ▸ HR ▸ Designation
-- Legacy EDP2 "Designation" form (screenshot _154233): a flat master —
-- Designation (name) · For (Staff / Worker / Staff-Worker) · Blocked +
-- Save / Save As Drafts (→ is_draft).
-- Kept DISTINCT from the simple `designation` config_lookups kind that the
-- contact-grid pickers reference (same convention as Department 0259) — see
-- doc/masters-open-questions.md (should those pickers re-point at this table?).
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.designations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  for_type   text not null default 'staff'
               check (for_type in ('staff','worker','staff_worker')),
  blocked    boolean not null default false,
  is_draft   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_designations_updated before update on public.designations
  for each row execute function public.set_updated_at();

do $$
begin
  execute $f$
    create policy designations_read on public.designations for select to authenticated using (true);
    create policy designations_insert on public.designations for insert to authenticated with check (public.has_permission('masters','create'));
    create policy designations_update on public.designations for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy designations_delete on public.designations for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.designations enable row level security;
end $$;
