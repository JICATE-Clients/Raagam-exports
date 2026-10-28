-- 0765 · EVERY PO IS APPROVED, ROUTED BY ITEM CLASS, AND NEVER WITHOUT A SIGNATURE
--        (user 2026-10-28; builds on 0764, which must be applied first)
--
-- 0764 sent only an above-budget / unbudgeted PO through the engine; a PO inside
-- budget still approved itself on save. The user's three answers change that:
--
--   1. "All POs require formal approval before the system unlocks PDF printing,
--      exporting, or emailing." Within budget → the approver set for that item
--      class; above budget → the MD (profit-variance escalation). Raise PO now
--      always saves `pending_approval` and starts a run (lib/purchase/re-po/actions.ts).
--
--   2. A PO mixing classes (Yarn + Trims) goes to the MOST SENIOR approver.
--      Seniority is FLOW PRIORITY, which the admin already orders on
--      Approvals ▸ Flows: the run carries `item_classes` (every class on the PO)
--      and the first flow whose classes include ANY of them wins. Yarn & Fabric →
--      MD sits at 200, so a trims flow an admin adds later (any priority above
--      200) can never pull a PO with yarn on it away from the MD. That needs a
--      matcher operator for a LIST context — `any`, section 1 — because `in`
--      compares one value and a PO has several classes.
--
--      No separate "PO Approver Master": the flow builder IS that master, and a
--      second table deciding the same thing is two answers that drift apart.
--
--   3. "Approval is blocked if the approver has no signature on file." 0764
--      copied `profiles.signature_path` as-is, NULL included, so a PO could be
--      approved and print with an empty signatory block. Section 2 refuses it
--      inside the decision, so My Approvals and the PO page refuse alike.

-- ---------------------------------------------------------------------------
-- 1. The matcher learns `any` — ONE branch spliced into the LIVE body
-- ---------------------------------------------------------------------------
-- Never retyped (the 0718b / 0720b / 0764 idiom). The anchor is the matcher's
-- final "unknown operator" refusal, as pg_get_functiondef prints it.
-- Fail-closed like every other branch: a context value that is not a list does
-- not match (other workflows send scalars and must never match a class flow).
do $$
declare
  v_def    text := pg_get_functiondef('public.approval_criteria_matches(jsonb,jsonb)'::regprocedure);
  v_anchor text := E'                ELSE\n                    RAISE EXCEPTION\n                        ''approval criteria: unknown operator';
  v_branch text := E'                ELSIF op = ''any'' THEN\n'
                || E'                    -- 0765: the context is a LIST (a PO''s item classes);\n'
                || E'                    -- passes when any member is one of the operand''s values.\n'
                || E'                    IF jsonb_typeof(ctx) <> ''array'' OR jsonb_typeof(opv) <> ''array'' THEN\n'
                || E'                        RETURN false;\n'
                || E'                    END IF;\n'
                || E'                    IF NOT EXISTS (\n'
                || E'                        SELECT 1 FROM jsonb_array_elements(ctx) c\n'
                || E'                        JOIN jsonb_array_elements(opv) o ON o = c\n'
                || E'                    ) THEN RETURN false; END IF;\n\n';
