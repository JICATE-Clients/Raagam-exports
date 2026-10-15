-- 0730 · Sample ▸ Revision — the plan-revision WORKSPACE: one raise for both
--        plans, who asked (origin), and ABANDON back to the approved V0.
--
-- 0718 / 0720 gave each sample plan its own Raise Revision, and 0727 made that
-- raise keep the whole approved plan (`snapshot`). Three things were missing
-- for the revision to be worked the way Orders ▸ Order Revisions is:
--
--   * ONE ENTRY. Ticking Fabric Plan AND Accessories Plan raised two revisions
--     with two calls from the browser — the second could fail after the first
--     had reopened its plan, leaving half a revision. `entry_id` ties the
--     revisions one raise made, and `raise_sample_plan_revisions` makes both
--     in ONE transaction: either plan refused, nothing is reopened.
--   * WHO ASKED. Orders' entry carries an origin (customer | internal, its
--     `AMENDMENT_ORIGINS`); the plan revision log now does too. Nullable — a
--     revision raised before 0730 never said.
--   * ABANDON. A revision the operator no longer wants used to be a dead end:
--     the plan stayed open (purchasing paused) until it was edited back by hand
--     and approved again. `abandon_sample_plan_revision` puts every plan of the
--     entry back EXACTLY as approved — from 0727's snapshot, the same record
--     the approver's "what changed" compares against — re-locks it, and closes
--     the revision as abandoned. Refused while the revision is with the
--     approver (a live run): the approver decides first, as Orders withholds
--     Abandon while the MD holds an entry.
--
-- HOW THE RESTORE GETS PAST THE PLAN LOCK. No GUC, no txid flag: 0718's lock
-- (`refuse_when_fabric_plan_approved` / its accessories twin) refuses only
-- while a plan is `submitted` or `approved`, and the header guard lets the
-- function OWNER move the status (`current_user = 'authenticated'` is what it
-- polices). So the restore does what Raise Revision already does — the owner
-- sets the plan `open` — writes the V0 rows while nothing is locked, and only
-- then writes the V0 header, `approved` and all. 0595's IWO-budget lock is NOT
-- stood down: a work order whose budget is submitted/approved refuses the
-- restore exactly as it refuses the raise, with its own sentence.
--
-- REVISION NUMBERS ARE NEVER REUSED. An abandoned Rev #2 puts the plan back at
-- Rev #1 (the snapshot's own `revision_no`), and the next raise is Rev #3 — the
-- raise now takes the next number past BOTH the plan and its log, so the
-- abandoned row keeps its number, `unique (bom_id, revision_no)` still holds,
-- and 0727's `where revision_no = v_next` still names exactly one row. The two
-- raise functions are re-created FROM 0727'S BODIES (the latest that define
-- them) with that one line changed, marked "0730".
--
-- APPLY ORDER: check the ledger (`supabase_migrations.schema_migrations`)
-- before applying — a parallel session may have taken 0730.

-- ── 1. The log's new columns ─────────────────────────────────────────────────
alter table public.iwo_fabric_bom_revisions
  add column if not exists entry_id       uuid not null default gen_random_uuid(),
  add column if not exists origin         text,
  add column if not exists abandoned_at   timestamptz,
  add column if not exists abandoned_by   uuid,
  add column if not exists abandon_reason text;
