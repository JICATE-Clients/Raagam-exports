-- ============================================================================
-- Raagam ERP — 0275 Planning ▸ Garmenting PPM Cancellation
-- Additive sub-module (legacy EDP2: Planning ▸ Materials-Garment Orders ▸
-- "Garmenting PPM Cancellation"). An approval document that formally cancels an
-- already-issued PPM (production-planning material issue) with a reason + an
-- approval trail; on approval the parent ppm_issues row is set to 'cancelled'
-- (ppm_issues already carries the 'cancelled' status — no enum change). The bare
-- inline cancelPpm quick-cancel on the PPM detail is left in place alongside
-- this. Gated by the EXISTING 'planning' permission — no new module.
-- ============================================================================

create sequence if not exists public.seq_ppm_cancellation;
create table if not exists public.ppm_cancellations (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- PPC-0001
  ppm_issue_id   uuid not null references public.ppm_issues(id) on delete cascade,
  reason         text not null,
  status         text not null default 'draft'
                   check (status in ('draft','approved','rejected')),
  requested_by   uuid references public.profiles(id) default auth.uid(),
  approved_by    uuid references public.profiles(id),
  approved_at    timestamptz,
  decided_reason text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_ppc_code before insert on public.ppm_cancellations
  for each row execute function public.assign_code('PPC','public.seq_ppm_cancellation');
create trigger trg_ppc_updated before update on public.ppm_cancellations
  for each row execute function public.set_updated_at();
create index if not exists idx_ppc_ppm    on public.ppm_cancellations(ppm_issue_id);
create index if not exists idx_ppc_status on public.ppm_cancellations(status);

do $$
declare t text;
begin
  foreach t in array array['ppm_cancellations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
