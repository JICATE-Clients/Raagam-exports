-- 0732 · Sample ▸ Revision — "+ Add module": add the SWO's OTHER plan to a revision
--        that is already open.
--
-- User 2026-10-15 (with Orders ▸ Order Revisions side by side): the register should
-- offer what Orders' order line offers — "+ Add module" while an entry is open, so a
-- change that turns out to touch the Accessories Plan too joins the SAME revision
-- instead of becoming a second one beside it.
--
-- 0730 made one raise for both plans (`raise_sample_plan_revisions`), but only AT
-- raise time: nothing could put the second plan into an entry afterwards. This is
-- that missing door, and it is deliberately a thin one:
--
--   * IT REUSES THE RAISE. The added plan goes through `raise_fabric_plan_revision` /
--     `raise_accessories_plan_revision` (0730's bodies), so the snapshot (0727), the
--     never-reused revision number and the "only an approved plan" refusal are the
--     raise's own, not restated here. The new row then takes the entry's id, and its
--     REASON and ORIGIN — one revision, one why, one who-asked.
--   * ONLY WHILE THE ENTRY IS BEING WORKED. At least one plan of the entry is open
--     (`open` / `returned` at the revision's own number). Refused while a plan is
--     with the approver — as Abandon is (0730) and as Orders withholds changes while
--     the MD holds an entry — and refused once the entry is abandoned or decided.
--   * THE SAME SWO. The added plan must be the other plan of the SWO the entry
--     already revises (`sample_product_groups` pairs its two work orders), and must
--     not already be in the entry.
--
-- APPLY ORDER: 0731 was the ledger's latest when this was written (2026-10-15).

create or replace function public.add_plan_to_sample_revision(p_entry uuid, p_kind text, p_bom uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_reason text;
  v_origin text;
  v_fab_bom uuid;
  v_acc_bom uuid;
  v_open boolean := false;
  v_busy boolean := false;
  v_next integer;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'Adding a plan to a revision needs Orders ▸ Edit.' using errcode = '42501';
  end if;
  if p_kind not in ('fabric', 'accessories') then
    raise exception 'Pick the Fabric Plan or the Accessories Plan.' using errcode = '23514';
  end if;

  -- The entry as it stands: its plans, its reason and who asked (the earliest row).
  select r.bom_id, r.reason, r.origin into v_fab_bom, v_reason, v_origin
    from public.iwo_fabric_bom_revisions r
   where r.entry_id = p_entry and r.abandoned_at is null
   order by r.created_at limit 1;
  select r.bom_id, coalesce(v_reason, r.reason), coalesce(v_origin, r.origin) into v_acc_bom, v_reason, v_origin
    from public.iwo_material_bom_revisions r
   where r.entry_id = p_entry and r.abandoned_at is null
   order by r.created_at limit 1;
  if v_fab_bom is null and v_acc_bom is null then
    raise exception 'That revision no longer exists, or it was abandoned.' using errcode = 'P0002';
  end if;
  if (p_kind = 'fabric' and v_fab_bom is not null) or (p_kind = 'accessories' and v_acc_bom is not null) then
    raise exception 'That plan is already in this revision.' using errcode = '23514';
  end if;

  -- Open = a plan of the entry is being edited or was sent back, at the entry's own
  -- revision number. With the approver = submitted at that number.
  select bool_or(b.approval_status in ('open', 'returned')), bool_or(b.approval_status = 'submitted')
    into v_open, v_busy
    from (
      select f.approval_status from public.iwo_fabric_bom_revisions r
        join public.iwo_fabric_boms f on f.id = r.bom_id and f.revision_no = r.revision_no
       where r.entry_id = p_entry and r.abandoned_at is null
      union all
      select m.approval_status from public.iwo_material_bom_revisions r
        join public.iwo_material_boms m on m.id = r.bom_id and m.revision_no = r.revision_no
       where r.entry_id = p_entry and r.abandoned_at is null
    ) b;
  if coalesce(v_busy, false) then
    raise exception 'This revision is with the approver — add the plan once it is sent back.' using errcode = '55000';
  end if;
  if not coalesce(v_open, false) then
    raise exception 'This revision is decided — raise a new one to change the plan again.' using errcode = '55000';
  end if;

  -- The other plan of the SAME SWO.
  if not exists (
    select 1
      from public.sample_product_groups g
      join public.iwo_fabric_boms f on f.iwo_id = g.iwo_id
      join public.iwo_material_boms m on m.iwo_id = g.accessories_iwo_id
     where f.id = coalesce(case when p_kind = 'fabric' then p_bom end, v_fab_bom)
       and m.id = coalesce(case when p_kind = 'accessories' then p_bom end, v_acc_bom)) then
    raise exception 'That plan belongs to a different SWO — a revision covers one SWO.' using errcode = '23514';
  end if;

  -- The raise checks the plan (unit, approved) and refuses on its own terms; a
  -- refusal rolls the whole call back.
  if p_kind = 'fabric' then
    v_next := public.raise_fabric_plan_revision(p_bom, coalesce(v_reason, 'Added to the revision'));
    update public.iwo_fabric_bom_revisions
       set entry_id = p_entry, origin = v_origin
     where bom_id = p_bom and revision_no = v_next;
  else
    v_next := public.raise_accessories_plan_revision(p_bom, coalesce(v_reason, 'Added to the revision'));
    update public.iwo_material_bom_revisions
       set entry_id = p_entry, origin = v_origin
     where bom_id = p_bom and revision_no = v_next;
  end if;
  return v_next;
end;
$function$;

-- Both grants in one statement (AGENTS.md "Function grants"): PUBLIC and anon each hold one.
revoke all on function public.add_plan_to_sample_revision(uuid, text, uuid) from public, anon;
grant execute on function public.add_plan_to_sample_revision(uuid, text, uuid) to authenticated;
