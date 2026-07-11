-- ============================================================================
-- Raagam ERP — 0127 Orders ▸ Garment Process Amendment (document)
-- Legacy EDP2: Sales ▸ Garment Orders ▸ "Garment Process Amendment". A standalone
-- amendment document: header (Entry No · Date · Customer · SC No · Amend S No ·
-- Order No) + two identical style grids on tabs "Component Process" and "Garment
-- Process" (S No · Style Ref No · Style · Article No).
--
-- Distinct from the lean 0034 `garment_process_amendments` approval record
-- (per-order add/remove/change). Named `*_docs` / `*_lines` to avoid collision.
-- Gated by the existing 'orders' permission.
-- ============================================================================

create sequence if not exists public.seq_gp_amendment_doc;
create table if not exists public.garment_process_amendment_docs (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- GPA-0001 (Entry No)
  amend_date     date not null default current_date,
  customer_id    uuid references public.buyers(id),
  sales_order_id uuid references public.sales_orders(id),     -- SC No
  amend_sno      int,                                         -- Amend S No
  order_no       text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_gpad_code before insert on public.garment_process_amendment_docs
  for each row execute function public.assign_code('GPA','public.seq_gp_amendment_doc');
create trigger trg_gpad_updated before update on public.garment_process_amendment_docs
  for each row execute function public.set_updated_at();
create index if not exists idx_gpad_order    on public.garment_process_amendment_docs(sales_order_id);
create index if not exists idx_gpad_customer on public.garment_process_amendment_docs(customer_id);

-- one row per style, on either the Component or Garment tab
create table if not exists public.garment_process_amendment_lines (
  id         uuid primary key default gen_random_uuid(),
  doc_id     uuid not null references public.garment_process_amendment_docs(id) on delete cascade,
  tab        text not null check (tab in ('component','garment')),
  sno        int not null default 0,
  style_id   uuid references public.garment_styles(id),       -- Style Ref No (Style + Article No derive from it)
  created_at timestamptz not null default now()
);
create index if not exists idx_gpal_doc on public.garment_process_amendment_lines(doc_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'garment_process_amendment_docs','garment_process_amendment_lines'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
