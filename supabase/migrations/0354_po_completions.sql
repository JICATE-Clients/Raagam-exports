-- ============================================================================
-- Raagam ERP -- 0354 PO Completions
-- From VB.NET FrmPOCompletions.vb — mark POs as completed (no more receipts).
-- ============================================================================

create sequence if not exists public.seq_po_completion;

create table if not exists public.po_completions (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  completion_type text not null default 'PO'
                    check (completion_type in ('PO','KO','PD')),
  upto_date       date,
  notes           text,
  completed_by    uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_poc_code before insert on public.po_completions
  for each row execute function public.assign_code('POCOMP','public.seq_po_completion');
create trigger trg_poc_updated before update on public.po_completions
  for each row execute function public.set_updated_at();

create table if not exists public.po_completion_items (
  id                uuid primary key default gen_random_uuid(),
  po_completion_id  uuid not null references public.po_completions(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_poci_comp on public.po_completion_items(po_completion_id);
create index if not exists idx_poci_po on public.po_completion_items(purchase_order_id);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['po_completions','po_completion_items'] loop
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