alter table public.iwo_material_bom_revisions
  add column if not exists entry_id       uuid not null default gen_random_uuid(),
  add column if not exists origin         text,
  add column if not exists abandoned_at   timestamptz,
  add column if not exists abandoned_by   uuid,
  add column if not exists abandon_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'iwo_fabric_bom_revisions_origin_check') then
    alter table public.iwo_fabric_bom_revisions
      add constraint iwo_fabric_bom_revisions_origin_check check (origin is null or origin in ('customer', 'internal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'iwo_material_bom_revisions_origin_check') then
    alter table public.iwo_material_bom_revisions
      add constraint iwo_material_bom_revisions_origin_check check (origin is null or origin in ('customer', 'internal'));
  end if;
end $$;

create index if not exists iwo_fabric_bom_revisions_entry_idx   on public.iwo_fabric_bom_revisions (entry_id);
create index if not exists iwo_material_bom_revisions_entry_idx on public.iwo_material_bom_revisions (entry_id);

comment on column public.iwo_fabric_bom_revisions.entry_id is
  '0730: the revision ENTRY — every plan revision one Raise made shares it (Sample ▸ Revision''s workspace id).';
comment on column public.iwo_material_bom_revisions.entry_id is
  '0730: the revision ENTRY — every plan revision one Raise made shares it (Sample ▸ Revision''s workspace id).';
comment on column public.iwo_fabric_bom_revisions.origin is
  '0730: who asked — customer | internal (Orders'' AMENDMENT_ORIGINS). NULL on a revision raised before 0730.';
comment on column public.iwo_material_bom_revisions.origin is
  '0730: who asked — customer | internal (Orders'' AMENDMENT_ORIGINS). NULL on a revision raised before 0730.';
comment on column public.iwo_fabric_bom_revisions.abandoned_at is
  '0730: set by abandon_sample_plan_revision — the plan went back to its approved snapshot. Never cleared.';
comment on column public.iwo_material_bom_revisions.abandoned_at is
  '0730: set by abandon_sample_plan_revision — the plan went back to its approved snapshot. Never cleared.';

-- Still no insert / update / delete policy (0718 / 0720): the log is written
-- only by the SECURITY DEFINER functions below and the two raises.

-- ── 2. Raise Revision — the next number past the plan AND its log ───────────
CREATE OR REPLACE FUNCTION public.raise_fabric_plan_revision(p_bom uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_plan public.iwo_fabric_boms%rowtype;
  v_next integer;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'Raising a Fabric Plan revision needs Orders ▸ Edit.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the plan is being revised.' using errcode = '23514';
  end if;
  select * into v_plan from public.iwo_fabric_boms b where b.id = p_bom for update;
  if not found or not public.is_current_location(v_plan.location_id) then
    raise exception 'That Fabric Plan no longer exists in this unit.' using errcode = 'P0002';
  end if;
  if v_plan.approval_status <> 'approved' then
    raise exception 'Only an approved Fabric Plan is revised — this one is %; edit it directly.', v_plan.approval_status
      using errcode = '55000';
  end if;
  -- 0730: past an ABANDONED revision too, so its number is never reused.
  v_next := greatest(v_plan.revision_no,
                     coalesce((select max(r.revision_no) from public.iwo_fabric_bom_revisions r where r.bom_id = p_bom), 0)) + 1;
  insert into public.iwo_fabric_bom_revisions (bom_id, revision_no, reason, approved_yarns)
  select p_bom, v_next, btrim(p_reason),
         coalesce(jsonb_agg(jsonb_build_object(
                    'item_id', y.item_id, 'name', it.name,
                    'purchase_qty', y.purchase_qty, 'uom', u.code) order by y.sno), '[]'::jsonb)
    from public.iwo_fabric_bom_yarns y
    left join public.items it on it.id = y.item_id
    left join public.uoms u on u.id = y.uom_id
   where y.bom_id = p_bom;
  -- 0727: the whole approved plan and its shades, before it reopens.
  update public.iwo_fabric_bom_revisions
     set snapshot = jsonb_build_object('plan', public.sample_plan_snapshot('fabric', p_bom),
                                       'shades', public.sample_plan_shade_lines('fabric', p_bom))
   where bom_id = p_bom and revision_no = v_next;
  update public.iwo_fabric_boms
     set approval_status = 'open', revision_no = v_next,
         submitted_at = null, submitted_by = null, updated_at = now()
   where id = p_bom;
  return v_next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.raise_accessories_plan_revision(p_bom uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_plan public.iwo_material_boms%rowtype;
  v_next integer;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'Raising an Accessories Plan revision needs Orders ▸ Edit.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the plan is being revised.' using errcode = '23514';
  end if;
  select * into v_plan from public.iwo_material_boms b where b.id = p_bom for update;
  if not found or not public.is_current_location(v_plan.location_id) then
    raise exception 'That Accessories Plan no longer exists in this unit.' using errcode = 'P0002';
  end if;
  if v_plan.approval_status <> 'approved' then
    raise exception 'Only an approved Accessories Plan is revised — this one is %; edit it directly.', v_plan.approval_status
      using errcode = '55000';
  end if;
  -- 0730: past an ABANDONED revision too, so its number is never reused.
  v_next := greatest(v_plan.revision_no,
                     coalesce((select max(r.revision_no) from public.iwo_material_bom_revisions r where r.bom_id = p_bom), 0)) + 1;
  insert into public.iwo_material_bom_revisions (bom_id, revision_no, reason, approved_items)
  select p_bom, v_next, btrim(p_reason),
         coalesce(jsonb_agg(jsonb_build_object(
                    'item_id', i.item_id, 'name', it.name,
                    'purchase_qty', i.purchase_qty, 'uom', u.code) order by i.sno), '[]'::jsonb)
    from public.iwo_material_bom_items i
    left join public.items it on it.id = i.item_id
    left join public.uoms u on u.id = coalesce(i.purchase_uom_id, i.consumption_uom_id)
   where i.bom_id = p_bom;
  -- 0727: the whole approved plan and its trim colours, before it reopens.
  update public.iwo_material_bom_revisions
     set snapshot = jsonb_build_object('plan', public.sample_plan_snapshot('accessories', p_bom),
                                       'shades', public.sample_plan_shade_lines('accessories', p_bom))
   where bom_id = p_bom and revision_no = v_next;
  update public.iwo_material_boms
     set approval_status = 'open', revision_no = v_next,
         submitted_at = null, submitted_by = null, updated_at = now()
   where id = p_bom;
  return v_next;
end;
$function$;

revoke all on function public.raise_fabric_plan_revision(uuid, text) from public, anon;
revoke all on function public.raise_accessories_plan_revision(uuid, text) from public, anon;
grant execute on function public.raise_fabric_plan_revision(uuid, text) to authenticated;
grant execute on function public.raise_accessories_plan_revision(uuid, text) to authenticated;

-- ── 3. One raise, both plans, one transaction ───────────────────────────────
create or replace function public.raise_sample_plan_revisions(
  p_fabric uuid, p_accessories uuid, p_reason text, p_origin text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_entry uuid := gen_random_uuid();
  v_fab   integer;
  v_acc   integer;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'Raising a plan revision needs Orders ▸ Edit.' using errcode = '42501';
  end if;
  if p_fabric is null and p_accessories is null then
    raise exception 'Tick at least one plan to revise.' using errcode = '23514';
  end if;
  if p_origin is null or p_origin not in ('customer', 'internal') then
    raise exception 'Say who asked for the revision — the customer, or us.' using errcode = '23514';
  end if;
  -- Both plans of ONE SWO: its Fabric work order and its Accessories work order.
  if p_fabric is not null and p_accessories is not null and not exists (
    select 1
      from public.sample_product_groups g
      join public.iwo_fabric_boms f on f.iwo_id = g.iwo_id
      join public.iwo_material_boms m on m.iwo_id = g.accessories_iwo_id
     where f.id = p_fabric and m.id = p_accessories) then
    raise exception 'Those two plans belong to different SWOs — raise one revision per SWO.' using errcode = '23514';
  end if;

  -- Each raise checks its own plan (unit, state) and raises on refusal, which
  -- rolls the WHOLE call back: never one plan reopened and the other not.
  if p_fabric is not null then
    v_fab := public.raise_fabric_plan_revision(p_fabric, p_reason);
    update public.iwo_fabric_bom_revisions
       set entry_id = v_entry, origin = p_origin
     where bom_id = p_fabric and revision_no = v_fab;
  end if;
  if p_accessories is not null then
    v_acc := public.raise_accessories_plan_revision(p_accessories, p_reason);
    update public.iwo_material_bom_revisions
       set entry_id = v_entry, origin = p_origin
     where bom_id = p_accessories and revision_no = v_acc;
  end if;

  return jsonb_build_object('entry_id', v_entry, 'fabric', v_fab, 'accessories', v_acc);
end;
$function$;

revoke all on function public.raise_sample_plan_revisions(uuid, uuid, text, text) from public, anon;
grant execute on function public.raise_sample_plan_revisions(uuid, uuid, text, text) to authenticated;

-- ── 4. The restore helpers — owner-only ─────────────────────────────────────
-- Generic over the snapshot's `to_jsonb(row)` shape: the columns written are
-- the table's own (never generated / identity-always) that the snapshot
-- carries, so a column added after the snapshot keeps its default and one
-- dropped since is ignored. Called only from abandon_sample_plan_revision.
create or replace function public.sample_plan_restore_rows(p_table text, p_rows jsonb)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_cols text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return;
  end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = format('public.%I', p_table)::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attidentity <> 'a'
     and exists (select 1 from jsonb_array_elements(p_rows) e where e ? a.attname::text);
  if v_cols is null then
    return;
  end if;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)',
                 p_table, v_cols, v_cols, p_table)
    using p_rows;
end;
$function$;

create or replace function public.sample_plan_restore_header(p_table text, p_id uuid, p_row jsonb)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_cols text;
  v_src  text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg('r.' || quote_ident(a.attname), ', ' order by a.attnum)
    into v_cols, v_src
    from pg_attribute a
   where a.attrelid = format('public.%I', p_table)::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attidentity <> 'a'
     -- The plan's identity and audit stay as they are; everything it was
     -- approved WITH (dates, remark, approval stamps, revision_no) comes back.
     and a.attname not in ('id', 'iwo_id', 'location_id', 'created_at', 'created_by', 'updated_at')
     and p_row ? a.attname::text;
  if v_cols is null then
    raise exception 'The approved plan''s header is missing from the revision snapshot.' using errcode = 'P0002';
  end if;
  execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r) where t.id = $2',
                 p_table, v_cols, v_src, p_table)
    using p_row, p_id;
end;
$function$;

create or replace function public.sample_plan_restore(p_kind text, p_bom uuid, p_plan jsonb)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if p_kind = 'fabric' then
    -- Unlocked first (the owner may move the status: 0718's guard), so the
    -- child lock stands down for the rows below.
    update public.iwo_fabric_boms set approval_status = 'open' where id = p_bom;
    -- The bom-level children; yarn stages / shades and combination colours go
    -- with their parents (on delete cascade).
    delete from public.iwo_fabric_bom_yd_combinations where bom_id = p_bom;
    delete from public.iwo_fabric_bom_yd_repeats      where bom_id = p_bom;
    delete from public.iwo_fabric_bom_yarns           where bom_id = p_bom;
    delete from public.iwo_fabric_bom_process_scope   where bom_id = p_bom;
    delete from public.iwo_fabric_bom_processes       where bom_id = p_bom;
    delete from public.iwo_fabric_bom_lines           where bom_id = p_bom;
    delete from public.iwo_fabric_bom_dias            where bom_id = p_bom;
    delete from public.iwo_fabric_bom_palette         where bom_id = p_bom;
    -- Parents before children, ids as approved.
    perform public.sample_plan_restore_rows('iwo_fabric_bom_palette',               p_plan -> 'palette');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_dias',                  p_plan -> 'dias');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_lines',                 p_plan -> 'lines');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_processes',             p_plan -> 'processes');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_process_scope',         p_plan -> 'process_scope');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_yarns',                 p_plan -> 'yarns');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_yarn_stages',           p_plan -> 'yarn_stages');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_yarn_shades',           p_plan -> 'yarn_shades');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_yd_repeats',            p_plan -> 'yd_repeats');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_yd_combinations',       p_plan -> 'yd_combinations');
    perform public.sample_plan_restore_rows('iwo_fabric_bom_yd_combination_colors', p_plan -> 'yd_combination_colors');
    -- Last: the header as approved — status `approved`, its revision number,
    -- its decision stamps. The plan is locked again from here.
    perform public.sample_plan_restore_header('iwo_fabric_boms', p_bom, p_plan -> 'header');
  elsif p_kind = 'accessories' then
    update public.iwo_material_boms set approval_status = 'open' where id = p_bom;
    delete from public.iwo_material_bom_processes where bom_id = p_bom;
    delete from public.iwo_material_bom_items     where bom_id = p_bom;   -- slices cascade
    perform public.sample_plan_restore_rows('iwo_material_bom_items',       p_plan -> 'items');
    perform public.sample_plan_restore_rows('iwo_material_bom_item_slices', p_plan -> 'item_slices');
    perform public.sample_plan_restore_rows('iwo_material_bom_processes',   p_plan -> 'processes');
    perform public.sample_plan_restore_header('iwo_material_boms', p_bom, p_plan -> 'header');
  else
    raise exception 'sample_plan_restore: unknown plan kind %', p_kind;
  end if;
