-- ============================================================================
-- Raagam ERP — 0103 Logistics ▸ Pre-Shipment ▸ EPCG Declaration
-- Commercial lane (band 0100–0199). Additive sub-module of Logistics
-- (legacy EDP2: Logistics ▸ PreShipment ▸ "EPCG Declaration"). Export Promotion
-- Capital Goods licence with export-obligation tracking. Gated by 'logistics'.
-- ============================================================================

create sequence if not exists public.seq_epcg;
create table if not exists public.epcg_declarations (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique,                          -- EPCG-0001 (assign_code)
  license_number       text,
  authorisation_date   date,
  expiry_date          date,
  currency_code        text references public.currencies(code),
  duty_saved           numeric(16,2) not null default 0,
  export_obligation    numeric(16,2) not null default 0,
  obligation_fulfilled numeric(16,2) not null default 0,
  status               text not null default 'active'
                         check (status in ('active','fulfilled','expired','cancelled')),
  remarks              text,
  created_by           uuid references public.profiles(id) default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_epcg_code before insert on public.epcg_declarations
  for each row execute function public.assign_code('EPCG','public.seq_epcg');
create trigger trg_epcg_updated before update on public.epcg_declarations
  for each row execute function public.set_updated_at();
create index if not exists idx_epcg_status on public.epcg_declarations(status);

-- ---------- RLS (reuse the existing 'logistics' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['epcg_declarations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('logistics','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('logistics','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('logistics','edit'))
        with check (public.has_permission('logistics','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('logistics','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
