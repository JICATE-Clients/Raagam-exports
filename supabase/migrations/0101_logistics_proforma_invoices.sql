-- ============================================================================
-- Raagam ERP — 0101 Logistics ▸ Pre-Shipment ▸ Proforma Invoice
-- Commercial lane (band 0100–0199). Additive sub-module of Logistics
-- (legacy EDP2: Logistics ▸ PreShipment ▸ "Proforma Invoice"). A pre-shipment
-- proforma invoice to the buyer (header + line items). Gated by 'logistics'.
-- ============================================================================

create sequence if not exists public.seq_proforma_invoice;
create table if not exists public.proforma_invoices (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                 -- PI-0001 (assign_code)
  buyer_id      uuid not null references public.buyers(id),
  currency_code text references public.currencies(code),
  incoterm      text,
  issue_date    date,
  valid_until   date,
  status        text not null default 'draft'
                  check (status in ('draft','sent','accepted','cancelled')),
  remarks       text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_pi_code before insert on public.proforma_invoices
  for each row execute function public.assign_code('PI','public.seq_proforma_invoice');
create trigger trg_pi_updated before update on public.proforma_invoices
  for each row execute function public.set_updated_at();
create index if not exists idx_pi_buyer  on public.proforma_invoices(buyer_id);
create index if not exists idx_pi_status on public.proforma_invoices(status);

create table if not exists public.proforma_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  proforma_id  uuid not null references public.proforma_invoices(id) on delete cascade,
  description  text not null,
  hsn_code     text,
  quantity     numeric(14,2) not null default 0,
  unit_price   numeric(14,4) not null default 0,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pi_lines_pi on public.proforma_invoice_lines(proforma_id);

-- ---------- RLS (reuse the existing 'logistics' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['proforma_invoices','proforma_invoice_lines'] loop
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
