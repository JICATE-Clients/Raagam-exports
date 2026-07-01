-- ============================================================================
-- Raagam ERP — 0015 Finance
-- General Ledger (chart of accounts + balanced journals, admin-only reversal),
-- Payables with 3-way PO/GRN/invoice match + aging, Receivables in GBP/EUR with
-- forex + aging, and per-shipment P&L (revenue − costs). Auto-receives from
-- operations (GRN→payable, shipment→receivable, payroll→GL) wired in those
-- modules' actions. Tally XML export → System Integration module.
-- ============================================================================

-- ---------- chart of accounts ----------
create table if not exists public.gl_accounts (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  account_type text not null check (account_type in
                 ('asset','liability','equity','income','expense')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- journal entries (double-entry) ----------
create sequence if not exists public.seq_journal;
create table if not exists public.journal_entries (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  entry_date     date not null default current_date,
  narration      text,
  reference_type text,
  reference_id   uuid,
  location_id    uuid references public.locations(id),
  is_auto        boolean not null default false,  -- posted by operations
  status         text not null default 'draft' check (status in ('draft','posted','reversed')),
  reversal_of    uuid references public.journal_entries(id),
  total_debit    numeric(16,2) not null default 0,
  total_credit   numeric(16,2) not null default 0,
  created_by     uuid references public.profiles(id) default auth.uid(),
  posted_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_journal_code before insert on public.journal_entries
  for each row execute function public.assign_code('JV','public.seq_journal');
create trigger trg_journal_updated before update on public.journal_entries
  for each row execute function public.set_updated_at();
create index if not exists idx_journal_date on public.journal_entries(entry_date desc);

create table if not exists public.journal_lines (
  id                uuid primary key default gen_random_uuid(),
  journal_entry_id  uuid not null references public.journal_entries(id) on delete cascade,
  gl_account_id     uuid not null references public.gl_accounts(id),
  debit             numeric(16,2) not null default 0,
  credit            numeric(16,2) not null default 0,
  description       text,
  sort_order        int not null default 0
);
create index if not exists idx_jlines_entry on public.journal_lines(journal_entry_id);
create index if not exists idx_jlines_account on public.journal_lines(gl_account_id);

-- ---------- payables (vendor bills) with 3-way match ----------
create sequence if not exists public.seq_payable;
create table if not exists public.payables (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  vendor_id         uuid references public.vendors(id),
  purchase_order_id uuid references public.purchase_orders(id),
  grn_id            uuid references public.grns(id),
  bill_no           text,
  bill_date         date,
  due_date          date,
  currency_code     text references public.currencies(code),
  amount            numeric(16,2) not null default 0,
  tax_amount        numeric(16,2) not null default 0,
  total_amount      numeric(16,2) not null default 0,
  paid_amount       numeric(16,2) not null default 0,
  match_status      text not null default 'unmatched'
                      check (match_status in ('unmatched','matched','exception')),
  status            text not null default 'draft'
                      check (status in ('draft','approved','partially_paid','paid','cancelled')),
  location_id       uuid references public.locations(id),
  notes             text,
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_payable_code before insert on public.payables
  for each row execute function public.assign_code('BILL','public.seq_payable');
create trigger trg_payable_updated before update on public.payables
  for each row execute function public.set_updated_at();
create index if not exists idx_payables_vendor on public.payables(vendor_id);
create index if not exists idx_payables_status on public.payables(status);

create table if not exists public.payable_payments (
  id           uuid primary key default gen_random_uuid(),
  payable_id   uuid not null references public.payables(id) on delete cascade,
  payment_date date not null default current_date,
  amount       numeric(16,2) not null default 0,
  method       text,
  reference    text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_paypay_payable on public.payable_payments(payable_id);

-- ---------- receivables (buyer invoices, forex) ----------
create sequence if not exists public.seq_receivable;
create table if not exists public.receivables (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  buyer_id      uuid references public.buyers(id),
  shipment_id   uuid references public.shipments(id),
  invoice_no    text,
  invoice_date  date,
  due_date      date,
  currency_code text references public.currencies(code),
  amount_fc     numeric(16,2) not null default 0,   -- foreign currency (GBP/EUR)
  exchange_rate numeric(14,6) not null default 1,
  amount_inr    numeric(16,2) not null default 0,
  received_fc   numeric(16,2) not null default 0,
  status        text not null default 'open'
                  check (status in ('open','partially_received','received','overdue','cancelled')),
  location_id   uuid references public.locations(id),
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_receivable_code before insert on public.receivables
  for each row execute function public.assign_code('AR','public.seq_receivable');
create trigger trg_receivable_updated before update on public.receivables
  for each row execute function public.set_updated_at();
create index if not exists idx_recv_buyer on public.receivables(buyer_id);
create index if not exists idx_recv_status on public.receivables(status);

create table if not exists public.receivable_receipts (
  id             uuid primary key default gen_random_uuid(),
  receivable_id  uuid not null references public.receivables(id) on delete cascade,
  receipt_date   date not null default current_date,
  amount_fc      numeric(16,2) not null default 0,
  exchange_rate  numeric(14,6) not null default 1,
  amount_inr     numeric(16,2) not null default 0,
  reference      text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_recvrcpt_recv on public.receivable_receipts(receivable_id);

-- ---------- per-shipment cost lines (for real-time P&L) ----------
create table if not exists public.shipment_costs (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    uuid not null references public.shipments(id) on delete cascade,
  cost_type      text not null check (cost_type in
                   ('materials','labour','overhead','freight','other')),
  description    text,
  amount         numeric(16,2) not null default 0,
  source         text not null default 'manual' check (source in ('auto','manual')),
  reference_type text,
  reference_id   uuid,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_shipcost_shipment on public.shipment_costs(shipment_id);

-- ---------- RLS (gated by 'finance') ----------
do $$
declare t text;
begin
  foreach t in array array[
    'gl_accounts','journal_entries','journal_lines','payables','payable_payments',
    'receivables','receivable_receipts','shipment_costs'
  ] loop
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

-- ---------- roles + grants ----------
-- Accountant: operate finance but NOT reverse (delete) — admin-only reversal (PRD)
insert into public.roles (name, description, is_system)
values ('Accountant', 'Manages payables, receivables and ledger (no reversals)', false)
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'finance' and p.action in ('view','create','edit','export')
where r.name = 'Accountant' on conflict do nothing;

-- Manager: view finance (shipment P&L / aging are management screens)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'finance' and p.action in ('view','export')
where r.name = 'Manager' on conflict do nothing;

-- ---------- seed a starter chart of accounts ----------
insert into public.gl_accounts (code, name, account_type)
select c.code, c.name, c.atype
from (values
  ('1000','Cash','asset'),
  ('1010','Bank - Account 1','asset'),
  ('1020','Bank - Account 2','asset'),
  ('1100','Accounts Receivable','asset'),
  ('1200','Inventory','asset'),
  ('2000','Accounts Payable','liability'),
  ('2100','ESI Payable','liability'),
  ('2110','PF Payable','liability'),
  ('2200','GST Payable','liability'),
  ('3000','Capital','equity'),
  ('4000','Export Sales','income'),
  ('4010','Domestic Sales','income'),
  ('5000','Material Purchases','expense'),
  ('5100','Processing Charges','expense'),
  ('5200','Wages','expense'),
  ('5210','Staff Salary','expense'),
  ('5300','Freight & Logistics','expense'),
  ('5400','Overheads','expense')
) as c(code, name, atype)
where not exists (select 1 from public.gl_accounts);
