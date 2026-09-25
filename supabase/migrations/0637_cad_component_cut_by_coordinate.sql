-- ============================================================================
-- Raagam ERP — 0637 CAD component cut methods keyed by (coordinate, component).
--
-- Order Entry ▸ CAD lists the style's components as a table — Coordinate ·
-- Component · Structure · Cut Method (user 2026-09-25, screenshot 3061) — and a
-- coordinate set (TOP / BOTTOM) legitimately has FRONT BODY twice. 0632's
-- trigger refused a second FRONT BODY as "two Cut Methods". Entries now carry
-- `coordinate_id` / `coordinate_name` (snapshotted, like the component's name)
-- and the duplicate test is per (coordinate, component). An entry without a
-- coordinate (every one saved under 0632) keys as '-', so nothing stored
-- becomes invalid. Only the trigger changes; the column and its CHECK stand.
-- ============================================================================

create or replace function public.cad_allocation_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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

    -- SEQUENTIAL VERSION CONTROL (0628, spec §7).
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
            or new.component_cuts is distinct from old.component_cuts) then
      raise exception using errcode = 'P0001',
        message = format('CAD version %s of style %s has been dispatched and can no longer be changed.',
                         old.version_no, old.style_ref_no);
    end if;
    new.updated_at := now();
  end if;

  -- COMPONENT CUT METHODS: each entry names a component and a known method,
  -- and a component appears once.
  for v_cut in select * from jsonb_array_elements(coalesce(new.component_cuts, '[]'::jsonb)) loop
    v_cid := nullif(btrim(coalesce(v_cut ->> 'component_id', '')), '');
    if jsonb_typeof(v_cut) <> 'object' or v_cid is null then
      raise exception using errcode = 'P0001', message = 'A Component Cut Method is missing its component.';
    end if;
    if coalesce(v_cut ->> 'method', '') not in ('direct_shape', 'fit_form') then
      raise exception using errcode = 'P0001',
        message = format('The Cut Method for %s must be Direct Shape or Fit Form Cutting.',
                         coalesce(nullif(v_cut ->> 'component_name', ''), 'a component'));
    end if;
    -- ONE METHOD PER (COORDINATE, COMPONENT), 0637: a coordinate set cuts
    -- FRONT BODY for the TOP and again for the BOTTOM, and the two may be cut
    -- differently. 0632 keyed on the component alone and refused the second.
    v_key := coalesce(nullif(btrim(coalesce(v_cut ->> 'coordinate_id', '')), ''), '-') || '|' || v_cid;
    if v_key = any(v_seen) then
      raise exception using errcode = 'P0001',
        message = format('%s%s has two Cut Methods — choose one.',
                         coalesce(nullif(v_cut ->> 'coordinate_name', '') || ' ▸ ', ''),
                         coalesce(nullif(v_cut ->> 'component_name', ''), 'A component'));
    end if;
    v_seen := v_seen || v_key;
  end loop;

  -- THE PATTERN MAKER: designation PATTERN MAKER, CAD TECHNICIAN or CAD DESIGNER.
  if tg_op = 'INSERT' or new.pattern_maker_id is distinct from old.pattern_maker_id then
    select upper(btrim(c.name)) into v_desig
      from public.employees e
      left join public.config_lookups c on c.id = e.designation_id
     where e.id = new.pattern_maker_id;
    if v_desig is null or v_desig not in ('PATTERN MAKER', 'CAD TECHNICIAN', 'CAD DESIGNER') then
      raise exception using errcode = 'P0001',
        message = 'The Pattern Maker must be an employee whose Designation is PATTERN MAKER, CAD TECHNICIAN or CAD DESIGNER (Master Data ▸ Associates ▸ Employee).';
    end if;
  end if;

  return new;
end $$;
revoke all on function public.cad_allocation_before_write() from public, anon, authenticated;
