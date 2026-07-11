-- ============================================================================
-- Raagam ERP — 0267 Orders ▸ TA ▸ TA Department Assign
-- Legacy RP-Software "TA Department Assign" form (screenshot _134038): a
-- master-detail document that assigns TA activities to a Department at a
-- Location, flagging which the department owns.
--
--   Header : Entry No (auto, code 'TDA') · Entered Dt · Location (red ⓘ →
--            locations) · Department (red ⓘ → config_lookups 'department')
--   Grid   : S No · Activity (red ⓘ → ta_activities) · Owner (checkbox)
--
-- Gated by the existing 'orders' module (no new permission).
-- ============================================================================

create sequence if not exists public.seq_ta_dept_assign;

-- ---------- header ----------
create table if not exists public.ta_department_assigns (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                  -- TDA-0001 (Entry No)
  entered_date  date not null default current_date,
  location_id   uuid references public.locations(id) on delete set null,
  department_id uuid references public.config_lookups(id) on delete set null,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_ta_dept_assign_code before insert on public.ta_department_assigns
  for each row execute function public.assign_code('TDA','public.seq_ta_dept_assign');
create trigger trg_ta_dept_assign_updated before update on public.ta_department_assigns
  for each row execute function public.set_updated_at();
create index if not exists idx_ta_dept_assign_location on public.ta_department_assigns(location_id);
create index if not exists idx_ta_dept_assign_department on public.ta_department_assigns(department_id);

-- ---------- grid (activities assigned to the department) ----------
create table if not exists public.ta_department_assign_lines (
  id          uuid primary key default gen_random_uuid(),
  assign_id   uuid not null references public.ta_department_assigns(id) on delete cascade,
  sno         integer not null default 0,
  activity_id uuid references public.ta_activities(id) on delete set null,
  is_owner    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_ta_dept_assign_line_updated before update on public.ta_department_assign_lines
  for each row execute function public.set_updated_at();
create index if not exists idx_ta_dept_assign_lines_assign on public.ta_department_assign_lines(assign_id);
create index if not exists idx_ta_dept_assign_lines_activity on public.ta_department_assign_lines(activity_id);

-- ---------- RLS (reuse the existing 'orders' module) ----------
do $$
declare t text;
begin
  foreach t in array array['ta_department_assigns','ta_department_assign_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
