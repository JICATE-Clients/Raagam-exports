-- ============================================================================
-- Raagam ERP — 0269 Orders ▸ TA ▸ TA User Rights
-- Legacy RP-Software "TA User rights" form (screenshot _143318): a per-user
-- permission matrix over TA activities —
--   Header : User (red ⓘ → profiles)
--   Grid   : one row per activity (+ an "All Activities" master row) with
--            checkbox columns All · View · Add · Modify · Delete
--            (All is a UI convenience for the four; not stored).
--
-- Net-new: the app's RBAC is role-based only — there is no per-user/per-activity
-- rights table. This screen CAPTURES rights; enforcement on TA Plan/Followups/
-- Completion is a deliberate future step. Administered by system_admin (the User
-- picker reads profiles, which is admin-only-readable).
-- ============================================================================

create table if not exists public.ta_user_rights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid references public.ta_activities(id) on delete cascade,  -- NULL = "All Activities"
  can_view    boolean not null default false,
  can_add     boolean not null default false,
  can_modify  boolean not null default false,
  can_delete  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_ta_user_rights_updated before update on public.ta_user_rights
  for each row execute function public.set_updated_at();

-- One wildcard ("All Activities") row per user + one row per (user, activity).
create unique index if not exists uq_ta_user_rights_all
  on public.ta_user_rights(user_id) where activity_id is null;
create unique index if not exists uq_ta_user_rights_activity
  on public.ta_user_rights(user_id, activity_id) where activity_id is not null;
create index if not exists idx_ta_user_rights_user on public.ta_user_rights(user_id);

-- ---------- RLS (system_admin — user-permission administration) ----------
do $$
declare t text;
begin
  foreach t in array array['ta_user_rights'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('system_admin','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('system_admin','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('system_admin','edit'))
        with check (public.has_permission('system_admin','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('system_admin','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
