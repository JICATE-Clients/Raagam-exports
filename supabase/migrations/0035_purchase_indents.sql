-- ============================================================================
-- Raagam ERP — 0035 Purchase ▸ Acknowledge Indents
-- Additive sub-module (legacy EDP2: Materials ▸ Purchase ▸ "Acknowledge Indents
-- from departments"). A department-raised material indent that Purchase
-- acknowledges and converts to an RFQ/PO. Header + lines, gated by the EXISTING
-- 'materials_purchase' permission — no new module.
-- ============================================================================

create sequence if not exists public.seq_purchase_indent;
create table if not exists public.purchase_indents (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- PIN-0001
  department     text not null,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  required_date  date,
  status         text not null default 'open'
                   check (status in ('open','acknowledged','converted','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_pind_code before insert on public.purchase_indents
  for each row execute function public.assign_code('PIN','public.seq_purchase_indent');
create trigger trg_pind_updated before update on public.purchase_indents
  for each row execute function public.set_updated_at();
create index if not exists idx_pind_status on public.purchase_indents(status);

create table if not exists public.purchase_indent_lines (
  id                 uuid primary key default gen_random_uuid(),
  purchase_indent_id uuid not null references public.purchase_indents(id) on delete cascade,
  item_id            uuid references public.items(id),
  description        text not null,
  quantity           numeric(14,3) not null default 0,
  uom_id             uuid references public.uoms(id),
  sort_order         int not null default 0
);
create index if not exists idx_pind_lines_indent on public.purchase_indent_lines(purchase_indent_id);

do $$
declare t text;
begin
  foreach t in array array['purchase_indents','purchase_indent_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('materials_purchase','edit')) with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
