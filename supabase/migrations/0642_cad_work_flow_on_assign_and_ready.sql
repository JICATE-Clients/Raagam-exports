-- ============================================================================
-- Raagam ERP — 0642 Pattern Sent / Pattern Approval stamp on ASSIGN and READY
-- (user 2026-09-25: "no need that send action … the order entry assign the
-- pattern maker, the sheet from pattern maker — that is the cad send and
-- receive action"; then Option 1, "No Send step").
--
-- 0628 stamped the two Work Flow milestones from the BUYER round-trip —
-- Pattern Sent at Send CAD, Pattern Approval at the buyer's Approved. Send CAD
-- left Order Entry the same day and the CAD Queue had already dropped it, so
-- nothing reached either stamp and both rows would have stayed pending (and
-- gone red) on every new order. The CAD flow now ends at the Pattern Master's
-- Ready, which is also what opens the Fabric BOM (0641):
--
--   PATTERN_SENT      done when every current style has a pattern maker
--                     assigned; actual = the last of those allocation dates.
--   PATTERN_APPROVAL  done when every style's pattern is Ready — the SAME
--                     test as the Fabric BOM gate (`cad_order_pattern_ready`,
--                     0641), so the T&A and the gate cannot disagree;
--                     actual = the last Ready date (IST).
--   Both go in_progress at the first assignment.
--
-- Forward-only, as before (`work_flow_mark_on`): a later rework or a pattern
-- set back from Ready does not un-date a milestone.
--
-- WHO CALLS IT. 0628 called the sync from cad_dispatch / cad_decide only; an
-- assignment and a Ready are plain writes on order_cad_allocations, so an
-- AFTER trigger there runs it — every writer (screen, RPC, data fix) alike.
-- The old callers still call it, harmlessly.
-- ============================================================================

create or replace function public.cad_work_flow_sync(p_order uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_so        uuid := public.work_flow_so_of(p_order);
  v_styles    int;
  v_assigned  int;
  v_last_asg  date;
  v_last_rdy  date;
begin
  if v_so is null then return; end if;
  select count(*),
         count(*) filter (where s.state <> 'not_allocated'),
         max(a.allocation_date) filter (where s.state <> 'not_allocated'),
         max((a.pattern_status_at at time zone 'Asia/Kolkata')::date)
           filter (where a.pattern_status = 'ready')
    into v_styles, v_assigned, v_last_asg, v_last_rdy
    from public.cad_style_states(p_order) s
    left join public.order_cad_allocations a on a.id = s.allocation_id;

  if v_assigned > 0 then
    perform public.work_flow_mark_on(v_so, 'PATTERN_SENT', 'in_progress', null);
    perform public.work_flow_mark_on(v_so, 'PATTERN_APPROVAL', 'in_progress', null);
  end if;
  if v_styles > 0 and v_assigned = v_styles then
    perform public.work_flow_mark_on(v_so, 'PATTERN_SENT', 'done', v_last_asg);
  end if;
  if public.cad_order_pattern_ready(p_order) then
    perform public.work_flow_mark_on(v_so, 'PATTERN_APPROVAL', 'done', v_last_rdy);
  end if;
end $$;
revoke all on function public.cad_work_flow_sync(uuid) from public, anon, authenticated;

create or replace function public.cad_allocation_after_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.cad_work_flow_sync(new.garment_order_id);
  return null;
end $$;
revoke all on function public.cad_allocation_after_write() from public, anon, authenticated;

drop trigger if exists trg_oca_work_flow on public.order_cad_allocations;
create trigger trg_oca_work_flow
  after insert or update of pattern_status, allocation_date, garment_order_id
  on public.order_cad_allocations
  for each row execute function public.cad_allocation_after_write();

-- Catch up every order already assigned or Ready today.
do $sync$
declare r record;
begin
  for r in select distinct garment_order_id as id
             from public.order_cad_allocations
            where garment_order_id is not null
  loop
    perform public.cad_work_flow_sync(r.id);
  end loop;
end $sync$;

-- VERIFY (run by hand)
--   select m.code, m.status, m.actual_date from public.order_work_flow_milestones m
--    where m.code in ('PATTERN_SENT','PATTERN_APPROVAL') and m.status <> 'pending';
--   select tgname from pg_trigger where tgrelid = 'public.order_cad_allocations'::regclass;
