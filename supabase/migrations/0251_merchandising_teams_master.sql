-- ============================================================================
-- Raagam ERP — 0251 Master Data ▸ Associates ▸ Merchandising Team
-- Legacy EDP2 "Merchandising Team" form (screenshot _135028): a flat master —
-- Short Name · Blocked · Name · Location (red ⓘ → locations, select-only) +
-- Save / Save As Drafts (→ is_draft).
-- Location reuses the GST-entity `locations` master (same as Employee 0243).
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.merchandising_teams (
  id          uuid primary key default gen_random_uuid(),
  code        text,                                        -- "Short Name"
  name        text not null,
  blocked     boolean not null default false,
  location_id uuid references public.locations(id) on delete set null,
  is_draft    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_merchandising_teams_updated before update on public.merchandising_teams
  for each row execute function public.set_updated_at();
create index if not exists idx_merchandising_teams_location on public.merchandising_teams(location_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy merchandising_teams_read on public.merchandising_teams for select to authenticated using (true);
    create policy merchandising_teams_insert on public.merchandising_teams for insert to authenticated with check (public.has_permission('masters','create'));
    create policy merchandising_teams_update on public.merchandising_teams for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy merchandising_teams_delete on public.merchandising_teams for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.merchandising_teams enable row level security;
end $$;
