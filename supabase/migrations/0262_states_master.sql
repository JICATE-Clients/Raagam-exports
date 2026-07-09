-- ============================================================================
-- Raagam ERP — 0262 Master Data ▸ GST ▸ State
-- Legacy EDP2 "State" form (Configure ▸ GST): Code (GST state code, e.g. 33) ·
-- Default · Blocked · State (name). A minimal code/name master with flags —
-- same shape as the Country master (dedicated table, not config_lookups, since
-- config_lookups kinds carry no default/blocked flags).
--
-- NOTE: the address pickers (Applicant/Consignee/Customer contacts) still use
-- config_lookups kind 'state' — a separate lightweight list. These two "state"
-- stores could be reconciled onto this master later (see open-questions).
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.states (
  id          uuid primary key default gen_random_uuid(),
  code        text,                                   -- GST state code
  name        text not null,                          -- "State"
  is_default  boolean not null default false,
  blocked     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_states_updated before update on public.states
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy states_read on public.states for select to authenticated using (true);
    create policy states_insert on public.states for insert to authenticated with check (public.has_permission('masters','create'));
    create policy states_update on public.states for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy states_delete on public.states for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.states enable row level security;
end $$;
