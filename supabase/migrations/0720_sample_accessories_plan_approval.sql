-- 0720 — Sample ▸ Accessories Plan APPROVAL + REVISION (user 2026-10-13: the
-- sample plans get their own approval screen and reports, "like order entry").
--
-- 0718 did this for the Fabric Plan; the client's brief frames every sample
-- approval checkpoint as the place that "locks procurement parameters", and
-- trims are bought from the Accessories Plan exactly as yarn is from the
-- Fabric Plan. So the twin, on the twin's tables, with the same rules:
--
--   approval_status  open → submitted → approved, or → returned (sent back:
--                    editable, resubmit). Production accessories plans never
--                    leave 'open' — Submit lives only on the sample screen.
--   revision_no      Raise Revision reopens an approved plan as the next one.
--   iwo_material_bom_revisions — why, who, when, and the purchase quantities
--                    that had been approved before it.
--
-- THE LOCK is a second trigger beside 0595's `refuse_when_iwo_budget_locked`
-- on every accessories table (that one is not re-created). PURCHASING: the
-- accessories branch of `iwo_purchase_check__all_units` gains the same three
-- keys 0718 gave the fabric branch (0720b), read by `planApprovalRefusal`.
-- THE DECISION: workflow 'sample_accessories_plan', subject 'iwo_material_boms'.

alter table public.iwo_material_boms
  add column if not exists approval_status text not null default 'open',
  add column if not exists revision_no     integer not null default 0,
  add column if not exists submitted_at    timestamptz,
  add column if not exists submitted_by    uuid,
  add column if not exists decided_at      timestamptz,
  add column if not exists decided_by      uuid,
  add column if not exists decision_remark text,
  add column if not exists approved_at     timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'iwo_material_boms_approval_status_check') then
    alter table public.iwo_material_boms
      add constraint iwo_material_boms_approval_status_check
      check (approval_status in ('open', 'submitted', 'approved', 'returned'));
  end if;
end $$;

create table if not exists public.iwo_material_bom_revisions (
  id             uuid primary key default gen_random_uuid(),
  bom_id         uuid not null references public.iwo_material_boms(id) on delete cascade,
  revision_no    integer not null,
  reason         text not null check (btrim(reason) <> ''),
  -- What had been approved before this revision reopened the plan: one entry
  -- per line (material, purchase quantity, unit). Evidence, never re-applied.
  approved_items jsonb not null default '[]'::jsonb,
  raised_by      uuid default auth.uid(),
  raised_at      timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (bom_id, revision_no)
);

alter table public.iwo_material_bom_revisions enable row level security;

create policy iwo_material_bom_revisions_read on public.iwo_material_bom_revisions
  for select to authenticated
  using (public.has_permission('orders', 'view') and public.lv_iwo_material_boms(bom_id));

create or replace function public.accessories_plan_lock_message(p_status text)
returns text language sql immutable set search_path to '' as $$
  select case p_status
    when 'submitted' then
      'This Accessories Plan is with the approver — nothing in it can change until it is approved or sent back.'
    else
      'This Accessories Plan is approved and locked. Raise Revision to change it — the revised plan goes for approval again.'
  end
$$;

create or replace function public.refuse_when_accessories_plan_approved()
returns trigger language plpgsql security definer set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_path   text := tg_argv[0];            -- zero-based: see 0577
  v_rows   jsonb[];
  v_r      jsonb;
  v_bom    uuid;
  v_status text;
