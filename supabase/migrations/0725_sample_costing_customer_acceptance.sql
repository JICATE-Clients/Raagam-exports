-- 0725 · Sample Costing — the BUYER approves a costing, not the MD
--        (doc/sample/developer-ui-field-updates-report-v8.md §8.1 · §9;
--         user 2026-10-14: "the costing is created and handled directly by
--         the MD, an internal MD Approval Pending state is unnecessary").
--
-- REVERSES the same morning's "every costing → MD" (client: "each costing need
-- an approval"). The approval IS the buyer's, recorded by the merchandiser:
--
--   Draft ──Send to Buyer──► Under Progress ──Customer Approved──► Approved
--                             │   ▲                                 │
--                             │   └──── Revise (Rev N+1) ◄──────────┘
--                             └──Customer Rejected──► Rejected ──Revise──► Draft
--
-- UNDER PROGRESS IS THE EXISTING `submitted` VALUE, relabelled — "submitted to
-- the buyer". No sample sheet was `submitted` when this ran, so nothing moves,
-- and the cost_sheets status CHECK (shared with the legacy simple / IOC sheets)
-- is untouched. It is EDITABLE: counter-offers are typed straight onto it, and
-- Revise freezes the version the buyer was sent (superseded) and opens the next.
--
-- Three changes, each marked "0725":
--   1. save_sample_costing (re-created FROM THE LIVE BODY, 2026-10-14) —
--      an Under Progress sheet saves and STAYS Under Progress; Revise is allowed
--      from Under Progress too; the new version inherits Under Progress from an
--      approved / under-progress parent and Draft from a rejected one. A Sample
--      Revision's proposed costing still starts as Draft (0716's flow).
--   2. guard_sample_costing_revision — approved → superseded no longer needs a
--      Sample Revision: Revise is the costing's own button again (§8.1 "Post-
--      Approval Quotation Revise"). Sample Revision stays for Sample Info.
--   3. sample_is_approved — the SMP stays locked while an accepted costing is
--      being RE-negotiated: "approved" now means any version the buyer accepted
--      (approved_at stamped), not only the current one. Without this, Revise on
--      an accepted quote would silently unlock the sample entry.
--
-- The approval engine's `sample_costing` workflow and its terminal branch stay
-- in place, unread by anything new — no run is open, and removing a branch
-- from approval_apply_terminal is a riskier edit than leaving a dead one.

