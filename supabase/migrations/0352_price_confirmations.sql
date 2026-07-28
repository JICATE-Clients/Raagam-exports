-- ============================================================================
-- Raagam ERP -- 0352 Price Confirmations
-- From VB.NET FrmPriceConfirmation.vb — confirm vendor rates before PO.
-- Applicability: T (this order), E (effective upto date), U (until further notice)
-- ============================================================================

create sequence if not exists public.seq_price_confirmation;

create table if not exists public.price_confirmations (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  vendor_id       uuid not null references public.vendors(id),
  po_type         text check (po_type in ('local','import','all')),
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected')),
  applicability   text check (applicability in ('T','E','U')),
  effective_until date,
  notes           text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_pc_code before insert on public.price_confirmations
  for each row execute function public.assign_code('PC','public.seq_price_confirmation');
create trigger trg_pc_updated before update on public.price_confirmations
  for each row execute function public.set_updated_at();
create index if not exists idx_pc_vendor on public.price_confirmations(vendor_id);
create index if not exists idx_pc_status on public.price_confirmations(status);

create table if not exists public.price_confirmation_items (
  id                    uuid primary key default gen_random_uuid(),
  price_confirmation_id uuid not null references public.price_confirmations(id) on delete cascade,
  item_id               uuid references public.items(id),
  item_class            text,
  category              text,
  description           text,
  budget_rate           numeric(14,4) default 0,
  quoted_rate           numeric(14,4) default 0,
  confirmed_rate        numeric(14,4) default 0,
  is_approved           boolean not null default false,
  previous_confirmed_rate numeric(14,4),
  development_charges   numeric(16,2) default 0,
  remarks               text,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_pci_pc on public.price_confirmation_items(price_confirmation_id);
create trigger trg_pci_updated before update on public.price_confirmation_items
  for each row execute function public.set_updated_at();

-- RLS
do $$
declare t text;
begin
  foreach t in array array['price_confirmations','price_confirmation_items'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('materials_purchase','edit'))
        with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
  end loop;
end $$;
