-- ============================================================================
-- Raagam ERP — 0102 Logistics ▸ Pre-Shipment ▸ LC Detail
-- Commercial lane (band 0100–0199). Additive sub-module of Logistics
-- (legacy EDP2: Logistics ▸ PreShipment ▸ "LC Detail"). Letter of Credit
-- record for a buyer order. Gated by 'logistics'.
-- ============================================================================

create sequence if not exists public.seq_lc_detail;
create table if not exists public.lc_details (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique,                          -- LC-0001 (assign_code)
  lc_number            text,
  buyer_id             uuid references public.buyers(id),
  bank_name            text,
  amount               numeric(16,2) not null default 0,
  currency_code        text references public.currencies(code),
  issue_date           date,
  expiry_date          date,
  latest_shipment_date date,
  terms                text,
  status               text not null default 'draft'
                         check (status in ('draft','active','amended','expired','closed')),
  created_by           uuid references public.profiles(id) default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_lc_code before insert on public.lc_details
  for each row execute function public.assign_code('LC','public.seq_lc_detail');
create trigger trg_lc_updated before update on public.lc_details
  for each row execute function public.set_updated_at();
create index if not exists idx_lc_buyer  on public.lc_details(buyer_id);
create index if not exists idx_lc_status on public.lc_details(status);

-- ---------- RLS (reuse the existing 'logistics' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['lc_details'] loop
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
