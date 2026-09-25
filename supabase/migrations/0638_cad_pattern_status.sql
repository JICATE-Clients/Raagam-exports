-- ============================================================================
-- Raagam ERP — 0638 CAD Pattern Status + per-component notes
-- (record-1790318990226.wav, 2026-09-25).
--
-- 1. PATTERN STATUS on the version, the Pattern Master's own three words:
--      garment_not_received  default — waiting for the sample / reference garment
--      acknowledged          sample garment AND order details received
--      ready                 pattern made, ready to send / cut
--    It sits INSIDE Assign → Send → Buyer decision (user 2026-09-25: "add it
--    inside"), which still drives the Fabric BOM gate and the T&A milestones.
--    SEND REQUIRES READY (user 2026-09-25): cad_dispatch refuses otherwise, so
--    the status is a rule and not a label. Like every allocation field it
--    freezes at dispatch. Versions already dispatched are backfilled 'ready' —
--    they were sent, which is what Ready means.
-- 2. NOTES per component row in component_cuts (`notes`, free text: piece
--    weight, an opening-dia adjustment). A row may now carry notes without a
--    method; a row with neither is refused.
-- ============================================================================

alter table public.order_cad_allocations
  add column if not exists pattern_status text not null default 'garment_not_received',
  add column if not exists pattern_status_at timestamptz;
alter table public.order_cad_allocations drop constraint if exists chk_oca_pattern_status;
alter table public.order_cad_allocations
  add constraint chk_oca_pattern_status
    check (pattern_status in ('garment_not_received','acknowledged','ready'));
comment on column public.order_cad_allocations.pattern_status is
  '0638 — Pattern Master status: garment_not_received · acknowledged · ready. cad_dispatch requires ready.';

-- Backfill: a dispatched version was sent, so it was ready. The trigger's
-- "frozen after dispatch" rule would refuse this UPDATE, so it runs with the
-- trigger off for this one statement.
alter table public.order_cad_allocations disable trigger trg_oca_before_write;
update public.order_cad_allocations a
   set pattern_status = 'ready', pattern_status_at = coalesce(pattern_status_at, now())
 where exists (select 1 from public.order_cad_dispatches d where d.allocation_id = a.id);
alter table public.order_cad_allocations enable trigger trg_oca_before_write;

grant insert (pattern_status) on public.order_cad_allocations to authenticated;
grant update (pattern_status) on public.order_cad_allocations to authenticated;

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
            or new.component_cuts is distinct from old.component_cuts
            or new.pattern_status is distinct from old.pattern_status) then
      raise exception using errcode = 'P0001',
        message = format('CAD version %s of style %s has been dispatched and can no longer be changed.',
                         old.version_no, old.style_ref_no);
    end if;
    new.updated_at := now();
  end if;

  -- 0638: when the Pattern Status last moved (the Pattern Master's own clock).
  if tg_op = 'INSERT' or new.pattern_status is distinct from old.pattern_status then
    new.pattern_status_at := now();
  end if;

  -- COMPONENT CUT METHODS: each entry names a component and a known method,
  -- and a component appears once.
  for v_cut in select * from jsonb_array_elements(coalesce(new.component_cuts, '[]'::jsonb)) loop
    v_cid := nullif(btrim(coalesce(v_cut ->> 'component_id', '')), '');
    if jsonb_typeof(v_cut) <> 'object' or v_cid is null then
      raise exception using errcode = 'P0001', message = 'A Component Cut Method is missing its component.';
    end if;
    -- 0638: a row may carry NOTES without a method yet (piece weight, an
    -- opening-dia adjustment) — but a method, when given, is one of the two,
    -- and a row with neither is not stored at all.
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

  -- 0638: the pattern goes out only once the Pattern Master has marked it Ready.
  if v_a.pattern_status is distinct from 'ready' then
    raise exception using errcode = 'P0001',
      message = format('The pattern for style %s is not Ready yet — the Pattern Master marks it Ready before it can be sent.',
                       v_a.style_ref_no);
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
