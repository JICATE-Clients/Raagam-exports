-- 0727 · Sample Fabric / Accessories Plan — Raise Revision keeps a FULL V0
--        snapshot, and the approver sees SHADE changes, not only quantities
--        (doc/sample/developer-ui-field-updates-report-v8.md §8.2: "creates a
--        V0 JSONB backup snapshot … management reviews diffs (yarn weight
--        deltas, dyeing shade changes, trim quantity adjustments)").
--
-- 0718 / 0720 logged only the approved PURCHASE lines (`approved_yarns` /
-- `approved_items`) — enough for "yarn weight deltas" and "trim quantity
-- adjustments", nothing for a shade: a plan revised from NAVY to BLACK at the
-- same kilos showed "No purchase quantity changed". Two additions:
--
--   * `snapshot` jsonb on both revision logs — the WHOLE approved plan at the
--     moment Raise Revision reopened it: { plan: {header, every child table},
--     shades: [...] }. Evidence, like `approved_yarns`: nothing re-applies it.
--   * `sample_plan_shade_lines(kind, bom)` — the plan's colour facts as one flat
--     list {part, name, colour, qty, uom}, summed per (part, name, colour). The
--     raise stores it in `snapshot.shades`; the approval screen reads it LIVE
--     for the revised plan, so both sides of the diff come from one definition.
--
-- The raise functions are re-created FROM THE LIVE BODIES (2026-10-14) with one
-- added statement each, marked "0727". SECURITY INVOKER for the readers: they
-- run under the caller's RLS, exactly as the plan's own report does.

alter table public.iwo_fabric_bom_revisions   add column if not exists snapshot jsonb;
alter table public.iwo_material_bom_revisions add column if not exists snapshot jsonb;

comment on column public.iwo_fabric_bom_revisions.snapshot is
  '0727: the approved plan as it stood when this revision was raised — {plan, shades}. Evidence only.';
comment on column public.iwo_material_bom_revisions.snapshot is
  '0727: the approved plan as it stood when this revision was raised — {plan, shades}. Evidence only.';

-- ── the colour facts of a plan ────────────────────────────────────────────────
create or replace function public.sample_plan_shade_lines(p_kind text, p_bom uuid)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select coalesce(jsonb_agg(x order by x ->> 'part', x ->> 'name', x ->> 'colour'), '[]'::jsonb)
    from (
      -- Fabric plan ▸ yarn shades (yarn-dyed / dyed-yarn purchase), per yarn and shade.
      select jsonb_build_object('part', 'Yarn shade', 'name', coalesce(it.name, 'A yarn'),
                                'colour', upper(btrim(s.color_name)), 'qty', sum(s.planned_kgs), 'uom', 'KGS') x
        from public.iwo_fabric_bom_yarn_shades s
        join public.iwo_fabric_bom_yarns y on y.id = s.yarn_id
        left join public.items it on it.id = y.item_id
       where p_kind = 'fabric' and y.bom_id = p_bom and nullif(btrim(s.color_name), '') is not null
       group by it.name, upper(btrim(s.color_name))
      union all
      -- Fabric plan ▸ the fabric's colour / print, per fabric.
      select jsonb_build_object('part', 'Fabric colour', 'name', coalesce(it.name, c.name, 'A fabric'),
                                'colour', upper(concat_ws(' / ', nullif(btrim(l.color_name), ''), nullif(btrim(l.print_name), ''))),
                                'qty', sum(l.req_kgs), 'uom', 'KGS')
        from public.iwo_fabric_bom_lines l
        left join public.items it on it.id = l.item_id
        left join public.categories c on c.id = l.structure_id
       where p_kind = 'fabric' and l.bom_id = p_bom
         and (nullif(btrim(l.color_name), '') is not null or nullif(btrim(l.print_name), '') is not null)
       group by coalesce(it.name, c.name, 'A fabric'), upper(concat_ws(' / ', nullif(btrim(l.color_name), ''), nullif(btrim(l.print_name), '')))
      union all
      -- Accessories plan ▸ each trim's colour (a slice's own colour first).
      select jsonb_build_object('part', 'Trim colour', 'name', coalesce(it.name, 'A trim'),
                                'colour', upper(coalesce(sc.name, ic.name)),
                                'qty', sum(coalesce(sl.planned_qty, i.planned_qty)), 'uom', null)
        from public.iwo_material_bom_items i
        left join public.iwo_material_bom_item_slices sl on sl.item_line_id = i.id
        left join public.config_lookups sc on sc.id = sl.item_color_id
        left join public.config_lookups ic on ic.id = i.item_color_id
        left join public.items it on it.id = i.item_id
       where p_kind = 'accessories' and i.bom_id = p_bom and coalesce(sc.name, ic.name) is not null
       group by coalesce(it.name, 'A trim'), upper(coalesce(sc.name, ic.name))
    ) t;
$$;

