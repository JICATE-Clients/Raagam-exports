-- ============================================================================
-- Raagam ERP — 0206 Production ▸ Contractor Piece Rates (+ approve)   [Lane B]
-- Additive (legacy EDP2: Garmenting ▸ Production Planning ▸ "Contractor Piece
-- Rate Details / Approved"). A per-operation piece rate for a contractor;
-- draft → submitted → approved/rejected. References the HR `contractors` table.
-- Gated by the EXISTING 'production' permission.
-- ============================================================================

create sequence if not exists public.seq_piece_rate;
create table if not exists public.contractor_piece_rates (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- CPR-0001
  contractor_id  uuid references public.contractors(id) on delete set null,
  work_type_id   uuid references public.work_types(id) on delete set null,
  operation      text,
  rate           numeric(14,4) not null default 0,
  effective_date date,
  status         text not null default 'draft'
                   check (status in ('draft','submitted','approved','rejected')),
  created_by     uuid references public.profiles(id) default auth.uid(),
  approved_by    uuid references public.profiles(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_cpr_code before insert on public.contractor_piece_rates
  for each row execute function public.assign_code('CPR','public.seq_piece_rate');
create trigger trg_cpr_updated before update on public.contractor_piece_rates
  for each row execute function public.set_updated_at();
create index if not exists idx_cpr_status on public.contractor_piece_rates(status);

do $$
declare t text;
begin
  foreach t in array array['contractor_piece_rates'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('production','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('production','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('production','edit')) with check (public.has_permission('production','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('production','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
