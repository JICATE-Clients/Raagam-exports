-- ============================================================================
-- 0635 — CAD wording: "CAD Lifecycle" → "CAD Queue" (user 2026-09-25).
--
-- LABELS ONLY. The screen is renamed CAD Queue and its steps Assign CAD /
-- Send CAD / CAD Approval — the operators' own words, keeping "CAD" because
-- that is the word the company uses. Tables, functions, routes
-- (`/orders/cad-lifecycle`) and the field sentences the RPCs raise
-- ("Allocation Date", "Dispatch Date") are unchanged, as 0623 did for Revision.
--
-- The one database sentence that NAMES THE MENU is the Fabric BOM guard's, and
-- a direction naming a row that no longer exists sends the operator hunting
-- (AGENTS.md "A LABEL IS ALSO WRITTEN DOWN IN THE PROSE"). So this re-creates
-- `cad_guard_fabric_bom()` from 0628 with only its sentence changed. The state
-- words now read what the listing's pill says (CAD_STATE_META, lowercased) —
-- the same words `lib/orders/cad-lifecycle/guard.ts`, the TS twin, prints.
-- ============================================================================

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
  if new.garment_order_id is null or public.cad_order_ready(new.garment_order_id) then
    return new;
  end if;
  select string_agg(s.style_ref_no || ' (' ||
           case s.state when 'not_allocated' then 'not assigned'
                        when 'allocated'     then 'assigned'
                        when 'pending'       then 'awaiting buyer'
                        when 'rework'        then 'rework required'
                        else s.state end || ')', ', ')
    into v_open
    from public.cad_style_states(new.garment_order_id) s
   where s.state <> 'approved';
  raise exception using errcode = 'P0001', hint = 'cad_not_submitted',
    message = 'The CAD is not approved for every style of this order, so a Fabric BOM cannot be created yet'
      || coalesce(' — ' || v_open, ' — the order has no styles')
      || '. Approve it on Orders ▸ CAD ▸ CAD Queue first.';
end $$;

-- `create or replace` keeps the function's ACL, but state it again: a trigger
-- function is never called directly (Function grants, STANDING).
revoke all on function public.cad_guard_fabric_bom() from public, anon, authenticated;
