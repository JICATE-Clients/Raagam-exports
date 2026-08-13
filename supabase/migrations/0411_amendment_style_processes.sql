-- ============================================================================
-- Raagam ERP — 0411 Garment Order Amendment ▸ Style(s) ▸ the per-style Process list
--
-- The Style(s) grid's "Process" button has been a disabled placeholder since the
-- tab was built — `title="Nested Process screen — awaiting spec"`. The client
-- gave the spec on 2026-08-12: clicking it opens a Process screen whose **Type**
-- field offers two values, **Garment Process** and **Component Process**, and
-- whose process list is wired to the Process master.
--
-- That answers a question this module has carried open since the tab was built:
-- whether the button meant a per-component process (pre-assembly printing and
-- embroidery) or a reuse of the per-order `/orders/garment-processes` screen.
-- The answer is BOTH, told apart by Type.
--
--
-- WHY THERE IS NO `type` LOOKUP, AND NO SEEDED ROWS
--
-- `processes` (0227) already carries `for_garments` and `for_components` — the
-- master's own applicability flags, answering the very question Type asks. So
-- Type is not a new vocabulary to seed and maintain; it is a two-valued
-- discriminator that CHOOSES WHICH FLAG FILTERS THE LIST. Seeding two rows into
-- `config_lookups` would have created a second place for the same fact to live,
-- and the two would drift the moment someone ticked a flag on the master.
--
-- Hence `kind text check (kind in ('garment','component'))` rather than an FK.
-- Two values fixed by the master's own column names is a CHECK, not a table.
--
--
-- WHY `style_ref_no` (TEXT) AND NOT AN FK TO `..._styles.id`
--
-- Identical reasoning to 0407, and it is not optional here either.
-- `writeChildren` (lib/orders/amendments/actions.ts) deletes and reinserts every
-- child grid WHOLESALE, so `garment_order_amendment_styles.id` is a new uuid
-- after every save; a row pointing at the old one is orphaned, or cascaded away
-- mid-write while the screen still shows the processes.
--
-- Keying on the text ref is the module's convention, not a workaround: Price
-- Details (`styleLineKeyOf`), Quantities (`refNoOptions`), Approval Qty
-- (`poQtyOf`) and Style Sizes (0407) all resolve on this exact string. This
-- makes a fifth. Nothing parses it — `styleKey` and `norm` trim and upper-case
-- and stop, which matters as of 0402, since the code carries SLASHES
-- (`STL/2627/0001`).
--
--
-- BOTH ANSWER COLUMNS ARE NULLABLE, DELIBERATELY
--
-- A row with no Type and no Process is what the operator is standing in the
-- middle of typing. The normalizer drops it before insert; NOT NULL here would
-- turn "I have not answered yet" into a 23502 at save time. Same call 0407 made
-- for `size_id`, for the same reason.
--
--
-- UNIQUE PER (amendment, style, kind, process)
--
-- Naming the same process twice under the same Type says nothing the first row
-- did not. `kind` is IN the key on purpose: a process flagged both
-- `for_garments` and `for_components` is legitimately listed under each Type,
-- and a key without `kind` would refuse the second — turning a correct entry
-- into a save error.
--
-- The screen passes sibling ids as `usedIds` so a duplicate is never offered,
-- and the normalizer de-duplicates before insert; the index exists for
-- `lib/data-io`, which writes past the screen. Nulls compare as distinct in
-- Postgres, so a wholly blank row is not caught by it — correct, because the
-- normalizer has already dropped it, and a unique index is not the place to say
-- "answer the question".
-- ============================================================================


create table if not exists public.garment_order_amendment_style_processes (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,

  -- The style this process belongs to. TEXT, not an FK — see the header.
  style_ref_no text,
  sno          int not null default 0,

  -- "Type" on screen. Chooses which master flag filters the list beside it.
  kind         text check (kind is null or kind in ('garment', 'component')),
  process_id   uuid references public.processes(id),

  created_at   timestamptz not null default now()
);

create index if not exists idx_goa_style_processes_amend
  on public.garment_order_amendment_style_processes(amendment_id);

-- The lookup the screen actually does: "the processes of THIS style on THIS order".
create index if not exists idx_goa_style_processes_style
  on public.garment_order_amendment_style_processes(amendment_id, style_ref_no);

create unique index if not exists uq_goa_style_processes_process
  on public.garment_order_amendment_style_processes(amendment_id, style_ref_no, kind, process_id);

alter table public.garment_order_amendment_style_processes enable row level security;

-- Shape, cascade, `sno` and permission module all mirror
-- `garment_order_amendment_style_sizes` (0407) and
-- `garment_order_amendment_pack_types` (0399), so the amendment's child tables
-- stay one family rather than ten dialects.
do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_style_processes');
end $rls$;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- The unique index and the CHECK are asserted BY VIOLATING THEM rather than by
-- looking them up: a name being present proves a name is present, and what is
-- worth knowing is that a second identical process is actually refused, that the
-- same process under the OTHER Type is actually accepted, and that a third Type
-- is actually rejected.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend   uuid;
  probe_process uuid;
  probe_count   int;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'garment_order_amendment_style_processes'
  ) then
    raise exception '0411: garment_order_amendment_style_processes was not created';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'garment_order_amendment_style_processes') <> 4 then
    raise exception '0411: expected 4 policies on garment_order_amendment_style_processes';
  end if;

  -- Any existing amendment will do; with none there is nothing to hang a probe
  -- row off, and the assertions below are SKIPPED rather than faked.
  select id into probe_amend   from public.garment_order_amendments limit 1;
  select id into probe_process from public.processes limit 1;

  if probe_amend is not null and probe_process is not null then
    -- 1. A duplicate process under the SAME Type must be refused.
    begin
      insert into public.garment_order_amendment_style_processes
        (amendment_id, style_ref_no, sno, kind, process_id)
      values (probe_amend, '__0411_probe', 9001, 'garment', probe_process),
             (probe_amend, '__0411_probe', 9002, 'garment', probe_process);
      raise exception '0411: (amendment_id, style_ref_no, kind, process_id) admitted a duplicate';
    exception when unique_violation then
      null;  -- expected
    end;
    delete from public.garment_order_amendment_style_processes where style_ref_no = '__0411_probe';

    -- 2. The SAME process under the OTHER Type must be ACCEPTED. This is the
    --    half a key without `kind` would have broken, and it is the reason the
    --    column is in the index at all.
    insert into public.garment_order_amendment_style_processes
      (amendment_id, style_ref_no, sno, kind, process_id)
    values (probe_amend, '__0411_probe', 9001, 'garment',   probe_process),
           (probe_amend, '__0411_probe', 9002, 'component', probe_process);
    select count(*) into probe_count
      from public.garment_order_amendment_style_processes
     where style_ref_no = '__0411_probe';
    if probe_count <> 2 then
      raise exception '0411: the same process under both Types was not accepted (got %)', probe_count;
    end if;
    delete from public.garment_order_amendment_style_processes where style_ref_no = '__0411_probe';

    -- 3. A Type outside the two the client named must be refused.
    begin
      insert into public.garment_order_amendment_style_processes
        (amendment_id, style_ref_no, sno, kind, process_id)
      values (probe_amend, '__0411_probe', 9003, 'fabric', probe_process);
      raise exception '0411: kind admitted a value outside (garment, component)';
    exception when check_violation then
      null;  -- expected
    end;
    delete from public.garment_order_amendment_style_processes where style_ref_no = '__0411_probe';
  end if;
end $verify$;