-- 1 ── save_sample_costing ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_sample_costing(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  h          jsonb := p -> 'header';
  sm         jsonb := coalesce(p -> 'header' -> 'summary', '{}'::jsonb);
  v_id       uuid := p_id;
  v_code     text;
  v_version  int;
  v_status   text;
  v_opp      uuid := nullif(h ->> 'opportunity_id', '')::uuid;
  v_style    uuid := nullif(h ->> 'style_id', '')::uuid;
  v_parent   uuid := nullif(h ->> 'parent_id', '')::uuid;
  v_draft    boolean := coalesce((h ->> 'is_draft')::boolean, false);
  v_pieces   uuid[] := '{}';
  v_fabrics  uuid[] := '{}';
  v_new      uuid;
  -- 0725: the status a NEW version starts in.
  v_start    text := 'draft';
  x          jsonb;
  y          jsonb;
  i          int;
  n          int;
begin
  if v_parent is not null and v_id is null then
    select c.opportunity_id, c.style_id, c.code, c.version, c.status
      into v_opp, v_style, v_code, v_version, v_status
      from public.cost_sheets c where c.id = v_parent for update;
    if not found then
      raise exception 'The costing being revised no longer exists.' using errcode = '23503';
    end if;
    -- 0725: Under Progress (`submitted`) revises too — each counter-offer is a Rev.
    if v_status not in ('approved', 'rejected', 'submitted') then
      raise exception 'Only a costing that is Under Progress, Approved or Rejected can be revised (this one is %).', v_status
        using errcode = '55000';
    end if;
    update public.cost_sheets set status = 'superseded' where id = v_parent;
    v_version := v_version + 1;
    -- 0725: the negotiation continues (Under Progress) unless the buyer had
    -- declined (a fresh Draft) or a Sample Revision is making it (0716: Draft).
    v_start := case when v_status = 'rejected' then 'draft' else 'submitted' end;
    if (public.sample_open_revision(v_opp)).id is not null then
      v_start := 'draft';
    end if;
  end if;

  if v_opp is null then
    raise exception 'Choose the Sample No before saving the costing.' using errcode = '23502';
  end if;
  if v_style is not null and not exists (
    select 1 from public.styles s where s.id = v_style and s.opportunity_id = v_opp
  ) then
    raise exception 'That style line does not belong to the chosen sample enquiry.' using errcode = '23503';
  end if;

  if v_id is null then
    insert into public.cost_sheets (
      opportunity_id, style_id, version, status, costing_type, costing_for, code, parent_cost_sheet_id,
      costing_date, currency_code, exchange_rate, margin_pct, garment_waste_pct, discount_pct,
      ship_mode, freight_per_pc, insurance_per_pc, buyer_target_price, commission_pct, notes, is_draft,
      fabric_cost, cmt_cost, garment_process_cost, trims_cost, other_expenses_cost, gross_cost,
      fob_inr, computed_fob, target_fob, profit_loss_pct
    ) values (
      v_opp, v_style, coalesce(v_version, 1), v_start, 'sample', 'sample', v_code, v_parent,
      coalesce(nullif(h ->> 'costing_date', '')::date, current_date),
      nullif(h ->> 'currency_code', ''),
      nullif(h ->> 'exchange_rate', '')::numeric,
      nullif(h ->> 'margin_pct', '')::numeric,
      nullif(h ->> 'garment_waste_pct', '')::numeric,
      nullif(h ->> 'discount_pct', '')::numeric,
      nullif(h ->> 'ship_mode', ''),
      nullif(h ->> 'freight_per_pc', '')::numeric,
      nullif(h ->> 'insurance_per_pc', '')::numeric,
      nullif(h ->> 'buyer_target_price', '')::numeric,
      nullif(h ->> 'commission_pct', '')::numeric,
      nullif(h ->> 'notes', ''),
      v_draft,
      nullif(sm ->> 'fabric_cost', '')::numeric,
      nullif(sm ->> 'cmt_cost', '')::numeric,
      nullif(sm ->> 'garment_process_cost', '')::numeric,
      nullif(sm ->> 'trims_cost', '')::numeric,
      nullif(sm ->> 'other_expenses_cost', '')::numeric,
      nullif(sm ->> 'gross_cost', '')::numeric,
      nullif(sm ->> 'fob_inr', '')::numeric,
      coalesce(nullif(sm ->> 'computed_fob', '')::numeric, 0),
      nullif(sm ->> 'target_fob', '')::numeric,
      nullif(sm ->> 'profit_loss_pct', '')::numeric
    )
    returning id, code, version into v_id, v_code, v_version;
  else
    select c.status into v_status from public.cost_sheets c where c.id = v_id for update;
    if not found then
      raise exception 'This costing no longer exists.' using errcode = '23503';
    end if;
    -- 0725: Under Progress is edited in place during the negotiation; a
    -- Rejected sheet is the buyer's closed answer — Revise it instead.
    if v_status not in ('draft', 'submitted') then
      raise exception 'This costing is % and cannot be changed. Revise it to negotiate a new price.', v_status
        using errcode = '55000';
    end if;
    update public.cost_sheets set
      opportunity_id      = v_opp,
      style_id            = v_style,
      -- 0725: an Under Progress sheet stays Under Progress when saved.
      status              = case when v_status = 'submitted' then 'submitted' else 'draft' end,
      costing_date        = coalesce(nullif(h ->> 'costing_date', '')::date, costing_date, current_date),
      currency_code       = nullif(h ->> 'currency_code', ''),
      exchange_rate       = nullif(h ->> 'exchange_rate', '')::numeric,
      margin_pct          = nullif(h ->> 'margin_pct', '')::numeric,
      garment_waste_pct   = nullif(h ->> 'garment_waste_pct', '')::numeric,
      discount_pct        = nullif(h ->> 'discount_pct', '')::numeric,
      ship_mode           = nullif(h ->> 'ship_mode', ''),
      freight_per_pc      = nullif(h ->> 'freight_per_pc', '')::numeric,
      insurance_per_pc    = nullif(h ->> 'insurance_per_pc', '')::numeric,
      buyer_target_price  = nullif(h ->> 'buyer_target_price', '')::numeric,
      commission_pct      = nullif(h ->> 'commission_pct', '')::numeric,
      notes               = nullif(h ->> 'notes', ''),
      is_draft            = v_draft,
      fabric_cost         = nullif(sm ->> 'fabric_cost', '')::numeric,
      cmt_cost            = nullif(sm ->> 'cmt_cost', '')::numeric,
      garment_process_cost = nullif(sm ->> 'garment_process_cost', '')::numeric,
      trims_cost          = nullif(sm ->> 'trims_cost', '')::numeric,
      other_expenses_cost = nullif(sm ->> 'other_expenses_cost', '')::numeric,
      gross_cost          = nullif(sm ->> 'gross_cost', '')::numeric,
      fob_inr             = nullif(sm ->> 'fob_inr', '')::numeric,
      computed_fob        = coalesce(nullif(sm ->> 'computed_fob', '')::numeric, 0),
      target_fob          = nullif(sm ->> 'target_fob', '')::numeric,
      profit_loss_pct     = nullif(sm ->> 'profit_loss_pct', '')::numeric
    where id = v_id
    returning code, version into v_code, v_version;

    delete from public.sample_costing_quotes where cost_sheet_id = v_id;
    delete from public.sample_costing_trims where cost_sheet_id = v_id;
    delete from public.sample_costing_component_weights where cost_sheet_id = v_id;
    delete from public.sample_costing_fabrics where cost_sheet_id = v_id;
    delete from public.sample_costing_pieces where cost_sheet_id = v_id;
  end if;

  -- 0690: Overhead % (UI/UX spec §4.5).
  update public.cost_sheets set overhead_pct = nullif(h ->> 'overhead_pct', '')::numeric where id = v_id;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'pieces', '[]'::jsonb)) loop
    insert into public.sample_costing_pieces (
      cost_sheet_id, sno, piece_name, coordinate_id, cmt, print_cost, embroidery_cost, wash_cost, testing_cost, bank_cost,
      cmt_direct
    ) values (
      v_id, i + 1,
      coalesce(nullif(btrim(x ->> 'piece_name'), ''), 'GARMENT'),
      nullif(x ->> 'coordinate_id', '')::uuid,
      nullif(x ->> 'cmt', '')::numeric,
      nullif(x ->> 'print_cost', '')::numeric,
      nullif(x ->> 'embroidery_cost', '')::numeric,
      nullif(x ->> 'wash_cost', '')::numeric,
      nullif(x ->> 'testing_cost', '')::numeric,
      nullif(x ->> 'bank_cost', '')::numeric,
      -- 0692: Direct rate (the flat `cmt`) or the operation lines below.
      coalesce((x ->> 'cmt_direct')::boolean, true)
    ) returning id into v_new;
    v_pieces := v_pieces || v_new;
    -- 0692: CMT operations and Embellishments picked from the Process master.
    n := 0;
    for y in select * from jsonb_array_elements(coalesce(x -> 'lines', '[]'::jsonb)) loop
      n := n + 1;
      insert into public.sample_costing_piece_processes (piece_id, sno, kind, process_id, process_name, rate)
      values (v_new, n, y ->> 'kind', nullif(y ->> 'process_id', '')::uuid,
              nullif(btrim(y ->> 'process_name'), ''), nullif(y ->> 'rate', '')::numeric);
    end loop;
    i := i + 1;
  end loop;
  if cardinality(v_pieces) = 0 then
    raise exception 'A costing needs at least one garment piece.' using errcode = '23502';
  end if;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'fabrics', '[]'::jsonb)) loop
    insert into public.sample_costing_fabrics (
      cost_sheet_id, sno, fabric_id, quality, yarn_rate, knitting_rate, dyeing_rate, process_loss_pct, is_direct, direct_rate
    ) values (
      v_id, i + 1,
      nullif(x ->> 'fabric_id', '')::uuid,
      nullif(btrim(x ->> 'quality'), ''),
      nullif(x ->> 'yarn_rate', '')::numeric,
      nullif(x ->> 'knitting_rate', '')::numeric,
      nullif(x ->> 'dyeing_rate', '')::numeric,
      nullif(x ->> 'process_loss_pct', '')::numeric,
      coalesce((x ->> 'is_direct')::boolean, false),
      nullif(x ->> 'direct_rate', '')::numeric
    ) returning id into v_new;
    v_fabrics := v_fabrics || v_new;
    -- 0690: Finishing rate and the Yarn Mix breakdown (UI/UX spec §4.2).
    update public.sample_costing_fabrics set finishing_rate = nullif(x ->> 'finishing_rate', '')::numeric where id = v_new;
    n := 0;
    for y in select * from jsonb_array_elements(coalesce(x -> 'yarns', '[]'::jsonb)) loop
      n := n + 1;
      insert into public.sample_costing_fabric_yarns (fabric_line_id, sno, item_id, yarn_name, mix_pct, rate)
      values (v_new, n, nullif(y ->> 'item_id', '')::uuid, nullif(btrim(y ->> 'yarn_name'), ''),
              nullif(y ->> 'mix_pct', '')::numeric, nullif(y ->> 'rate', '')::numeric);
    end loop;
    n := 0;
    for y in select * from jsonb_array_elements(coalesce(x -> 'processes', '[]'::jsonb)) loop
      n := n + 1;
      insert into public.sample_costing_fabric_processes (fabric_line_id, sno, process_id, process_name, rate)
      values (v_new, n, nullif(y ->> 'process_id', '')::uuid, nullif(btrim(y ->> 'process_name'), ''), nullif(y ->> 'rate', '')::numeric);
    end loop;
    i := i + 1;
  end loop;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'consumptions', '[]'::jsonb)) loop
    i := i + 1;
    if (x ->> 'piece_index')::int is null or (x ->> 'piece_index')::int >= cardinality(v_pieces) then
      raise exception 'Consumption line % names a garment piece that is not on the costing.', i using errcode = '22023';
    end if;
    insert into public.sample_costing_component_weights (
      cost_sheet_id, sno, piece_id, fabric_line_id, component_id, size_name, weight_g, length_cm, width_cm, gsm
    ) values (
      v_id, i,
      v_pieces[(x ->> 'piece_index')::int + 1],
      case when nullif(x ->> 'fabric_index', '') is null then null
           else v_fabrics[(x ->> 'fabric_index')::int + 1] end,
      nullif(x ->> 'component_id', '')::uuid,
      nullif(btrim(x ->> 'size_name'), ''),
      nullif(x ->> 'weight_g', '')::numeric,
      nullif(x ->> 'length_cm', '')::numeric,
      nullif(x ->> 'width_cm', '')::numeric,
      nullif(x ->> 'gsm', '')::numeric
    ) returning id into v_new;
    -- 0690: the component's wastage allowance (UI/UX spec §4.3).
    update public.sample_costing_component_weights set wastage_pct = nullif(x ->> 'wastage_pct', '')::numeric where id = v_new;
    -- 0699: every component the line weighs together; component_id stays the first.
    update public.sample_costing_component_weights
       set component_ids = coalesce(
             (select array_agg(c::uuid order by o)
                from jsonb_array_elements_text(coalesce(x -> 'component_ids', '[]'::jsonb)) with ordinality as t(c, o)
               where nullif(c, '') is not null),
             case when component_id is null then '{}'::uuid[] else array[component_id] end)
     where id = v_new;
  end loop;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'trims', '[]'::jsonb)) loop
    i := i + 1;
    if (x ->> 'piece_index')::int is null or (x ->> 'piece_index')::int >= cardinality(v_pieces) then
      raise exception 'Trim line % names a garment piece that is not on the costing.', i using errcode = '22023';
    end if;
    insert into public.sample_costing_trims (
      cost_sheet_id, sno, piece_id, item_id, description, qty, rate, is_direct, pack_price, pack_size
    )
    values (
      v_id, i,
      v_pieces[(x ->> 'piece_index')::int + 1],
      nullif(x ->> 'item_id', '')::uuid,
      nullif(btrim(x ->> 'description'), ''),
      nullif(x ->> 'qty', '')::numeric,
      nullif(x ->> 'rate', '')::numeric,
      coalesce((x ->> 'is_direct')::boolean, true),
      nullif(x ->> 'pack_price', '')::numeric,
      nullif(x ->> 'pack_size', '')::numeric
    );
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p -> 'quotes', '[]'::jsonb)) loop
    if (x ->> 'piece_index')::int is null or (x ->> 'piece_index')::int >= cardinality(v_pieces) then
      continue;
    end if;
    if nullif(x ->> 'quoted_price', '') is null then
      continue;
    end if;
    insert into public.sample_costing_quotes (cost_sheet_id, piece_id, size_name, quoted_price)
    values (
      v_id,
      v_pieces[(x ->> 'piece_index')::int + 1],
      nullif(btrim(x ->> 'size_name'), ''),
      (x ->> 'quoted_price')::numeric
    );
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code, 'version', v_version);
end;
$function$;

