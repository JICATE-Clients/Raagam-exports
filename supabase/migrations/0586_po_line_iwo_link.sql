-- 0586 — A purchase order line can buy for an Internal Work Order (2026-09-19)
--
-- IWO SRS §6, "ADVISED ITEMS CHECKPOINT": an accessory ticked Is Advised on the
-- IWO Material BOM (buyer artwork or shade not yet confirmed) STRICTLY BLOCKS
-- purchase order creation until the merchandiser unticks it.
--
-- A PO line could name a garment order (0424, `sales_order_id`) and nothing
-- else, so there was no way to say which work order a purchase was for, and so
-- nothing for the block to key on. This adds the link and the read the block
-- needs. The refusal itself lives in the purchase actions, beside the order
-- side's "To be advised" gate (`refuseUnsettledMaterials`), at the same four
-- write paths: create, add line, edit line, submit.
--
--   1. po_line_items.iwo_id — per LINE, like sales_order_id, and never both on
--      one line: a purchase is for an order OR a work order. ON DELETE RESTRICT:
--      a work order that has been bought against cannot be deleted from under
--      its purchase orders.
--   2. iwo_purchase_check(iwo) — SECURITY DEFINER, because the gate runs in the
--      BUYER's session and the IWO tables are readable only with Orders ▸ View at
--      the IWO's own unit. Read through RLS, a buyer without that permission
--      would see no BOM, no Advised lines, and the gate would ALLOW — a block
--      that fails open for exactly the people it exists to stop. It returns the
--      work order's number, kind, status, whether a Material BOM exists, and its
--      Advised materials; nothing else.
--
--      DRAFT BOMs COUNT. The order side reads recorded BOMs only, because a
--      draft there is an unfinished plan beside a recorded one. An IWO has ONE
--      Material BOM, and the Advised tick is a stop sign — it holds from the
--      moment it is stored, not from the moment the whole BOM is finished.

-- ---------------------------------------------------------------------------
-- 1. The link
-- ---------------------------------------------------------------------------
alter table public.po_line_items
  add column if not exists iwo_id uuid
    references public.internal_work_orders(id) on delete restrict;

comment on column public.po_line_items.iwo_id is
  'The Internal Work Order this line buys for (0586). NULL with sales_order_id NULL is general stock. Never set together with sales_order_id.';

create index if not exists idx_poli_iwo on public.po_line_items(iwo_id);

alter table public.po_line_items drop constraint if exists chk_poli_one_source;
alter table public.po_line_items
  add constraint chk_poli_one_source check (sales_order_id is null or iwo_id is null);

-- ---------------------------------------------------------------------------
-- 2. The read the gate and the PO form share
-- ---------------------------------------------------------------------------
create or replace function public.iwo_purchase_check(p_iwo_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'code', w.code,
    'iwo_for', w.iwo_for,
    'status', w.status,
    'bom', (
      select jsonb_build_object('is_draft', b.is_draft)
      from public.iwo_material_boms b
      where b.iwo_id = w.id
    ),
    'advised', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'name', it.name) order by i.sno)
      from public.iwo_material_boms b
      join public.iwo_material_bom_items i on i.bom_id = b.id
      left join public.items it on it.id = i.item_id
      where b.iwo_id = w.id
        and i.is_advised
        and i.item_id is not null
    ), '[]'::jsonb)
  )
  from public.internal_work_orders w
  where w.id = p_iwo_id
$$;

revoke all on function public.iwo_purchase_check(uuid) from public, anon;
grant execute on function public.iwo_purchase_check(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assert it from the catalog
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'po_line_items'
      and column_name = 'iwo_id' and is_nullable = 'YES'
  ) then
    raise exception '0586: po_line_items.iwo_id missing or NOT NULL';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_poli_one_source') then
    raise exception '0586: chk_poli_one_source missing';
  end if;
  if has_function_privilege('anon', 'public.iwo_purchase_check(uuid)', 'execute') then
    raise exception '0586: iwo_purchase_check is executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.iwo_purchase_check(uuid)', 'execute') then
    raise exception '0586: iwo_purchase_check is not executable by authenticated';
  end if;
end;
$$;
