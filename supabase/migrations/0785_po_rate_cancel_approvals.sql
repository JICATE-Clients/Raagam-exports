-- 0785 · PO RATE AMENDMENTS AND PO CANCELLATIONS THROUGH MY APPROVALS (user 2026-10-31)
--
-- Two PO changes that used to be decided outside the approval engine:
--
--   RATE AMENDMENT. `po_rate_amendments` had draft → submitted → approved, with the
--   approve writing the new rate straight onto the line from the Rate Amendments
--   screen (no run, no inbox, reject without a reason, GST and the PO total left
--   stale). Now Submit starts a `po_rate_amendment` run; the run's END writes the
--   rate — here, inside `approval_apply_terminal`, like every other document.
--
--   CANCELLATION. `cancelPurchaseOrder` cancelled the WHOLE PO at once for anyone
--   with edit. Now an approved / partly received PO is cancelled by a REQUEST —
--   the whole PO or chosen lines with a quantity each, reason mandatory — that
--   starts a `po_cancellation` run; the final approve applies it.
--
-- Approver: the Managing Director for both (user's choice "keep MD"), seeded as a
-- catch-all flow per workflow — editable later on Approvals ▸ Flows.
--
-- HOW A PARTIAL CANCEL REOPENS THE REQUIREMENT. The line's `quantity` is reduced by
-- the cancelled qty and the cut is kept in the new `cancelled_qty`. Everything that
-- reads "what is still ordered" already reads `quantity` — the requirement balance
-- (po_requirement_lines), the GRN's open lines, tolerance and the receipt status —
-- so none of those functions is redefined here. `quantity + cancelled_qty` is what
-- was first ordered.
--
-- WHAT THE RUN'S ENDS MEAN
--   rate amendment   completed → line rate, amount and GST rewritten, PO total moved by
--                                 the difference; amendment approved
--                    rejected  → amendment rejected with the MD's reason; PO untouched
--                    cancelled → amendment back to draft (the raiser withdrew it)
--   cancellation     completed → each line cut; a PO with nothing left open reads
--                                 Cancelled (nothing received) or Received
--                    rejected  → request rejected with the reason; PO untouched
--                    cancelled → request withdrawn

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.po_rate_amendments
  add column if not exists decision_remark text;
comment on column public.po_rate_amendments.decision_remark is
  'The approver''s remark when the run ended (0785) — the reason, on a reject.';

-- One amendment in flight per line: two open at once would each be applied over the other.
create unique index if not exists uq_po_rate_amendments_open_line
  on public.po_rate_amendments (po_line_item_id) where status = 'submitted';

alter table public.po_line_items
  add column if not exists cancelled_qty numeric not null default 0;
do $$ begin
  alter table public.po_line_items
    add constraint chk_poli_cancelled_qty check (cancelled_qty >= 0);
exception when duplicate_object then null; end $$;
comment on column public.po_line_items.cancelled_qty is
  'Qty cancelled off this line by approved PO cancellation requests (0785). Already taken off `quantity`, so quantity + cancelled_qty is what was first ordered.';

-- ---------------------------------------------------------------------------
-- 2. The cancellation request and its lines
-- ---------------------------------------------------------------------------
create sequence if not exists public.seq_po_cancellation_request;

create table if not exists public.po_cancellation_requests (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  scope             text not null check (scope in ('whole', 'partial')),
  reason            text not null check (length(btrim(reason)) > 0),
  status            text not null default 'submitted'
                    check (status in ('submitted', 'approved', 'rejected', 'withdrawn')),
  decided_by        uuid references public.profiles(id),
  decided_at        timestamptz,
  decision_remark   text,
  created_by        uuid default auth.uid() references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.po_cancellation_requests is
  'A request to cancel a PO, whole or by line (0785). Applied only by the po_cancellation run''s final approve.';

create index if not exists idx_pocr_po on public.po_cancellation_requests(purchase_order_id);
-- One request in flight per PO.
create unique index if not exists uq_pocr_open_po
  on public.po_cancellation_requests (purchase_order_id) where status = 'submitted';

drop trigger if exists trg_pocr_code on public.po_cancellation_requests;
create trigger trg_pocr_code before insert on public.po_cancellation_requests
  for each row execute function public.assign_code('POCR', 'public.seq_po_cancellation_request');
drop trigger if exists trg_pocr_updated on public.po_cancellation_requests;
create trigger trg_pocr_updated before update on public.po_cancellation_requests
  for each row execute function public.set_updated_at();

create table if not exists public.po_cancellation_request_lines (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references public.po_cancellation_requests(id) on delete cascade,
  po_line_item_id uuid not null references public.po_line_items(id) on delete cascade,
  cancel_qty      numeric not null check (cancel_qty > 0),
  -- What was still open on the line when the request was raised — the card's "of N".
  open_qty        numeric not null default 0,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (request_id, po_line_item_id)
);
create index if not exists idx_pocrl_request on public.po_cancellation_request_lines(request_id);
create index if not exists idx_pocrl_line on public.po_cancellation_request_lines(po_line_item_id);

-- RLS — the request follows its PO's unit (AGENTS.md "Locations"), the lines follow
-- their request. Raising one is an EDIT of the PO (the old direct cancel's gate). No
-- client deletes or decides a request: the decision is the run's, below.
alter table public.po_cancellation_requests enable row level security;
drop policy if exists pocr_read on public.po_cancellation_requests;
create policy pocr_read on public.po_cancellation_requests for select to authenticated
  using (public.has_permission('materials_purchase', 'view') and public.lv_purchase_orders(purchase_order_id));
drop policy if exists pocr_insert on public.po_cancellation_requests;
create policy pocr_insert on public.po_cancellation_requests for insert to authenticated
  with check (public.has_permission('materials_purchase', 'edit') and public.lv_purchase_orders(purchase_order_id));
drop policy if exists pocr_delete on public.po_cancellation_requests;
-- Only the action's own clean-up when the run could not be started (status still submitted).
create policy pocr_delete on public.po_cancellation_requests for delete to authenticated
  using (public.has_permission('materials_purchase', 'edit') and public.lv_purchase_orders(purchase_order_id)
         and status = 'submitted' and created_by = auth.uid());

alter table public.po_cancellation_request_lines enable row level security;
drop policy if exists pocrl_read on public.po_cancellation_request_lines;
create policy pocrl_read on public.po_cancellation_request_lines for select to authenticated
  using (public.has_permission('materials_purchase', 'view')
         and exists (select 1 from public.po_cancellation_requests r
                      where r.id = request_id and public.lv_purchase_orders(r.purchase_order_id)));
drop policy if exists pocrl_insert on public.po_cancellation_request_lines;
create policy pocrl_insert on public.po_cancellation_request_lines for insert to authenticated
  with check (public.has_permission('materials_purchase', 'edit')
              and exists (select 1 from public.po_cancellation_requests r
                           where r.id = request_id and r.status = 'submitted'
                             and public.lv_purchase_orders(r.purchase_order_id)));

-- ---------------------------------------------------------------------------
-- 3. A quantity cut is never "more than the requirement"
-- ---------------------------------------------------------------------------
-- The requirement cap and the To-be-advised refusal both fire on a quantity UPDATE.
-- A DECREASE never orders more of anything, so both stand down for it — otherwise an
-- approved cancellation is refused exactly when it is needed (a requirement that
-- shrank, an item turned To be advised since the PO). Spliced into the live bodies.
do $$
declare
  v_def    text := pg_get_functiondef('public.po_line_requirement_cap()'::regprocedure);
  v_anchor text := E'  if new.req_key is null or v_src is null then';
  v_branch text := E'  -- 0785: cutting a line''s qty (a PO cancellation) never orders more.\n'
                || E'  if tg_op = ''UPDATE'' and coalesce(new.quantity, 0) <= coalesce(old.quantity, 0)\n'
                || E'     and new.req_key is not distinct from old.req_key\n'
                || E'     and coalesce(new.garment_order_id, new.iwo_id) is not distinct from coalesce(old.garment_order_id, old.iwo_id) then\n'
                || E'    return new;\n'
                || E'  end if;\n\n';
begin
  if position('0785:' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0785: po_line_requirement_cap anchor not found — add the decrease branch by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

do $$
declare
  v_def    text := pg_get_functiondef('public.refuse_advised_po_line()'::regprocedure);
  v_anchor text := E'     and NEW.quantity is not distinct from OLD.quantity then';
  v_new    text := E'     and coalesce(NEW.quantity, 0) <= coalesce(OLD.quantity, 0) then  -- 0785: a cut never orders more';
begin
  if position('0785:' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0785: refuse_advised_po_line anchor not found — relax the quantity test by hand.';
  end if;
  execute replace(v_def, v_anchor, v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 4. The rate amendment's decision
-- ---------------------------------------------------------------------------
create or replace function public.po_rate_amendment_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  a        public.po_rate_amendments%rowtype;
  l        record;
  v_pct    numeric;
  v_old    numeric;
  v_oldgst numeric;
  v_amt    numeric;
  v_gst    numeric;
begin
  if p_run_status = 'cancelled' then
    update public.po_rate_amendments
       set status = 'draft', updated_at = now()
     where id = p_id and status = 'submitted';
    return;
  end if;
  if p_run_status not in ('completed', 'rejected') then
    return;
  end if;

  select * into a from public.po_rate_amendments where id = p_id for update;
  if not found or a.status <> 'submitted' then
    raise exception
      'Rate amendment % is not waiting for approval, so this decision could not be applied. Reload it.',
      p_id using errcode = '55000';
  end if;

  if p_run_status = 'rejected' then
    update public.po_rate_amendments
       set status = 'rejected', approved_by = p_actor, approved_at = now(),
           decision_remark = nullif(trim(p_remark), ''), updated_at = now()
     where id = p_id;
    return;
  end if;

  -- completed: the new rate onto the line, GST and the PO total with it.
  if a.po_line_item_id is not null then
    select pl.id, pl.quantity, pl.amount, pl.gst_amount, pl.gst_pct,
           po.id as po_id, po.status as po_status, po.gst_pct as po_gst, po.gst_amount as po_gst_amount
      into l
      from public.po_line_items pl
      join public.purchase_orders po on po.id = pl.purchase_order_id
     where pl.id = a.po_line_item_id
       for update of pl, po;
    if found then
      if l.po_status in ('cancelled', 'closed') then
        raise exception 'This PO is % — its rate can no longer be amended. Reject the amendment instead.', l.po_status
          using errcode = 'P0001';
      end if;
      v_pct    := coalesce(l.gst_pct, l.po_gst, 0);
      v_old    := coalesce(l.amount, 0);
      v_oldgst := coalesce(l.gst_amount, round(v_old * v_pct / 100, 2));
      v_amt    := round(coalesce(l.quantity, 0) * a.revised_rate, 2);
      v_gst    := round(v_amt * v_pct / 100, 2);

      update public.po_line_items
         set unit_price = a.revised_rate, amount = v_amt, gst_amount = v_gst
       where id = l.id;

      -- The PO total moves by the line's difference, so its charges stay as they were.
      -- A PO whose header carries no GST (raised before 0756) totals amounts only.
      if l.po_gst_amount is null then
        update public.purchase_orders
           set total_amount = coalesce(total_amount, 0) + (v_amt - v_old), updated_at = now()
         where id = l.po_id;
      else
        update public.purchase_orders
           set total_amount = coalesce(total_amount, 0) + (v_amt + v_gst) - (v_old + v_oldgst),
               gst_amount   = coalesce(gst_amount, 0) + (v_gst - v_oldgst),
               updated_at   = now()
         where id = l.po_id;
      end if;
    end if;
  end if;

  update public.po_rate_amendments
     set status = 'approved', approved_by = p_actor, approved_at = now(),
         decision_remark = nullif(trim(p_remark), ''), updated_at = now()
   where id = p_id;
end;
$function$;
revoke all on function public.po_rate_amendment_apply_decision(uuid, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The cancellation's decision
-- ---------------------------------------------------------------------------
create or replace function public.po_cancellation_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  r          public.po_cancellation_requests%rowtype;
  po         record;
  x          record;
  v_open     numeric;
  v_qty      numeric;
  v_pct      numeric;
  v_old      numeric;
  v_oldgst   numeric;
  v_amt      numeric;
  v_gst      numeric;
  v_damt     numeric := 0;
  v_dgst     numeric := 0;
  v_received boolean;
begin
  if p_run_status = 'cancelled' then
    update public.po_cancellation_requests
       set status = 'withdrawn', updated_at = now()
     where id = p_id and status = 'submitted';
    return;
  end if;
  if p_run_status not in ('completed', 'rejected') then
    return;
  end if;

  select * into r from public.po_cancellation_requests where id = p_id for update;
  if not found or r.status <> 'submitted' then
    raise exception
      'Cancellation request % is not waiting for approval, so this decision could not be applied. Reload it.',
      p_id using errcode = '55000';
  end if;

  if p_run_status = 'rejected' then
    update public.po_cancellation_requests
       set status = 'rejected', decided_by = p_actor, decided_at = now(),
           decision_remark = nullif(trim(p_remark), ''), updated_at = now()
     where id = p_id;
    return;
  end if;

  select p.id, p.code, p.status, p.gst_pct, p.gst_amount
    into po
    from public.purchase_orders p where p.id = r.purchase_order_id for update;
  if not found then
    raise exception 'The PO of this request is gone. Reject the request instead.' using errcode = 'P0001';
  end if;
  if po.status not in ('approved', 'partially_received') then
    raise exception 'PO % is % — it can no longer be cancelled this way. Reject the request instead.',
      coalesce(po.code, po.id::text), po.status
      using errcode = 'P0001';
  end if;

  for x in
    select rl.cancel_qty, l.id, l.description, l.quantity, l.received_qty, l.closed_qty,
           l.balance_closed_qty, l.unit_price, l.amount, l.gst_amount, l.gst_pct
      from public.po_cancellation_request_lines rl
      join public.po_line_items l on l.id = rl.po_line_item_id
     where rl.request_id = p_id
     order by rl.sort_order
       for update of l
  loop
    v_open := greatest(coalesce(x.quantity, 0) - coalesce(x.received_qty, 0)
                       - coalesce(x.closed_qty, 0) - coalesce(x.balance_closed_qty, 0), 0);
    -- Goods received since the request was raised: refuse rather than cancel what arrived.
    if x.cancel_qty > v_open + 0.0005 then
      raise exception
        'Line "%" has only % still open now (some was received after the request). Reject this request and raise it again.',
        coalesce(nullif(x.description, ''), 'a line'), v_open
        using errcode = 'P0001';
    end if;

    v_qty    := coalesce(x.quantity, 0) - x.cancel_qty;
    v_pct    := coalesce(x.gst_pct, po.gst_pct, 0);
    v_old    := coalesce(x.amount, 0);
    v_oldgst := coalesce(x.gst_amount, round(v_old * v_pct / 100, 2));
    v_amt    := round(v_qty * coalesce(x.unit_price, 0), 2);
    v_gst    := round(v_amt * v_pct / 100, 2);

    update public.po_line_items
       set quantity      = v_qty,
           cancelled_qty = coalesce(cancelled_qty, 0) + x.cancel_qty,
           amount        = v_amt,
           gst_amount    = v_gst
     where id = x.id;

    v_damt := v_damt + (v_amt - v_old);
    v_dgst := v_dgst + (v_gst - v_oldgst);
  end loop;

  if po.gst_amount is null then
    update public.purchase_orders
       set total_amount = coalesce(total_amount, 0) + v_damt, updated_at = now()
     where id = po.id;
  else
    update public.purchase_orders
       set total_amount = coalesce(total_amount, 0) + v_damt + v_dgst,
           gst_amount   = coalesce(gst_amount, 0) + v_dgst,
           updated_at   = now()
     where id = po.id;
  end if;

  -- Nothing left open → the PO is done: Cancelled when nothing ever arrived, else Received.
  if not exists (
    select 1 from public.po_line_items l
     where l.purchase_order_id = po.id
       and coalesce(l.quantity, 0) - coalesce(l.received_qty, 0)
           - coalesce(l.closed_qty, 0) - coalesce(l.balance_closed_qty, 0) > 0.0005
  ) then
    select exists (select 1 from public.po_line_items l
                    where l.purchase_order_id = po.id and coalesce(l.received_qty, 0) > 0)
      into v_received;
    if v_received then
      update public.purchase_orders set status = 'received', updated_at = now() where id = po.id;
    else
      update public.purchase_orders set status = 'cancelled', updated_at = now() where id = po.id;
      -- The Cancel Purchase Order register (one row per PO).
      insert into public.po_cancellations (purchase_order_id, reason, cancelled_by)
      values (po.id, r.reason, r.created_by)
      on conflict (purchase_order_id) do nothing;
    end if;
  end if;

  update public.po_cancellation_requests
     set status = 'approved', decided_by = p_actor, decided_at = now(),
         decision_remark = nullif(trim(p_remark), ''), updated_at = now()
   where id = p_id;
end;
$function$;
revoke all on function public.po_cancellation_apply_decision(uuid, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. approval_apply_terminal: two branches added to the LIVE body (the 0764 idiom)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''po_rate_amendments'' then\n'
                || E'        perform public.po_rate_amendment_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark);\n'
                || E'        return new;\n'
                || E'    end if;\n\n'
                || E'    if new.subject_table = ''po_cancellation_requests'' then\n'
                || E'        perform public.po_cancellation_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark);\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''po_rate_amendments''' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0785: approval_apply_terminal final refusal not found — add the two branches by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

-- ---------------------------------------------------------------------------
-- 7. The flows — Managing Director, catch-all, editable on Approvals ▸ Flows
-- ---------------------------------------------------------------------------
-- Steps copied from the live Purchase Order default (→ Managing Director), so the
-- role key is exactly the one that already resolves.
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'po_rate_amendment',
       'PO Rate Amendment — default',
       'Catch-all. A revised rate on a purchase-order line; the final approve writes the rate, GST and the PO total.',
       '{}'::jsonb, f.steps, 900, true
  from public.approval_flows f
 where f.workflow_key = 'purchase_order' and f.flow_name = 'Purchase Order — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'po_rate_amendment');

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'po_cancellation',
       'PO Cancellation — default',
       'Catch-all. Cancelling a whole PO or part of its lines; the final approve cuts the lines and reopens the requirement.',
       '{}'::jsonb, f.steps, 900, true
  from public.approval_flows f
 where f.workflow_key = 'purchase_order' and f.flow_name = 'Purchase Order — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'po_cancellation');
