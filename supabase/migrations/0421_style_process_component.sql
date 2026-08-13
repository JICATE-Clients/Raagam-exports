-- ============================================================================
-- Raagam ERP — 0421 Garment Order ▸ Style(s) ▸ Process ▸ WHICH PANEL
--
-- The client's spec, 2026-08-13:
--
--     "Within the Style tab of the order, a Process button is used to define
--      work on cut panels (e.g. printing a logo or embroidery) before the
--      garment is sewn."
--
-- 0411 built Type and Process and 0412 added Details, and between them they
-- answer "what work" but not "on what". "Component Process" today means only
-- that the process's master row is flagged `for_components` — a property of the
-- PROCESS, not a statement about this style. So an order that prints a logo on
-- the front body and embroiders the cuff records two rows that are
-- indistinguishable except by a free-text remark.
--
--
-- IT REFERENCES THE COMPONENTS MASTER, NOT THE STYLE'S OWN ROW
--
-- `components` (0228) is the master; `garment_style_components` (0124) is the
-- style's list of which ones it is made of, and the screen offers exactly that
-- list. Pointing at the master rather than at the style's row is deliberate and
-- is the same call 0411 made about `style_ref_no`: a style's component rows are
-- rewritten wholesale on every save of the Style master, so their ids are not
-- stable, while a `components` row is a master record that persists.
--
-- The NARROWING — only this style's components are offered — is therefore a
-- screen concern, which is where the cascading-picker rule puts it: the caller
-- that knows the style does the narrowing.
--
--
-- NULLABLE, AND THAT IS TWO DIFFERENT "NO ANSWER"S
--
-- A Garment Process has no panel at all — the work is on the made-up garment,
-- so the column is empty for a legitimate reason and will stay empty forever.
-- A half-typed Component Process has not been answered YET. Neither is an
-- error, and NOT NULL would turn both into a 23502 at save time. Same call 0411
-- made for both of its own answer columns.
--
--
-- THE UNIQUE KEY MUST WIDEN, AND THIS IS THE HALF THAT WOULD HAVE BROKEN
--
-- 0411's key is (amendment_id, style_ref_no, kind, process_id). Add a component
-- without touching it and PRINTING on the FRONT BODY plus PRINTING on the
-- SLEEVE — the exact pair the client described — is refused as a duplicate.
-- That is the same trap 0411 already documented when it put `kind` in the key:
-- "a key without `kind` would refuse the second — turning a correct entry into
-- a save error."
--
-- Nulls compare as distinct in Postgres, so two Garment Processes naming one
-- process still collide (correct — the second says nothing the first did not),
-- while two Component Processes on different panels do not.
-- ============================================================================


alter table public.garment_order_amendment_style_processes
  add column if not exists component_id uuid references public.components(id);

comment on column public.garment_order_amendment_style_processes.component_id is
  'Which cut panel this process is done on, from the components master (0228). NULL on a Garment Process, which has no panel — see 0421.';

create index if not exists idx_goa_style_processes_component
  on public.garment_order_amendment_style_processes(component_id);

drop index if exists public.uq_goa_style_processes_process;

create unique index if not exists uq_goa_style_processes_process
  on public.garment_order_amendment_style_processes(
    amendment_id, style_ref_no, kind, process_id, component_id
  );


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- The key is asserted BY VIOLATING IT, both ways round, because "an index named
-- X exists" proves a name. What is worth knowing is that the same process on
-- two panels is now ACCEPTED — the thing the old key would have refused, and
-- the entire reason this migration touches it — and that the same process on
-- the SAME panel is still refused.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend   uuid;
  probe_process uuid;
  probe_comp_a  uuid;
  probe_comp_b  uuid;
  probe_count   int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'garment_order_amendment_style_processes'
       and column_name  = 'component_id'
  ) then
    raise exception '0421: component_id was not added';
  end if;

  if (select is_nullable from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'garment_order_amendment_style_processes'
         and column_name  = 'component_id') <> 'YES' then
    raise exception '0421: component_id is NOT NULL — a Garment Process has no panel to name';
  end if;

  select id into probe_amend   from public.garment_order_amendments limit 1;
  select id into probe_process from public.processes limit 1;
  select id into probe_comp_a  from public.components order by short_name limit 1;
  select id into probe_comp_b  from public.components order by short_name desc limit 1;

  if probe_amend is null or probe_process is null
     or probe_comp_a is null or probe_comp_b is null or probe_comp_a = probe_comp_b then
    raise notice '0421: not enough rows to probe with (need an amendment, a process and 2 components) — key assertions SKIPPED';
    return;
  end if;

  -- 1. THE SAME PROCESS ON TWO PANELS MUST BE ACCEPTED. This is what the old
  --    key refused and the whole reason it widened.
  insert into public.garment_order_amendment_style_processes
    (amendment_id, style_ref_no, sno, kind, process_id, component_id)
  values (probe_amend, '__0421_probe', 9001, 'component', probe_process, probe_comp_a),
         (probe_amend, '__0421_probe', 9002, 'component', probe_process, probe_comp_b);
  select count(*) into probe_count
    from public.garment_order_amendment_style_processes
   where style_ref_no = '__0421_probe';
  if probe_count <> 2 then
    raise exception '0421: the same process on two panels was refused (got %)', probe_count;
  end if;

  -- 2. THE SAME PROCESS ON THE SAME PANEL MUST STILL BE REFUSED.
  begin
    insert into public.garment_order_amendment_style_processes
      (amendment_id, style_ref_no, sno, kind, process_id, component_id)
    values (probe_amend, '__0421_probe', 9003, 'component', probe_process, probe_comp_a);
    raise exception '0421: a duplicate (process, panel) was admitted';
  exception when unique_violation then
    null;  -- expected
  end;

  delete from public.garment_order_amendment_style_processes where style_ref_no = '__0421_probe';
end $verify$;
