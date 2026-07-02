-- ============================================================================
-- Raagam ERP — 0118 Finance ▸ Domestic Garment Invoices
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Receivables ▸ "Domestic Garment Invoices"). Domestic
-- (INR / GST) garment sales invoice. Gated by 'finance'.
-- ============================================================================

create sequence if not exists public.seq_domestic_invoice;
create table if not exists public.domestic_garment_invoices (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                -- DGI-0001 (assign_code)
  buyer_id       uuid references public.buyers(id),
  invoice_date   date,
  taxable_amount numeric(16,2) not null default 0,
  gst_amount     numeric(16,2) not null default 0,
  status         text not null default 'draft'
                   check (status in ('draft','issued','paid','cancelled')),
  remarks        text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_dgi_code before insert on public.domestic_garment_invoices
  for each row execute function public.assign_code('DGI','public.seq_domestic_invoice');
create trigger trg_dgi_updated before update on public.domestic_garment_invoices
  for each row execute function public.set_updated_at();
create index if not exists idx_dgi_buyer  on public.domestic_garment_invoices(buyer_id);
create index if not exists idx_dgi_status on public.domestic_garment_invoices(status);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['domestic_garment_invoices'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('finance','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('finance','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('finance','edit'))
        with check (public.has_permission('finance','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('finance','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