begin
  if position('''any''' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0765: approval_criteria_matches final refusal not found';
  end if;
  v_def := replace(v_def, v_anchor, v_branch || v_anchor);
  v_def := replace(v_def, 'Supported: in, ne, gt, gte, lt, lte.', 'Supported: in, ne, gt, gte, lt, lte, any.');
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The decision — 0764's body, plus the signature refusal
-- ---------------------------------------------------------------------------
create or replace function public.purchase_order_apply_decision(
  p_po uuid, p_run_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_rows int;
  v_sig  text;
begin
  if p_run_status = 'cancelled' then
    update public.purchase_orders
       set status = 'draft', updated_at = now()
     where id = p_po and status = 'pending_approval';
    return;
  end if;
  if p_run_status not in ('completed', 'rejected') then
    return;
  end if;

  if p_run_status = 'completed' then
    -- NO SIGNATURE, NO APPROVAL (0765). Raised here, inside the run's own
    -- transaction, so the approve is rolled back whole and the PO stays waiting.
    select pr.signature_path into v_sig from public.profiles pr where pr.id = p_actor;
    if v_sig is null then
      raise exception
        'Upload your signature before approving a purchase order — My Profile ▸ Signature. An approved PO prints the approver''s signature, so it cannot be approved without one.'
        using errcode = 'P0001';
    end if;

    update public.purchase_orders po
       set status                  = 'approved',
           approved_by             = p_actor,
           approved_at             = now(),
           approver_signature_path = v_sig,
           updated_at              = now()
     where po.id = p_po and po.status = 'pending_approval';
  else
    update public.purchase_orders po
       set status     = 'draft',
           notes      = concat_ws(E'\n', nullif(po.notes, ''), 'MD: ' || coalesce(nullif(trim(p_remark), ''), '(no reason given)')),
           updated_at = now()
     where po.id = p_po and po.status = 'pending_approval';
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception
      'Purchase order % is not waiting for approval, so this decision could not be applied. Reload it — it may already have been decided another way.',
      p_po using errcode = '55000';
  end if;
end;
$function$;
revoke all on function public.purchase_order_apply_decision(uuid, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A PO's item classes — what the run's context carries
-- ---------------------------------------------------------------------------
-- Codes (YARN, FABRIC, SEW, PACK, GAR, GEN), sorted and distinct, from each
-- line's item. Invoker: the Purchase Manager can already read their PO's lines.
create or replace function public.po_item_class_codes(p_po uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(distinct c.code order by c.code), '[]'::jsonb)
    from public.po_line_items l
    join public.items i on i.id = l.item_id
    join public.config_lookups c on c.id = i.item_class_id
   where l.purchase_order_id = p_po
     and c.code is not null
$$;
revoke all on function public.po_item_class_codes(uuid) from public, anon;
grant execute on function public.po_item_class_codes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The flows — most senior first
-- ---------------------------------------------------------------------------
-- The 0503 catch-all (→ MD, priority 900) stays as it is. Both new flows copy
-- its steps, so they route to whoever that one does today.
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'purchase_order', 'Purchase Order — above budget',
       'A rate above the approved order budget, or a line with no approved budget, goes to the Managing Director with the profit impact (0761).',
       '{"above_budget": true}'::jsonb, f.steps, 100, true
  from public.approval_flows f
 where f.workflow_key = 'purchase_order' and f.flow_name = 'Purchase Order — default'
   and not exists (select 1 from public.approval_flows x
                    where x.workflow_key = 'purchase_order' and x.flow_name = 'Purchase Order — above budget');

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'purchase_order', 'Purchase Order — Yarn & Fabric',
       'Any PO with a yarn or fabric line goes to the Managing Director, even when it also carries trims. Add a flow for other item classes at a priority ABOVE 200 so this one is checked first.',
       '{"item_classes": {"any": ["YARN", "FABRIC"]}}'::jsonb, f.steps, 200, true
  from public.approval_flows f
 where f.workflow_key = 'purchase_order' and f.flow_name = 'Purchase Order — default'
   and not exists (select 1 from public.approval_flows x
                    where x.workflow_key = 'purchase_order' and x.flow_name = 'Purchase Order — Yarn & Fabric');

-- ---------------------------------------------------------------------------
-- 5. Read it back
-- ---------------------------------------------------------------------------
do $$
begin
  if not public.approval_criteria_matches('{"item_classes": {"any": ["YARN", "FABRIC"]}}', '{"item_classes": ["SEW", "YARN"]}') then
    raise exception '0765: a Yarn + Trims PO did not match the Yarn & Fabric flow';
  end if;
  if public.approval_criteria_matches('{"item_classes": {"any": ["YARN", "FABRIC"]}}', '{"item_classes": ["SEW", "PACK"]}') then
    raise exception '0765: a trims-only PO matched the Yarn & Fabric flow';
  end if;
  if public.approval_criteria_matches('{"item_classes": {"any": ["YARN"]}}', '{"item_classes": "YARN"}') then
    raise exception '0765: `any` matched a scalar context — it must fail closed';
  end if;
  if public.approval_criteria_matches('{"item_classes": {"any": ["YARN"]}}', '{}') then
    raise exception '0765: `any` matched a missing key';
  end if;
  if (select f.flow_name from public.approval_flows f
       where f.workflow_key = 'purchase_order' and f.is_active
         and public.approval_criteria_matches(f.criteria, '{"above_budget": true, "item_classes": ["SEW"]}')
       order by f.priority, f.created_at limit 1) <> 'Purchase Order — above budget' then
    raise exception '0765: an above-budget PO is not routed to the above-budget flow first';
  end if;
  if position('My Profile' in pg_get_functiondef('public.purchase_order_apply_decision(uuid,text,uuid,text)'::regprocedure)) = 0 then
    raise exception '0765: the signature refusal is missing';
  end if;
end $$;