-- ── the whole approved plan ───────────────────────────────────────────────────
create or replace function public.sample_plan_snapshot(p_kind text, p_bom uuid)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select case p_kind
    when 'fabric' then jsonb_build_object(
      'header',            (select to_jsonb(b) from public.iwo_fabric_boms b where b.id = p_bom),
      'lines',             (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_fabric_bom_lines t where t.bom_id = p_bom),
      'dias',              (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_fabric_bom_dias t where t.bom_id = p_bom),
      'palette',           (select coalesce(jsonb_agg(to_jsonb(t) order by t.section, t.sno), '[]') from public.iwo_fabric_bom_palette t where t.bom_id = p_bom),
      'process_scope',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.iwo_fabric_bom_process_scope t where t.bom_id = p_bom),
      'processes',         (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_fabric_bom_processes t where t.bom_id = p_bom),
      'yarns',             (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_fabric_bom_yarns t where t.bom_id = p_bom),
      'yarn_shades',       (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_fabric_bom_yarn_shades t
                              where t.yarn_id in (select y.id from public.iwo_fabric_bom_yarns y where y.bom_id = p_bom)),
      'yarn_stages',       (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_fabric_bom_yarn_stages t
                              where t.yarn_id in (select y.id from public.iwo_fabric_bom_yarns y where y.bom_id = p_bom)),
      'yd_combinations',   (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.iwo_fabric_bom_yd_combinations t where t.bom_id = p_bom),
      'yd_combination_colors', (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_fabric_bom_yd_combination_colors t
                              where t.combination_id in (select c.id from public.iwo_fabric_bom_yd_combinations c where c.bom_id = p_bom)),
      'yd_repeats',        (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_fabric_bom_yd_repeats t where t.bom_id = p_bom))
    when 'accessories' then jsonb_build_object(
      'header',            (select to_jsonb(b) from public.iwo_material_boms b where b.id = p_bom),
      'items',             (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_material_bom_items t where t.bom_id = p_bom),
      'item_slices',       (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_material_bom_item_slices t
                              where t.item_line_id in (select i.id from public.iwo_material_bom_items i where i.bom_id = p_bom)),
      'processes',         (select coalesce(jsonb_agg(to_jsonb(t) order by t.sno), '[]') from public.iwo_material_bom_processes t where t.bom_id = p_bom))
  end;
$$;

revoke all on function public.sample_plan_shade_lines(text, uuid) from public, anon;
revoke all on function public.sample_plan_snapshot(text, uuid) from public, anon;
grant execute on function public.sample_plan_shade_lines(text, uuid) to authenticated;
grant execute on function public.sample_plan_snapshot(text, uuid) to authenticated;

-- ── Raise Revision, with the snapshot ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.raise_fabric_plan_revision(p_bom uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_plan public.iwo_fabric_boms%rowtype;
  v_next integer;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'Raising a Fabric Plan revision needs Orders ▸ Edit.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the plan is being revised.' using errcode = '23514';
  end if;
  select * into v_plan from public.iwo_fabric_boms b where b.id = p_bom for update;
  if not found or not public.is_current_location(v_plan.location_id) then
    raise exception 'That Fabric Plan no longer exists in this unit.' using errcode = 'P0002';
  end if;
  if v_plan.approval_status <> 'approved' then
    raise exception 'Only an approved Fabric Plan is revised — this one is %; edit it directly.', v_plan.approval_status
      using errcode = '55000';
  end if;
  v_next := v_plan.revision_no + 1;
  insert into public.iwo_fabric_bom_revisions (bom_id, revision_no, reason, approved_yarns)
  select p_bom, v_next, btrim(p_reason),
         coalesce(jsonb_agg(jsonb_build_object(
                    'item_id', y.item_id, 'name', it.name,
                    'purchase_qty', y.purchase_qty, 'uom', u.code) order by y.sno), '[]'::jsonb)
    from public.iwo_fabric_bom_yarns y
    left join public.items it on it.id = y.item_id
    left join public.uoms u on u.id = y.uom_id
   where y.bom_id = p_bom;
  -- 0727: the whole approved plan and its shades, before it reopens.
  update public.iwo_fabric_bom_revisions
     set snapshot = jsonb_build_object('plan', public.sample_plan_snapshot('fabric', p_bom),
                                       'shades', public.sample_plan_shade_lines('fabric', p_bom))
   where bom_id = p_bom and revision_no = v_next;
  update public.iwo_fabric_boms
     set approval_status = 'open', revision_no = v_next,
         submitted_at = null, submitted_by = null, updated_at = now()
   where id = p_bom;
  return v_next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.raise_accessories_plan_revision(p_bom uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_plan public.iwo_material_boms%rowtype;
  v_next integer;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'Raising an Accessories Plan revision needs Orders ▸ Edit.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the plan is being revised.' using errcode = '23514';
  end if;
  select * into v_plan from public.iwo_material_boms b where b.id = p_bom for update;
  if not found or not public.is_current_location(v_plan.location_id) then
    raise exception 'That Accessories Plan no longer exists in this unit.' using errcode = 'P0002';
  end if;
  if v_plan.approval_status <> 'approved' then
    raise exception 'Only an approved Accessories Plan is revised — this one is %; edit it directly.', v_plan.approval_status
      using errcode = '55000';
  end if;
  v_next := v_plan.revision_no + 1;
  insert into public.iwo_material_bom_revisions (bom_id, revision_no, reason, approved_items)
  select p_bom, v_next, btrim(p_reason),
         coalesce(jsonb_agg(jsonb_build_object(
                    'item_id', i.item_id, 'name', it.name,
                    'purchase_qty', i.purchase_qty, 'uom', u.code) order by i.sno), '[]'::jsonb)
    from public.iwo_material_bom_items i
    left join public.items it on it.id = i.item_id
    left join public.uoms u on u.id = coalesce(i.purchase_uom_id, i.consumption_uom_id)
   where i.bom_id = p_bom;
  -- 0727: the whole approved plan and its trim colours, before it reopens.
  update public.iwo_material_bom_revisions
     set snapshot = jsonb_build_object('plan', public.sample_plan_snapshot('accessories', p_bom),
                                       'shades', public.sample_plan_shade_lines('accessories', p_bom))
   where bom_id = p_bom and revision_no = v_next;
  update public.iwo_material_boms
     set approval_status = 'open', revision_no = v_next,
         submitted_at = null, submitted_by = null, updated_at = now()
   where id = p_bom;
  return v_next;
end;
$function$;
