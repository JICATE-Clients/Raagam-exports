-- 0845 · KNITTING ORDER — GST %, BY VENDOR (knitter's own yarn), NET RATE vs BUDGET APPROVAL
-- Session 1 of "Modular Developer Specification: Knitting, Outward DC & Access Control" (2026-11-14).
--
-- The spec's own SQL targets `knitting_programs`, which 0828 dropped — a Knitting Order is a
-- `process_orders` row (0825). Everything here lands on the real tables. Decisions (user 2026-11-14):
--
--   * NET RATE is checked per fabric line against the Knitting rate in THAT LINE's RE's APPROVED
--     Order Budget (`order_budget_lines` source 'fabric_process', process `is_knitting`, per_unit).
--     A line whose RE has no approved budget rate ALSO needs approval — nothing goes out unpriced.
--   * Over budget → `rate_approval = 'pending'` and a `knitting_rate` approval run (My Approvals,
--     MD — the Purchase Order default flow's steps, as `knitting_close` did in 0830). The order cannot
--     leave draft until the MD approves: a trigger refuses the status change, so the rule holds for
--     every writer, not only the screen.
--   * BY VENDOR = the KNITTER USES THEIR OWN YARN. Such an order carries no yarn lines at all — no
--     Job Work DC, no stock check, no yarn drawn on receipt (`knitting_receipt_post` loops over the
--     order's yarn rows and finds none). Issue takes it straight to `in_process`, the state receipt
--     requires, because the yarn is already at the knitter by definition.
--
-- knitting_order_save is PATCHED IN PLACE from its live body (0836) — never re-created from an old
-- copy (AGENTS.md / memory: that is how guards get lost). Each anchor must match exactly once.
-- approval_apply_terminal likewise (0830's idiom). 0830's branch caught EVERY process_orders run; it
-- is narrowed to workflow_key = 'knitting_close' here, or a knitting_rate approve would fall into the
-- close callback and roll back ("not waiting for a close decision").

-- ---------------------------------------------------------------------------
-- 1. Header columns
-- ---------------------------------------------------------------------------
alter table public.process_orders
  add column if not exists gst_rate_pct numeric(5,2) check (gst_rate_pct is null or (gst_rate_pct >= 0 and gst_rate_pct <= 28)),
  add column if not exists is_by_vendor boolean not null default false,
  add column if not exists rate_approval text check (rate_approval is null or rate_approval in ('pending', 'approved', 'rejected')),
  add column if not exists rate_approval_note text;

comment on column public.process_orders.gst_rate_pct is 'Knitting Order: GST % on the knitting charge (0845). Net Rate is before GST.';
comment on column public.process_orders.is_by_vendor is 'Knitting Order: the knitter uses their own yarn — no yarn lines, no DC (0845).';
comment on column public.process_orders.rate_approval is 'Knitting Order: null = not asked; pending / approved / rejected by the MD for a Net Rate above (or without) budget (0845).';

-- ---------------------------------------------------------------------------
-- 2. The budget rate of one (RE, fabric) — ONE distinct approved Knitting rate, else null
-- ---------------------------------------------------------------------------
-- A colour-basis budget can split one fabric into several lines; when they disagree there is no
-- single rate to compare against, so it reads as "no budget rate" and the line needs approval.
create or replace function public.knitting_budget_rate(p_sales_order_id uuid, p_fabric_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select max(bl.rate)
    from public.garment_order_amendments goa
    join public.order_budget_orders bo on bo.garment_order_id = goa.id
    join public.order_budgets b on b.id = bo.budget_id and b.status = 'approved'
    join public.order_budget_lines bl on bl.budget_id = b.id
                                    and bl.garment_order_id = goa.id
                                    and bl.source = 'fabric_process'
                                    and bl.item_id = p_fabric_item_id
                                    and bl.rate is not null
                                    and coalesce(bl.rate_type, 'per_unit') = 'per_unit'
    join public.processes p on p.id = bl.process_id and p.is_knitting
   where goa.sales_order_id = p_sales_order_id
  having count(distinct bl.rate) = 1
$$;
revoke all on function public.knitting_budget_rate(uuid, uuid) from public, anon;
grant execute on function public.knitting_budget_rate(uuid, uuid) to authenticated;

-- Every fabric line of one order with its budget rate and whether it needs the MD.
create or replace function public.knitting_rate_lines(p_order_id uuid)
returns table (knit_fabric_id uuid, fabric_name text, rate_per_kg numeric, budget_rate numeric, over_budget boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, i.name, f.rate_per_kg, br.rate,
         (br.rate is null or f.rate_per_kg > br.rate)
    from public.process_order_knit_fabrics f
    join public.process_orders po on po.id = f.process_order_id
    left join public.items i on i.id = f.fabric_item_id
    cross join lateral (select public.knitting_budget_rate(coalesce(f.sales_order_id, po.sales_order_id), f.fabric_item_id) as rate) br
   where f.process_order_id = p_order_id
     and public.is_current_location(po.location_id)
   order by f.sno
$$;
revoke all on function public.knitting_rate_lines(uuid) from public, anon;
grant execute on function public.knitting_rate_lines(uuid) to authenticated;

create or replace function public.knitting_rate_needs_approval(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.knitting_rate_lines(p_order_id) x where x.over_budget)
$$;
revoke all on function public.knitting_rate_needs_approval(uuid) from public, anon;
grant execute on function public.knitting_rate_needs_approval(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. knitting_order_save — live body, patched
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.knitting_order_save(uuid,jsonb)'::regprocedure);
  r record;
begin
  if position('v_own' in v_def) > 0 then
    return; -- already applied
  end if;
  for r in
    select * from (values
      -- the flag, read once
      (E'  v_placed text;\nbegin',
       E'  v_placed text;\n  v_own  boolean := coalesce((p->>''is_by_vendor'')::boolean, false);\nbegin'),
      -- a KO with the MD cannot be changed under the approval
      (E'    if v_row.status <> ''draft'' then',
       E'    if exists (select 1 from public.process_orders where id = v_id and rate_approval = ''pending'') then\n      raise exception ''This knitting order is waiting for the MD to approve its rate — it cannot be changed until then'' using errcode = ''P0001'';\n    end if;\n    if v_row.status <> ''draft'' then'),
      -- own yarn: no yarns needed …
      (E'    if jsonb_array_length(coalesce(f->''yarns'', ''[]''::jsonb)) = 0 then',
       E'    if not v_own and jsonb_array_length(coalesce(f->''yarns'', ''[]''::jsonb)) = 0 then'),
      (E'    if abs(v_sum - 100) > 0.01 then',
       E'    if not v_own and abs(v_sum - 100) > 0.01 then'),
      -- … and none written
      (E'    for y in select * from jsonb_array_elements(f->''yarns'') loop',
       E'    for y in select * from jsonb_array_elements(case when v_own then ''[]''::jsonb else coalesce(f->''yarns'', ''[]''::jsonb) end) loop'),
      -- the header fields; any save asks the rate question afresh
      (E'  update public.process_orders set total_amount = round(v_total, 2) where id = v_id;',
       E'  update public.process_orders set total_amount = round(v_total, 2),\n         gst_rate_pct = nullif(p->>''gst_rate_pct'', '''')::numeric,\n         is_by_vendor = v_own,\n         rate_approval = null,\n         rate_approval_note = null\n   where id = v_id;')
    ) t(old_s, new_s)
  loop
    if (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s) <> 1 then
      raise exception '0845: knitting_order_save — anchor found % times, expected once: %',
        (length(v_def) - length(replace(v_def, r.old_s, ''))) / length(r.old_s), r.old_s;
    end if;
    v_def := replace(v_def, r.old_s, r.new_s);
  end loop;
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The gate — a knitting order leaves draft only with its rate in budget or approved
-- ---------------------------------------------------------------------------
create or replace function public.knitting_rate_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.process_type <> 'knitting' or old.status <> 'draft'
     or new.status in ('draft', 'cancelled') then
    return new;
  end if;
  if coalesce(new.rate_approval, '') = 'approved' then
    return new;
  end if;
  if new.rate_approval = 'pending' then
    raise exception 'Knitting order % is waiting for the MD to approve its Net Rate', coalesce(new.code, '') using errcode = 'P0001';
  end if;
  if public.knitting_rate_needs_approval(new.id) then
    raise exception 'Knitting order %: a Net Rate is above the approved budget (or the RE has no approved budget) — send it to the MD first', coalesce(new.code, '')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.knitting_rate_gate() from public, anon, authenticated;

drop trigger if exists trg_proc_k_rate_gate on public.process_orders;
create trigger trg_proc_k_rate_gate
  before update of status on public.process_orders
  for each row execute function public.knitting_rate_gate();

-- ---------------------------------------------------------------------------
-- 5. Ask the MD — mark pending (the app then starts the run, as a PO does)
-- ---------------------------------------------------------------------------
create or replace function public.knitting_rate_request(p_order_id uuid)
returns boolean   -- true = the MD must approve (now pending); false = within budget, nothing to ask
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to issue a knitting order' using errcode = '42501';
  end if;
  select * into o from public.process_orders where id = p_order_id for update;
  if o.id is null or o.process_type <> 'knitting' or not public.is_current_location(o.location_id) then
    raise exception 'That knitting order is not in your unit' using errcode = 'P0001';
  end if;
  if o.status <> 'draft' then
    return false;
  end if;
  if o.rate_approval in ('pending', 'approved') then
    return o.rate_approval = 'pending';
  end if;
  if not public.knitting_rate_needs_approval(p_order_id) then
    return false;
  end if;
  update public.process_orders set rate_approval = 'pending', rate_approval_note = null where id = p_order_id;
  return true;
end;
$$;
revoke all on function public.knitting_rate_request(uuid) from public, anon;
grant execute on function public.knitting_rate_request(uuid) to authenticated;

-- The run could not be started — back to "not asked", so the operator can try again.
create or replace function public.knitting_rate_request_undo(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.process_orders set rate_approval = null
   where id = p_order_id and process_type = 'knitting' and rate_approval = 'pending'
     and public.has_permission('stores', 'edit') and public.is_current_location(location_id);
$$;
revoke all on function public.knitting_rate_request_undo(uuid) from public, anon;
grant execute on function public.knitting_rate_request_undo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The MD's decision
-- ---------------------------------------------------------------------------
create or replace function public.knitting_rate_apply_decision(p_id uuid, p_run_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_run_status = 'completed' then
    update public.process_orders set rate_approval = 'approved', rate_approval_note = p_remark
     where id = p_id and process_type = 'knitting' and rate_approval = 'pending';
  elsif p_run_status = 'rejected' then
    update public.process_orders set rate_approval = 'rejected', rate_approval_note = p_remark
     where id = p_id and process_type = 'knitting' and rate_approval = 'pending';
  elsif p_run_status = 'cancelled' then
    update public.process_orders set rate_approval = null, rate_approval_note = p_remark
     where id = p_id and process_type = 'knitting' and rate_approval = 'pending';
  end if;
end;
$$;
revoke all on function public.knitting_rate_apply_decision(uuid, text, uuid, text) from public, anon, authenticated;

do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_old    text := E'    if new.subject_table = ''process_orders'' then\n        perform public.knitting_close_apply_decision';
  v_new    text := E'    if new.workflow_key = ''knitting_close'' then\n        perform public.knitting_close_apply_decision';
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.workflow_key = ''knitting_rate'' then\n'
                || E'        perform public.knitting_rate_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark);\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('knitting_rate_apply_decision' in v_def) > 0 then
    return;
  end if;
  -- 0830's branch caught every process_orders run; narrow it to its own workflow.
  if position(v_old in v_def) > 0 then
    v_def := replace(v_def, v_old, v_new);
  elsif position(E'new.workflow_key = ''knitting_close''' in v_def) = 0 then
    raise exception '0845: approval_apply_terminal — the 0830 knitting_close branch was not found';
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0845: approval_apply_terminal final refusal not found — add the branch by hand.';
  end if;
  -- The new branch goes BEFORE the knitting_close one is irrelevant now (keyed by workflow), so
  -- it simply joins the others above the final refusal.
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

-- The flow — the MD (Purchase Order default's steps), catch-all, editable on Approvals ▸ Flows.
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'knitting_rate',
       'Knitting Rate — default',
       'Catch-all. A Knitting Order whose Net Rate is above the RE''s approved budget Knitting rate, or whose RE has no approved budget rate. Approve lets it be issued.',
       '{}'::jsonb, f.steps, 900, true
  from public.approval_flows f
 where f.workflow_key = 'purchase_order' and f.flow_name = 'Purchase Order — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'knitting_rate');

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare
  v_save text := pg_get_functiondef('public.knitting_order_save(uuid,jsonb)'::regprocedure);
  v_term text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
begin
  if position('v_own' in v_save) = 0 or position('rate_approval = null' in v_save) = 0
     or position('v_fso' in v_save) = 0 then
    raise exception '0845: knitting_order_save was not patched (or lost 0836)';
  end if;
  if position('knitting_rate_apply_decision' in v_term) = 0
     or position(E'new.workflow_key = ''knitting_close''' in v_term) = 0 then
    raise exception '0845: approval_apply_terminal was not patched';
  end if;
  if not exists (select 1 from public.approval_flows where workflow_key = 'knitting_rate') then
    raise exception '0845: the knitting_rate flow was not seeded (no "Purchase Order — default" flow?)';
  end if;
end $$;