end;
$function$;

-- Owner-only: reachable solely through abandon_sample_plan_revision, which
-- runs as the owner. No role is granted these.
revoke all on function public.sample_plan_restore_rows(text, jsonb) from public, anon, authenticated;
revoke all on function public.sample_plan_restore_header(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sample_plan_restore(text, uuid, jsonb) from public, anon, authenticated;

-- ── 5. Abandon ───────────────────────────────────────────────────────────────
create or replace function public.abandon_sample_plan_revision(p_entry uuid, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  r        record;
  v_status text;
  v_rev    integer;
  v_loc    uuid;
  v_label  text;
  v_live   boolean;
  v_done   integer := 0;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'Abandoning a plan revision needs Orders ▸ Edit.' using errcode = '42501';
  end if;

  for r in
    select x.* from (
      select 'fabric'::text as kind, 1 as ord, v.id, v.bom_id, v.revision_no, v.snapshot
        from public.iwo_fabric_bom_revisions v
       where v.entry_id = p_entry and v.abandoned_at is null
      union all
      select 'accessories'::text, 2, v.id, v.bom_id, v.revision_no, v.snapshot
        from public.iwo_material_bom_revisions v
       where v.entry_id = p_entry and v.abandoned_at is null
    ) x
    order by x.ord
  loop
    v_label := case r.kind when 'fabric' then 'Fabric Plan' else 'Accessories Plan' end;
    v_status := null;
    v_rev := null;
    if r.kind = 'fabric' then
      select b.approval_status, b.revision_no, b.location_id into v_status, v_rev, v_loc
        from public.iwo_fabric_boms b where b.id = r.bom_id for update;
    else
      select b.approval_status, b.revision_no, b.location_id into v_status, v_rev, v_loc
        from public.iwo_material_boms b where b.id = r.bom_id for update;
    end if;
    if v_rev is null or not public.is_current_location(v_loc) then
      raise exception 'That % no longer exists in this unit.', v_label using errcode = 'P0002';
    end if;

    -- Only the revision the plan is IN, and only until it is approved: an
    -- approved revision is the plan now, and an older one was superseded.
    continue when v_rev <> r.revision_no or v_status = 'approved';

    if v_status = 'submitted' then
      v_live := case r.kind when 'fabric' then public.fabric_plan_has_live_run(r.bom_id)
                            else public.accessories_plan_has_live_run(r.bom_id) end;
      if v_live then
        raise exception 'Revision % of the % is with the approver — it can be abandoned once the approver sends it back.',
          r.revision_no, v_label using errcode = '55000';
      end if;
    end if;

    if r.snapshot is null or jsonb_typeof(r.snapshot -> 'plan' -> 'header') is distinct from 'object' then
      raise exception 'Revision % of the % was raised before approved plans were kept, so there is no approved version to go back to. Edit it back and send it for approval instead.',
        r.revision_no, v_label using errcode = '55000';
    end if;

    perform public.sample_plan_restore(r.kind, r.bom_id, r.snapshot -> 'plan');

    if r.kind = 'fabric' then
      update public.iwo_fabric_bom_revisions
         set abandoned_at = now(), abandoned_by = auth.uid(), abandon_reason = nullif(btrim(p_reason), '')
       where id = r.id;
    else
      update public.iwo_material_bom_revisions
         set abandoned_at = now(), abandoned_by = auth.uid(), abandon_reason = nullif(btrim(p_reason), '')
       where id = r.id;
    end if;
    v_done := v_done + 1;
  end loop;

  if v_done = 0 then
    raise exception 'Nothing in this revision is still open — it was approved or abandoned already.' using errcode = '55000';
  end if;
  return v_done;
end;
$function$;

revoke all on function public.abandon_sample_plan_revision(uuid, text) from public, anon;
grant execute on function public.abandon_sample_plan_revision(uuid, text) to authenticated;
