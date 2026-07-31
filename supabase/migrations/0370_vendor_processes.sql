-- ============================================================================
-- Vendor ▸ Process (legacy RP-Software "Vendor" screen, tab shown when
-- **IsProcessor** is ticked)
--
-- Sibling of 0369's Item Category tab, and gated the same way: a processor is
-- paid for work done on our goods, so what matters is the process, its VAT and
-- the portion of it that attracts VAT — not item categories or lead times.
--
-- The right-hand panel of that tab is vendor-level, not per-row: one TDS levy,
-- one ESI number and one retention %, so those are columns on master_vendors.
-- ============================================================================

alter table public.master_vendors
  -- The legacy TDS box is a ⓘ picker, and the Levy master already carries a TDS
  -- structure (0283) — so this is a levy of type 'TDS', not a typed-in number.
  add column if not exists tds_levy_id uuid references public.levies(id) on delete set null,
  -- Deliberately unvalidated text, for the same reason TIN No is (see
  -- consignee-types.ts): a processor's ESI registration is whatever the office
  -- issued them, and a format guess would strand rows on their next edit.
  add column if not exists esi_no text,
  add column if not exists esi_retention_pct numeric(6,2) not null default 0;

create table if not exists public.master_vendor_processes (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.master_vendors(id) on delete cascade,
  sno             integer not null default 0,

  -- The real Process master (0227), not the `process` config_lookups kind: the
  -- legacy ⓘ lists the processes this vendor is paid to do, and those carry
  -- billing basis, HSN and item-class flags of their own.
  process_id      uuid references public.processes(id) on delete set null,

  -- "Vat Description" on the legacy grid — a `levies` row, displayed by its
  -- description, which is why the column is named for the description.
  vat_levy_id     uuid references public.levies(id) on delete set null,
  -- "Vat Portion %" — the share of the process charge that attracts that VAT.
  vat_portion_pct numeric(6,2) not null default 0
                    check (vat_portion_pct >= 0 and vat_portion_pct <= 100),

  payment_term_id uuid references public.payment_terms(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_mvp_vendor on public.master_vendor_processes(vendor_id);
create index if not exists idx_mvp_process on public.master_vendor_processes(process_id);
create index if not exists idx_mvp_payment_term on public.master_vendor_processes(payment_term_id);

drop trigger if exists trg_master_vendor_processes_updated on public.master_vendor_processes;
create trigger trg_master_vendor_processes_updated
  before update on public.master_vendor_processes
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy master_vendor_processes_read on public.master_vendor_processes
      for select to authenticated using (true);
    create policy master_vendor_processes_insert on public.master_vendor_processes
      for insert to authenticated with check (public.has_permission('masters','create'));
    create policy master_vendor_processes_update on public.master_vendor_processes
      for update to authenticated using (public.has_permission('masters','edit'))
      with check (public.has_permission('masters','edit'));
    create policy master_vendor_processes_delete on public.master_vendor_processes
      for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
exception
  when duplicate_object then null;
end $$;

alter table public.master_vendor_processes enable row level security;
