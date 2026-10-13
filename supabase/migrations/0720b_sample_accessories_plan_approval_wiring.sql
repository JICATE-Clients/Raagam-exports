-- 0720b — Sample ▸ Accessories Plan approval, part 2: the wiring (0720 is the
-- status, the lock, the revision and the decision function). Split as
-- 0716b / 0718b / 0719b. Workflow 'sample_accessories_plan', subject
-- 'iwo_material_boms'.

-- approval_apply_terminal: ONE branch added to the LIVE body, before its final
-- refusal — never retyped (see 0718b).
do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''iwo_material_boms'' then\n'
                || E'        perform public.sample_accessories_plan_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark);\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''iwo_material_boms''' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0720b: approval_apply_terminal final refusal not found';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

-- The flow — a catch-all copied from the Sample Fabric Plan's, so whoever
-- approves fabric plans approves trims plans until Approval Flows says otherwise.
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'sample_accessories_plan', 'Sample Accessories Plan — default',
       'Catch-all. Every sample Accessories Plan is approved before its trims are bought.',
       '{}'::jsonb, f.steps, 900, true
  from public.approval_flows f
 where f.workflow_key = 'sample_fabric_plan' and f.flow_name = 'Sample Fabric Plan — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'sample_accessories_plan');

-- Purchasing: the accessories branch gains 0718's three keys. Re-created from
-- 0718b's body with only that object changed.
create or replace function public.iwo_purchase_check__all_units(
  p_iwo_id uuid, p_exclude_po uuid default null::uuid, p_exclude_line uuid default null::uuid)
returns jsonb language sql stable security definer set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'code', w.code,
    'iwo_for', w.iwo_for,
    'status', w.status,
    'bom', case when w.iwo_for = 'accessories' then (
      select jsonb_build_object(
               'is_draft', b.is_draft,
               'approval_status', b.approval_status,
               'revision_no', b.revision_no,
               'needs_approval', w.is_sample)
      from public.iwo_material_boms b
      where b.iwo_id = w.id
    ) else (
      select jsonb_build_object(
               'is_draft', b.is_draft,
               'approval_status', b.approval_status,
               'revision_no', b.revision_no,
               'needs_approval', w.is_sample)
      from public.iwo_fabric_boms b
      where b.iwo_id = w.id
    ) end,
    'advised', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'name', it.name) order by i.sno)
      from public.iwo_material_boms b
      join public.iwo_material_bom_items i on i.bom_id = b.id
      left join public.items it on it.id = i.item_id
      where b.iwo_id = w.id and i.is_advised and i.item_id is not null
    ), '[]'::jsonb),
    'lines', case when w.iwo_for = 'accessories' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_id', i.item_id, 'name', it.name, 'purchase_qty', i.purchase_qty, 'uom', u.code
             ) order by i.sno)
      from public.iwo_material_boms b
      join public.iwo_material_bom_items i on i.bom_id = b.id
      left join public.items it on it.id = i.item_id
      left join public.uoms u on u.id = coalesce(i.purchase_uom_id, i.consumption_uom_id)
      where b.iwo_id = w.id and i.item_id is not null
    ), '[]'::jsonb) else coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_id', y.item_id, 'name', it.name, 'purchase_qty', y.purchase_qty, 'uom', u.code
             ) order by y.sno)
      from public.iwo_fabric_boms b
      join public.iwo_fabric_bom_yarns y on y.bom_id = b.id
      left join public.items it on it.id = y.item_id
      left join public.uoms u on u.id = y.uom_id
      where b.iwo_id = w.id
    ), '[]'::jsonb) end,
    'committed', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', c.item_id, 'qty', c.qty))
      from (
        select pl.item_id, sum(pl.quantity) as qty
        from public.po_line_items pl
        join public.purchase_orders po on po.id = pl.purchase_order_id
        where pl.iwo_id = w.id
          and pl.item_id is not null
          and po.status is distinct from 'cancelled'
          and (p_exclude_po is null or pl.purchase_order_id <> p_exclude_po)
          and (p_exclude_line is null or pl.id <> p_exclude_line)
        group by pl.item_id
      ) c
    ), '[]'::jsonb)
  )
  from public.internal_work_orders w
  where w.id = p_iwo_id
$function$;