-- 2 ── guard_sample_costing_revision ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_sample_costing_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_rev  public.sample_revisions;
begin
  if new.costing_type is distinct from 'sample' or new.status is not distinct from old.status then
    return new;
  end if;
  v_rev := public.sample_open_revision(new.opportunity_id);
  -- 0725: approved → superseded is the costing's own Revise again; the 0716
  -- refusal ("raise a Sample Revision with a costing module") is gone.
  if new.status in ('submitted', 'approved')
     and v_rev.id is not null
     and exists (select 1 from jsonb_array_elements(v_rev.costing_pairs) p where (p ->> 'proposed_id')::uuid = new.id)
     and coalesce(current_setting('raagam.sample_revision', true), '') <> 'on' then
    raise exception 'This costing is part of Sample Revision % — send it to the MD from Sample ▸ Revision.',
      v_rev.revision_code using errcode = '55000';
  end if;
  return new;
end;
$function$;

-- 3 ── sample_is_approved ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sample_is_approved(p_opp uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 0725: any version the buyer accepted — the current one, or one now being
  -- re-negotiated by Revise (superseded, but stamped approved_at).
  select exists (select 1 from public.cost_sheets c
     where c.opportunity_id = p_opp and c.costing_type = 'sample'
       and (c.status = 'approved' or (c.status = 'superseded' and c.approved_at is not null)));
$function$;