begin
  if v_path not in ('material_bom', 'material_item') then
    raise exception 'refuse_when_accessories_plan_approved: unknown path %', v_path;
  end if;
  if tg_op <> 'INSERT' then v_rows := array_append(v_rows, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then v_rows := array_append(v_rows, to_jsonb(new)); end if;
  foreach v_r in array v_rows loop
    v_bom := case v_path
      when 'material_bom' then (v_r->>'bom_id')::uuid
      when 'material_item' then (
        select i.bom_id from public.iwo_material_bom_items i where i.id = (v_r->>'item_line_id')::uuid)
    end;
    continue when v_bom is null;
    select b.approval_status into v_status
      from public.iwo_material_boms b
     where b.id = v_bom and b.approval_status in ('submitted', 'approved');
    if v_status is not null then
      raise exception '%', public.accessories_plan_lock_message(v_status) using errcode = '55000';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function public.refuse_when_accessories_plan_approved() from public, anon;

drop trigger if exists trg_accessories_plan_lock on public.iwo_material_bom_items;
create trigger trg_accessories_plan_lock before insert or update or delete on public.iwo_material_bom_items
  for each row execute function public.refuse_when_accessories_plan_approved('material_bom');
drop trigger if exists trg_accessories_plan_lock on public.iwo_material_bom_processes;
create trigger trg_accessories_plan_lock before insert or update or delete on public.iwo_material_bom_processes
  for each row execute function public.refuse_when_accessories_plan_approved('material_bom');
drop trigger if exists trg_accessories_plan_lock on public.iwo_material_bom_item_slices;
create trigger trg_accessories_plan_lock before insert or update or delete on public.iwo_material_bom_item_slices
  for each row execute function public.refuse_when_accessories_plan_approved('material_item');

create or replace function public.accessories_plan_has_live_run(p_bom uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.approval_runs r
     where r.subject_table = 'iwo_material_boms' and r.subject_id = p_bom and r.status = 'in_progress')
$$;
revoke all on function public.accessories_plan_has_live_run(uuid) from public, anon;
grant execute on function public.accessories_plan_has_live_run(uuid) to authenticated;

-- NOT security definer: `current_user` must read 'authenticated' for a client
-- write and the owner for the terminal trigger / revision RPC (as 0718).
create or replace function public.guard_accessories_plan_approval()
returns trigger language plpgsql set search_path to 'pg_catalog', 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    if old.approval_status in ('submitted', 'approved') then
      raise exception 'This Accessories Plan is % — it cannot be deleted.', old.approval_status using errcode = '55000';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' and (new.approval_status <> 'open' or new.revision_no <> 0) then
      raise exception 'A new Accessories Plan starts open, at revision 0.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.approval_status in ('submitted', 'approved')
     and (new.iwo_id, new.bom_date, new.is_draft, new.remark)
         is distinct from (old.iwo_id, old.bom_date, old.is_draft, old.remark) then
    raise exception '%', public.accessories_plan_lock_message(old.approval_status) using errcode = '55000';
  end if;
  if current_user = 'authenticated' then
    if new.revision_no is distinct from old.revision_no then
      raise exception 'An Accessories Plan revision is raised only through Raise Revision.' using errcode = '42501';
    end if;
    if new.approval_status is distinct from old.approval_status
       and not (
         (old.approval_status in ('open', 'returned') and new.approval_status = 'submitted')
         or (old.approval_status = 'submitted' and new.approval_status = 'open'
             and not public.accessories_plan_has_live_run(old.id))
       ) then
      raise exception
        'Only the approval flow can approve or send back an Accessories Plan; an approved plan reopens only through Raise Revision.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_accessories_plan_approval on public.iwo_material_boms;
create trigger trg_guard_accessories_plan_approval
  before insert or update or delete on public.iwo_material_boms
  for each row execute function public.guard_accessories_plan_approval();

create or replace function public.raise_accessories_plan_revision(p_bom uuid, p_reason text)
returns integer language plpgsql security definer set search_path to 'pg_catalog', 'public'
as $function$
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
  v_next := v_plan.revision_no + 1;
  insert into public.iwo_material_bom_revisions (bom_id, revision_no, reason, approved_items)
  select p_bom, v_next, btrim(p_reason),
         coalesce(jsonb_agg(jsonb_build_object(
                    'item_id', i.item_id, 'name', it.name,
                    'purchase_qty', i.purchase_qty, 'uom', u.code) order by i.sno), '[]'::jsonb)
    from public.iwo_material_bom_items i
    left join public.items it on it.id = i.item_id
    left join public.uoms u on u.id = coalesce(i.purchase_uom_id, i.consumption_uom_id)
   where i.bom_id = p_bom;
  update public.iwo_material_boms
     set approval_status = 'open', revision_no = v_next,
         submitted_at = null, submitted_by = null, updated_at = now()
   where id = p_bom;
  return v_next;
end;
$function$;

revoke all on function public.raise_accessories_plan_revision(uuid, text) from public, anon;
grant execute on function public.raise_accessories_plan_revision(uuid, text) to authenticated;

create or replace function public.sample_accessories_plan_apply_decision(
  p_bom uuid, p_run_status text, p_actor uuid, p_remark text)
returns void language plpgsql security definer set search_path to 'pg_catalog', 'public'
as $function$
declare v_rows int;
begin
  if p_run_status = 'cancelled' then
    update public.iwo_material_boms
       set approval_status = 'open', submitted_at = null, submitted_by = null, updated_at = now()
     where id = p_bom and approval_status = 'submitted';
    return;
  end if;
  if p_run_status not in ('completed', 'rejected') then
    return;
  end if;
  update public.iwo_material_boms
     set approval_status = case p_run_status when 'completed' then 'approved' else 'returned' end,
         approved_at     = case p_run_status when 'completed' then now() else approved_at end,
         decided_at      = now(),
         decided_by      = p_actor,
         decision_remark = p_remark,
         updated_at      = now()
   where id = p_bom and approval_status = 'submitted';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception
      'Accessories Plan % is not awaiting a decision, so this approval could not be applied. Reload the plan — it may already have been decided another way.',
      p_bom using errcode = '55000';
  end if;
end;
$function$;

revoke all on function public.sample_accessories_plan_apply_decision(uuid, text, uuid, text) from public, anon;
