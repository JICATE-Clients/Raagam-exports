-- 0671 — THE PATTERN MAKER IS AN HR ▸ STAFF MEMBER, NOT AN EMPLOYEE-MASTER ROW
-- (user 2026-10-01: "in order module now using the demo staff pattern maker
-- 1, 2 — totally unwire from that table and wire the staff").
--
-- `order_cad_allocations.pattern_maker_id` (0628) pointed at `employees` — the
-- Employee master, whose only pattern makers were the test rows "PATTERN
-- MAKER 1/2" (TST-PATT-*). The real people are on HR ▸ Staff (`staff`):
-- MOHANRAJ.R and VISWNATHAN.R, designation PATTERN MASTER. So:
--
--   1. The FK moves to `staff(id)`.
--   2. The five existing allocations name the test employee, who has no staff
--      row. THE USER CHOSE "leave unassigned" (2026-10-01): their pattern
--      maker is cleared, every other column — the sheet, the cuts, the
--      dispatch — is kept, and each reads "Not assigned" until someone picks
--      the real person. Done with the guard trigger off for that ONE statement: the
--      guard below refuses changing a dispatched version's maker, which is the
--      right rule for an operator and the wrong one for this repair.
--   3. `pattern_maker_id` may be NULL — but only a row that is ALREADY null may
--      stay so. A new allocation still needs a pattern maker, and a set one
--      cannot be blanked (`cad_allocation_before_write`).
--   4. The designation check reads `staff → designations` instead of
--      `employees → config_lookups`, and accepts PATTERN MASTER — what this
--      business calls the role on HR ▸ Staff — beside the three words 0632 /
--      0638 already accepted.
--
-- `cad_allocation_before_write` is re-created FROM THE LIVE BODY (read from
-- pg_get_functiondef on 2026-10-01), with only the pattern-maker block changed.

-- 2. The repair, before the FK can move.
alter table public.order_cad_allocations alter column pattern_maker_id drop not null;
alter table public.order_cad_allocations disable trigger trg_oca_before_write;
update public.order_cad_allocations a
   set pattern_maker_id = null
 where pattern_maker_id is not null
   and not exists (select 1 from public.staff s where s.id = a.pattern_maker_id);
alter table public.order_cad_allocations enable trigger trg_oca_before_write;

-- 1. The FK.
alter table public.order_cad_allocations
  drop constraint if exists order_cad_allocations_pattern_maker_id_fkey;
alter table public.order_cad_allocations
  add constraint order_cad_allocations_pattern_maker_id_fkey
  foreign key (pattern_maker_id) references public.staff (id);

-- 3 + 4. The guard.
create or replace function public.cad_allocation_before_write()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_prev   record;
  v_desig  text;
  v_cut    jsonb;
  v_seen   text[] := '{}';
  v_cid    text;
  v_key    text;
begin
  if tg_op = 'INSERT' then
    new.style_ref_no    := btrim(new.style_ref_no);
    new.allocation_date := public.work_flow_today();
    new.is_submitted    := false;
    select a.id, a.version_no, ap.status into v_prev
      from public.order_cad_allocations a
      left join public.order_cad_dispatches d on d.allocation_id = a.id
      left join public.order_cad_approvals ap on ap.dispatch_id = d.id
     where a.garment_order_id = new.garment_order_id
       and upper(btrim(a.style_ref_no)) = upper(new.style_ref_no)
     order by a.version_no desc
     limit 1;
    if found then
      if v_prev.status is distinct from 'rework' then
        raise exception using errcode = 'P0001',
          message = format('Style %s already has CAD version %s, which has not been sent back for rework — a new version can only follow a Rework decision.',
                           new.style_ref_no, v_prev.version_no);
      end if;
      new.version_no := v_prev.version_no + 1;
    else
      new.version_no := 1;
    end if;
  else
    if new.garment_order_id is distinct from old.garment_order_id
       or upper(btrim(new.style_ref_no)) is distinct from upper(btrim(old.style_ref_no))
       or new.version_no is distinct from old.version_no
       or new.allocation_date is distinct from old.allocation_date then
      raise exception using errcode = 'P0001',
        message = 'A CAD allocation''s order, style, version and allocation date cannot be changed.';
    end if;
    if exists (select 1 from public.order_cad_dispatches d where d.allocation_id = old.id)
       and (new.pattern_maker_id is distinct from old.pattern_maker_id
            or new.cad_type is distinct from old.cad_type
            or new.target_date is distinct from old.target_date
            or new.remarks is distinct from old.remarks
            or new.fit_wash is distinct from old.fit_wash
            or new.length_shrink_pct is distinct from old.length_shrink_pct
            or new.width_shrink_pct is distinct from old.width_shrink_pct
            or new.cut_type is distinct from old.cut_type
            or new.component_cuts is distinct from old.component_cuts
            or new.pattern_status is distinct from old.pattern_status) then
      raise exception using errcode = 'P0001',
        message = format('CAD version %s of style %s has been dispatched and can no longer be changed.',
                         old.version_no, old.style_ref_no);
    end if;
    new.updated_at := now();
  end if;

  if tg_op = 'INSERT' or new.pattern_status is distinct from old.pattern_status then
    new.pattern_status_at := now();
  end if;

  for v_cut in select * from jsonb_array_elements(coalesce(new.component_cuts, '[]'::jsonb)) loop
    v_cid := nullif(btrim(coalesce(v_cut ->> 'component_id', '')), '');
    if jsonb_typeof(v_cut) <> 'object' or v_cid is null then
      raise exception using errcode = 'P0001', message = 'A Component Cut Method is missing its component.';
    end if;
    if coalesce(v_cut ->> 'method', '') <> '' and v_cut ->> 'method' not in ('direct_shape', 'fit_form') then
      raise exception using errcode = 'P0001',
        message = format('The Cut Method for %s must be Direct Shape or Fit Form Cutting.',
                         coalesce(nullif(v_cut ->> 'component_name', ''), 'a component'));
    end if;
    if coalesce(v_cut ->> 'method', '') = '' and nullif(btrim(coalesce(v_cut ->> 'notes', '')), '') is null then
      raise exception using errcode = 'P0001',
        message = format('%s has neither a Cut Method nor a note.',
                         coalesce(nullif(v_cut ->> 'component_name', ''), 'A component'));
    end if;
    v_key := coalesce(nullif(btrim(coalesce(v_cut ->> 'coordinate_id', '')), ''), '-') || '|' || v_cid;
    if v_key = any(v_seen) then
      raise exception using errcode = 'P0001',
        message = format('%s%s has two Cut Methods — choose one.',
                         coalesce(nullif(v_cut ->> 'coordinate_name', '') || ' ▸ ', ''),
                         coalesce(nullif(v_cut ->> 'component_name', ''), 'A component'));
    end if;
    v_seen := v_seen || v_key;
  end loop;

  -- 0671: THE PATTERN MAKER, from HR ▸ Staff. Required on a new allocation and
  -- never blanked once set; a row 0671 left unassigned may stay so until
  -- someone picks the real person.
  if tg_op = 'INSERT' or new.pattern_maker_id is distinct from old.pattern_maker_id then
    if new.pattern_maker_id is null then
      raise exception using errcode = 'P0001', message = 'Choose the Pattern Maker.';
    end if;
    select upper(btrim(d.name)) into v_desig
      from public.staff s
      left join public.designations d on d.id = s.designation_id
     where s.id = new.pattern_maker_id;
    if v_desig is null or v_desig not in ('PATTERN MAKER', 'PATTERN MASTER', 'CAD TECHNICIAN', 'CAD DESIGNER') then
      raise exception using errcode = 'P0001',
        message = 'The Pattern Maker must be a staff member whose Designation is PATTERN MASTER, PATTERN MAKER, CAD TECHNICIAN or CAD DESIGNER (HR & Payroll ▸ People ▸ Staff).';
    end if;
  end if;

  return new;
end $function$;
