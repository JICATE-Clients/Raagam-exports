-- ============================================================================
-- Raagam ERP — 0107 Finance ▸ Debit / Credit Notes
-- Commercial lane (band 0100–0199). Additive sub-module of Finance
-- (legacy EDP2: Finance ▸ Payables ▸ "Debit Notes"/"Credit Notes" +
-- Receivables ▸ "Debit Notes"/"Credit Notes"). One table covers both note
-- types against either a vendor or a buyer. Gated by 'finance'.
-- ============================================================================

create sequence if not exists public.seq_finance_note;
create table if not exists public.finance_notes (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                 -- DCN-0001 (assign_code)
  note_type     text not null check (note_type in ('debit','credit')),
  party_type    text not null check (party_type in ('vendor','buyer')),
  vendor_id     uuid references public.vendors(id),
  buyer_id      uuid references public.buyers(id),
  currency_code text references public.currencies(code),
  amount        numeric(16,2) not null default 0,
  note_date     date,
  reference     text,
  reason        text,
  status        text not null default 'draft'
                  check (status in ('draft','issued','settled','cancelled')),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_fnote_code before insert on public.finance_notes
  for each row execute function public.assign_code('DCN','public.seq_finance_note');
create trigger trg_fnote_updated before update on public.finance_notes
  for each row execute function public.set_updated_at();
create index if not exists idx_fnote_status on public.finance_notes(status);
create index if not exists idx_fnote_vendor on public.finance_notes(vendor_id);
create index if not exists idx_fnote_buyer  on public.finance_notes(buyer_id);

-- ---------- RLS (reuse the existing 'finance' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['finance_notes'] loop
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
