-- ============================================================================
-- Raagam ERP — 0116 Finance ▸ Provisional Invoices
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Receivables ▸ "Provisional Invoices"). A preliminary
-- export invoice raised before the final invoice. Gated by 'finance'.
-- ============================================================================

create sequence if not exists public.seq_provisional_invoice;
create table if not exists public.provisional_invoices (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                 -- PRV-0001 (assign_code)
  buyer_id      uuid references public.buyers(id),
  currency_code text references public.currencies(code),
  amount        numeric(16,2) not null default 0,
  invoice_date  date,
  status        text not null default 'draft'
                  check (status in ('draft','finalised','cancelled')),
  remarks       text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_prv_code before insert on public.provisional_invoices
  for each row execute function public.assign_code('PRV','public.seq_provisional_invoice');
create trigger trg_prv_updated before update on public.provisional_invoices
  for each row execute function public.set_updated_at();
create index if not exists idx_prv_buyer  on public.provisional_invoices(buyer_id);
create index if not exists idx_prv_status on public.provisional_invoices(status);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['provisional_invoices'] loop
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
