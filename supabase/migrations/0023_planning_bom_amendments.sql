-- ============================================================================
-- Raagam ERP — 0023 Planning ▸ BOM Amendments
-- Additive sub-module of the existing Planning module (legacy EDP2:
-- Planning ▸ Materials ▸ "Fabric BOM Amendment / Material BOM Amendment").
--
-- Upgrades the current edit-in-place BOM editing (◐) with a FORMAL amendment
-- record: describe the change against a fabric or material BOM → submit →
-- approve/reject (audit trail). The in-place BOM edit is unchanged; this wraps
-- it in approval. Gated by the EXISTING 'planning' permission — no new module.
-- ============================================================================

create sequence if not exists public.seq_bom_amendment;
create table if not exists public.bom_amendments (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                                 -- BMA-0001 (assign_code)
  bom_kind        text not null check (bom_kind in ('fabric','material')),
  fabric_bom_id   uuid references public.fabric_boms(id) on delete cascade,
  material_bom_id uuid references public.material_boms(id) on delete cascade,
  sales_order_id  uuid references public.sales_orders(id) on delete set null,
  change_summary  text not null,
  reason          text,
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected')),
  created_by      uuid references public.profiles(id) default auth.uid(),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bom_amendment_kind_target check (
    (bom_kind = 'fabric'   and fabric_bom_id   is not null and material_bom_id is null) or
    (bom_kind = 'material' and material_bom_id is not null and fabric_bom_id   is null)
  )
);
create trigger trg_bom_amend_code before insert on public.bom_amendments
  for each row execute function public.assign_code('BMA','public.seq_bom_amendment');
create trigger trg_bom_amend_updated before update on public.bom_amendments
  for each row execute function public.set_updated_at();
create index if not exists idx_bom_amend_status on public.bom_amendments(status);
create index if not exists idx_bom_amend_order  on public.bom_amendments(sales_order_id);

-- ---------- RLS (reuse the existing 'planning' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['bom_amendments'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
