-- 0735 · CMT Process master — its own master, NOT part of the Process master (2026-10-17).
--
-- REVERSES 0734's placement (user, same day: "CMT is separate process not inside
-- process — CMT process master add under material master directly"). 0734 put the
-- CMT stage and standard rate on `processes`, reasoning that 0691 already kept CMT
-- operations there. The client's model is different: a Process is a sub-contract
-- process (dyeing, compacting, printing …); a CMT operation (Cutting ▸ Size
-- Stickering, Sewing ▸ Singer …) is the garment floor's own work and is kept in a
-- separate list — Master Data ▸ Materials ▸ CMT Processes.
--
--   cmt_processes        name, stage (one of the five), optional ₹/pc standard rate.
--                        The stage is NOT NULL here, unlike 0734's column: every
--                        row is born on the CMT master, which requires it.
--
-- MOVING THE ROWS. Every `processes` row with garment_kind = 'cmt' is copied with
-- its SAME id, stage, rate and inactive flag. The copied process rows are NOT
-- deleted: CUTTING / PACKING / IRONING are referenced from 19 FK columns (style
-- processes, BOM stages, vendor processes …), so they stay as plain processes with
-- no garment kind — they simply stop being offered as CMT operations.
--
-- COSTING LINES. `sample_costing_piece_processes.process_id` points at `processes`.
-- A CMT line now points at `cmt_processes` through a new `cmt_process_id`; an
-- Embellishment line keeps `process_id` (Embellishments stay on the Process
-- master). Because the ids were copied unchanged, existing CMT lines move by
-- copying the id across.
--
-- `save_sample_costing` is NOT rewritten. It still writes the picked id into
-- `process_id` for both kinds, and a BEFORE INSERT trigger routes a CMT line's id
-- into `cmt_process_id`. That keeps the 300-line RPC (last re-created by 0725)
-- untouched, so this migration cannot silently drop a later change to it.
--
-- PROCESS MASTER. `cmt_stage` (0734) is dropped and garment_kind narrows to
-- 'embellishment'. `standard_rate` stays: it pre-fills an Embellishment line too.

-- 1 · the master -------------------------------------------------------------

create table if not exists public.cmt_processes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  cmt_stage     text not null check (cmt_stage in ('cutting', 'sewing', 'checking', 'ironing', 'packing')),
  standard_rate numeric check (standard_rate is null or standard_rate >= 0),
  inactive      boolean not null default false,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists cmt_processes_updated_at on public.cmt_processes;
create trigger cmt_processes_updated_at before update on public.cmt_processes
  for each row execute function public.set_updated_at();

alter table public.cmt_processes enable row level security;
drop policy if exists cmt_processes_read on public.cmt_processes;
drop policy if exists cmt_processes_insert on public.cmt_processes;
drop policy if exists cmt_processes_update on public.cmt_processes;
drop policy if exists cmt_processes_delete on public.cmt_processes;
create policy cmt_processes_read on public.cmt_processes for select using (true);
create policy cmt_processes_insert on public.cmt_processes for insert with check (public.has_permission('masters', 'create'));
create policy cmt_processes_update on public.cmt_processes for update
  using (public.has_permission('masters', 'edit')) with check (public.has_permission('masters', 'edit'));
create policy cmt_processes_delete on public.cmt_processes for delete using (public.has_permission('masters', 'delete'));

-- 2 · move the rows (same ids) -------------------------------------------------

insert into public.cmt_processes (id, name, cmt_stage, standard_rate, inactive, created_at, created_by)
select p.id, p.name, coalesce(p.cmt_stage, 'sewing'), p.standard_rate, coalesce(p.inactive, false), p.created_at, null
  from public.processes p
 where p.garment_kind = 'cmt'
on conflict (id) do nothing;

-- 3 · costing lines -----------------------------------------------------------

alter table public.sample_costing_piece_processes
  add column if not exists cmt_process_id uuid references public.cmt_processes (id) on delete set null;

update public.sample_costing_piece_processes
   set cmt_process_id = process_id, process_id = null
 where kind = 'cmt' and process_id is not null;

alter table public.sample_costing_piece_processes drop constraint if exists sample_costing_piece_processes_master_by_kind;
alter table public.sample_costing_piece_processes
  add constraint sample_costing_piece_processes_master_by_kind
  check ((kind = 'cmt' and process_id is null) or (kind = 'embellishment' and cmt_process_id is null));

create or replace function public.route_cmt_piece_process()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- save_sample_costing writes the picked id into process_id for both kinds;
  -- a CMT pick is a cmt_processes id (0735), so it moves to its own column.
  if new.kind = 'cmt' and new.process_id is not null then
    new.cmt_process_id := coalesce(new.cmt_process_id, new.process_id);
    new.process_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public.route_cmt_piece_process() from public, anon;

drop trigger if exists sample_costing_piece_processes_route_cmt on public.sample_costing_piece_processes;
create trigger sample_costing_piece_processes_route_cmt
  before insert or update on public.sample_costing_piece_processes
  for each row execute function public.route_cmt_piece_process();

-- 4 · the Process master lets go of CMT ----------------------------------------

alter table public.processes drop constraint if exists processes_cmt_stage_check;
update public.processes set garment_kind = null where garment_kind = 'cmt';
alter table public.processes drop column if exists cmt_stage;

alter table public.processes drop constraint if exists processes_garment_kind_check;
alter table public.processes
  add constraint processes_garment_kind_check
  check (garment_kind is null or garment_kind = 'embellishment');
