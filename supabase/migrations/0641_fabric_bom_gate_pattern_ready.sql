-- ============================================================================
-- Raagam ERP — 0641 the Fabric BOM opens when every style's PATTERN IS READY
-- (user 2026-09-25, screenshot 3083: "the CAD has been done, the Ready status
-- is triggered, but still the Fabric BOM is not allowing" → chosen: "when the
-- pattern is Ready").
--
-- 0628's guard waited for the BUYER'S APPROVAL of every style. Since 0638 the
-- pattern room's last act is Ready, and the buyer round-trip (Send CAD →
-- Buyer Decision, on Order Entry ▸ CAD) keeps running for the T&A Pattern Sent
-- / Pattern Approval dates — it no longer blocks the Fabric BOM.
--
-- WHAT BLOCKS, per current style, reading its LATEST version:
--   not_allocated                          "not assigned"
--   rework                                 "rework required" — the buyer sent
--                                          it back, so the pattern is being
--                                          remade; the Ready it had is stale
--   allocated, pattern_status <> ready     "pattern: garment not received" /
--                                          "pattern: acknowledged"
-- What does NOT: allocated + Ready, pending (sent — Send required Ready,
-- 0638), approved. An order with no styles is still refused.
--
-- ONE LIST, TWO READERS. `cad_pattern_blockers()` is what the trigger's
-- sentence is built from AND what the Fabric BOM screen asks ahead of the
-- write (`cadFabricBomProblem`), so the early message and the refusal cannot
-- disagree. `cad_order_ready()` (every style APPROVED) is left exactly as it
-- is: it is also the "CAD PENDING" stamp on the Fabric BOM reports, which
-- still means "the buyer has not approved yet".
-- ============================================================================

create or replace function public.cad_pattern_blockers(p_order uuid)
returns table (style_ref_no text, why text)
language sql stable security definer
set search_path = ''
as $$
  select s.style_ref_no,
         case
           when s.state = 'not_allocated' then 'not assigned'
           when s.state = 'rework'        then 'rework required'
           when a.pattern_status = 'acknowledged' then 'pattern: acknowledged'
           else 'pattern: garment not received'
         end
    from public.cad_style_states(p_order) s
    left join public.order_cad_allocations a on a.id = s.allocation_id
   where s.state in ('not_allocated', 'rework')
      or (s.state = 'allocated' and a.pattern_status is distinct from 'ready')
$$;

create or replace function public.cad_order_pattern_ready(p_order uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.cad_style_states(p_order))
     and not exists (select 1 from public.cad_pattern_blockers(p_order))
$$;

create or replace function public.cad_guard_fabric_bom()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_open text;
begin
  if exists (select 1 from public.order_budget_revisions r where r.reverting_txid = txid_current()) then
    return new;
  end if;
  if new.garment_order_id is null or public.cad_order_pattern_ready(new.garment_order_id) then
    return new;
  end if;
  select string_agg(b.style_ref_no || ' (' || b.why || ')', ', ')
    into v_open
    from public.cad_pattern_blockers(new.garment_order_id) b;
  raise exception using errcode = 'P0001', hint = 'cad_not_submitted',
    message = 'Every style''s pattern must be Ready before a Fabric BOM can be created'
      || coalesce(' — ' || v_open, ' — the order has no styles')
      || '. The Pattern Master marks it Ready on Orders ▸ CAD ▸ CAD Queue.';
end $$;

revoke all on function public.cad_guard_fabric_bom() from public, anon, authenticated;
revoke all on function public.cad_pattern_blockers(uuid) from public, anon;
revoke all on function public.cad_order_pattern_ready(uuid) from public, anon;
grant execute on function public.cad_pattern_blockers(uuid) to authenticated;
grant execute on function public.cad_order_pattern_ready(uuid) to authenticated;
