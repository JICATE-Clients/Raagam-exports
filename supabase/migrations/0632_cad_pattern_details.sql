-- ============================================================================
-- Raagam ERP — 0632 CAD pattern details, a fourth CAD type, the CAD Designer,
-- a PDF marker beside the pattern, and a transmission-proof attachment
-- (Order Entry ▸ CAD tab spec, 2026-09-25; builds on 0628).
--
-- ## WHAT 0628 ALREADY DID, AND THIS DOES NOT REDO
--
-- Allocation → Dispatch → Buyer decision per (order, style, version), the
-- Expected Approval Date from customers.cad_review_days, Rework comments,
-- Approved ⇒ is_submitted, the Pattern Sent / Pattern Approval Work Flow
-- milestones and the Fabric BOM guard are all live. The 2026-09-25 spec asks
-- for them again and gets the same answers.
--
-- ## WHAT IS NEW
--
--   1. The spec's "Compact CAD Entry Details", on the VERSION (the allocation):
--        fit_wash            Yes / No, default No
--        length_shrink_pct   mandatory when fit_wash, else NULL
--        width_shrink_pct    mandatory when fit_wash, else NULL
--        cut_type            One-Way / Two-Way cutting
--        component_cuts      [{component_id, component_name, method}], method
--                            Direct Shape / Fit Form, one per style component
--      On the version and not the style because a rework may change them —
--      and like every other allocation field they freeze at dispatch: a sent
--      version is what the buyer saw. `component_name` is SNAPSHOTTED for the
--      same reason: a component later removed from the style must not blank
--      the history of what was cut.
--   2. CAD Type 'shrinkage_wash' (Shrinkage / Wash Pattern). A shrinkage
--      pattern with Fit Wash = No has no shrinkage to build in, so it is
--      refused.
--   3. Designation CAD DESIGNER, a third word the Pattern Maker may hold.
--   4. Files carry a KIND:
--        pattern  .DXF .PDS .PLT, and a .PDF marker print BESIDE them — never
--                 instead: a PDF is a picture of a marker, not a pattern a
--                 cutting room can load, so at least one real CAD file is
--                 still mandatory (0628's rule, unchanged).
--        proof    the email slip / courier docket: .PDF .JPG .JPEG .PNG .EML
--                 .MSG. A proof file now counts as proof of dispatch beside
--                 a tracking number or an email timestamp.
--      chk_ocd_proof moves from the dispatch row into cad_dispatch: a row
--      CHECK cannot see the files inserted after it, and the RPC is already
--      the only door (0628 revoked direct writes).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The word.
-- ----------------------------------------------------------------------------
insert into public.config_lookups (kind, code, name, is_active)
select 'designation', 'CAD-DESIGNER', 'CAD DESIGNER', true
where not exists (
  select 1 from public.config_lookups c
   where c.kind = 'designation' and lower(btrim(c.name)) = 'cad designer'
);


-- ----------------------------------------------------------------------------
-- 2. The version's pattern details.
-- ----------------------------------------------------------------------------
alter table public.order_cad_allocations
  drop constraint if exists order_cad_allocations_cad_type_check;
alter table public.order_cad_allocations
  add constraint order_cad_allocations_cad_type_check
    check (cad_type in ('first_pattern','grading','marker_planning','shrinkage_wash'));

alter table public.order_cad_allocations
  add column if not exists fit_wash          boolean not null default false,
  add column if not exists length_shrink_pct numeric(5,2),
  add column if not exists width_shrink_pct  numeric(5,2),
  add column if not exists cut_type          text,
  add column if not exists component_cuts    jsonb not null default '[]'::jsonb;

alter table public.order_cad_allocations
  drop constraint if exists chk_oca_cut_type,
  drop constraint if exists chk_oca_fit_wash_shrinkage,
  drop constraint if exists chk_oca_shrinkage_wash_needs_fit_wash,
  drop constraint if exists chk_oca_component_cuts_array;
alter table public.order_cad_allocations
  add constraint chk_oca_cut_type
    check (cut_type is null or cut_type in ('one_way','two_way')),
  -- Yes ⇒ both percentages, each in (0, 100). No ⇒ neither (a figure left
  -- behind by switching Yes → No would print on a sheet that says No).
  add constraint chk_oca_fit_wash_shrinkage check (
    case when fit_wash
         then length_shrink_pct > 0 and length_shrink_pct < 100
          and width_shrink_pct  > 0 and width_shrink_pct  < 100
         else length_shrink_pct is null and width_shrink_pct is null end),
  add constraint chk_oca_shrinkage_wash_needs_fit_wash
    check (cad_type <> 'shrinkage_wash' or fit_wash),
  add constraint chk_oca_component_cuts_array
    check (jsonb_typeof(component_cuts) = 'array');

comment on column public.order_cad_allocations.fit_wash is
  '0632 — Fit Wash Process. TRUE requires length_shrink_pct and width_shrink_pct.';
comment on column public.order_cad_allocations.cut_type is
  '0632 — one_way / two_way cutting. NULL = not stated.';
comment on column public.order_cad_allocations.component_cuts is
  '0632 — [{component_id, component_name, method: direct_shape|fit_form}], one per style component the method was chosen for. Name snapshotted: a sent version is history.';


-- ----------------------------------------------------------------------------
-- 3. The allocation trigger — 0628's, with the new columns frozen at dispatch,
--    component_cuts validated, and CAD DESIGNER accepted.
-- ----------------------------------------------------------------------------
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
    if v_cid = any(v_seen) then
      raise exception using errcode = 'P0001',
        message = format('%s has two Cut Methods — choose one.',
                         coalesce(nullif(v_cut ->> 'component_name', ''), 'A component'));
    end if;
    v_seen := v_seen || v_cid;
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

grant insert (fit_wash, length_shrink_pct, width_shrink_pct, cut_type, component_cuts)
  on public.order_cad_allocations to authenticated;
grant update (fit_wash, length_shrink_pct, width_shrink_pct, cut_type, component_cuts)
  on public.order_cad_allocations to authenticated;


-- ----------------------------------------------------------------------------
-- 4. Files carry a kind.
-- ----------------------------------------------------------------------------
alter table public.order_cad_dispatch_files
  add column if not exists kind text not null default 'pattern';
alter table public.order_cad_dispatch_files
  drop constraint if exists order_cad_dispatch_files_extension_check,
  drop constraint if exists chk_ocdf_kind_extension;
-- Mirrored by PATTERN_FILE_EXTENSIONS / PROOF_FILE_EXTENSIONS
-- (lib/orders/cad-lifecycle/types.ts); asserted equal by check-cad-lifecycle.
alter table public.order_cad_dispatch_files
  add constraint chk_ocdf_kind_extension check (
       (kind = 'pattern' and extension in ('dxf','pds','plt','pdf'))
    or (kind = 'proof'   and extension in ('pdf','jpg','jpeg','png','eml','msg')));

alter table public.order_cad_dispatches drop constraint if exists chk_ocd_proof;


-- ----------------------------------------------------------------------------
-- 5. cad_dispatch — same signature; p_files entries may carry "kind".
-- ----------------------------------------------------------------------------
create or replace function public.cad_dispatch(
  p_allocation   uuid,
  p_date         date,
  p_courier      text,
  p_email_at     timestamptz,
  p_layout       text,
  p_remarks      text,
  p_files        jsonb
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a        public.order_cad_allocations%rowtype;
  v_days     int;
  v_id       uuid;
  v_f        jsonb;
  v_name     text;
  v_ext      text;
  v_path     text;
  v_kind     text;
  v_cad      int := 0;
  v_proof    int := 0;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using errcode = '42501', message = 'You do not have permission to dispatch a CAD.';
  end if;

  select * into v_a from public.order_cad_allocations where id = p_allocation for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That CAD allocation no longer exists.';
  end if;
  if exists (select 1 from public.order_cad_dispatches d where d.allocation_id = p_allocation) then
    raise exception using errcode = 'P0001',
      message = format('CAD version %s of style %s has already been dispatched.', v_a.version_no, v_a.style_ref_no);
  end if;

  if p_date is null then
    raise exception using errcode = 'P0001', message = 'Dispatch Date is required.';
  end if;
  if p_date > public.work_flow_today() then
    raise exception using errcode = 'P0001', message = 'Dispatch Date cannot be in the future.';
  end if;
  if p_date < v_a.allocation_date then
    raise exception using errcode = 'P0001',
      message = format('Dispatch Date cannot be before the Allocation Date (%s).', to_char(v_a.allocation_date, 'DD/MM/YYYY'));
  end if;

  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    p_files := '[]'::jsonb;
  end if;
  -- Validate every file BEFORE writing anything, so the refusals come in the
  -- order the sheet shows them.
  for v_f in select * from jsonb_array_elements(p_files) loop
    v_name := nullif(btrim(v_f ->> 'file_name'), '');
    v_path := nullif(btrim(v_f ->> 'storage_path'), '');
    v_kind := coalesce(nullif(v_f ->> 'kind', ''), 'pattern');
    if v_name is null or v_path is null then
      raise exception using errcode = 'P0001', message = 'A CAD file is missing its name or storage path.';
    end if;
    v_ext := lower(substring(v_name from '\.([^.]+)$'));
    if v_kind = 'pattern' then
      if v_ext is null or v_ext not in ('dxf', 'pds', 'plt', 'pdf') then
        raise exception using errcode = 'P0001',
          message = format('%s is not a CAD file — only .DXF, .PDS, .PLT and a .PDF marker are accepted.', v_name);
      end if;
      if v_ext <> 'pdf' then v_cad := v_cad + 1; end if;
    elsif v_kind = 'proof' then
      if v_ext is null or v_ext not in ('pdf', 'jpg', 'jpeg', 'png', 'eml', 'msg') then
        raise exception using errcode = 'P0001',
          message = format('%s cannot be a transmission proof — attach a .PDF, .JPG, .PNG, .EML or .MSG.', v_name);
      end if;
      v_proof := v_proof + 1;
    else
      raise exception using errcode = 'P0001', message = 'A CAD file is either a pattern file or a proof.';
    end if;
    if v_path not like ('cad/' || v_a.garment_order_id::text || '/%/v' || v_a.version_no || '/%') then
      raise exception using errcode = 'P0001', message = 'The CAD file was not stored under this version''s folder.';
    end if;
  end loop;

  -- PROOF (spec §3.2): a tracking number, an email timestamp or an attached slip.
  if nullif(btrim(coalesce(p_courier, '')), '') is null and p_email_at is null and v_proof = 0 then
    raise exception using errcode = 'P0001',
      message = 'Enter a Courier Tracking Number or an Email Timestamp, or attach the email slip / courier docket — a dispatch needs proof it was sent.';
  end if;

  if p_layout is not null and p_layout not in ('open_width', 'tubular') then
    raise exception using errcode = 'P0001', message = 'Layout Type must be Open Width or Tubular.';
  end if;
  if v_a.cad_type = 'marker_planning' and p_layout is null then
    raise exception using errcode = 'P0001', message = 'A Marker Planning CAD needs its Layout Type (Open Width / Tubular).';
  end if;

  -- THE PATTERN (spec §3.1): at least one real CAD file; a PDF marker rides along.
  if v_cad = 0 then
    raise exception using errcode = 'P0001',
      message = 'Attach the CAD file (.DXF, .PDS or .PLT) — a dispatch cannot be recorded without it. A .PDF marker goes with it, not instead of it.';
  end if;

  select c.cad_review_days into v_days
    from public.garment_order_amendments g
    left join public.customers c on c.id = g.customer_id
   where g.id = v_a.garment_order_id;

  insert into public.order_cad_dispatches
    (allocation_id, dispatch_date, courier_tracking_no, email_sent_at, layout_type,
     expected_approval_date, remarks)
  values
    (p_allocation, p_date, nullif(btrim(coalesce(p_courier, '')), ''), p_email_at, p_layout,
     case when v_days is null then null else p_date + v_days end,
     nullif(btrim(coalesce(p_remarks, '')), ''))
  returning id into v_id;

  for v_f in select * from jsonb_array_elements(p_files) loop
    v_name := btrim(v_f ->> 'file_name');
    insert into public.order_cad_dispatch_files
      (dispatch_id, file_name, storage_path, extension, kind, mime_type, size_bytes)
    values (v_id, v_name, btrim(v_f ->> 'storage_path'),
            lower(substring(v_name from '\.([^.]+)$')),
            coalesce(nullif(v_f ->> 'kind', ''), 'pattern'),
            nullif(v_f ->> 'mime_type', ''), nullif(v_f ->> 'size_bytes', '')::bigint);
  end loop;

  insert into public.order_cad_approvals (dispatch_id, status) values (v_id, 'pending');

  perform public.cad_work_flow_sync(v_a.garment_order_id);
  return v_id;
end $$;
revoke all on function public.cad_dispatch(uuid, date, text, timestamptz, text, text, jsonb) from public, anon;
grant execute on function public.cad_dispatch(uuid, date, text, timestamptz, text, text, jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- VERIFY (run by hand)
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.order_cad_allocations'::regclass;
--   select proname, proacl from pg_proc where proname like 'cad\_%';  -- no anon
-- ----------------------------------------------------------------------------
