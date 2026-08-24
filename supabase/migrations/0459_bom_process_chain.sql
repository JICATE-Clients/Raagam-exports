-- =============================================================================
-- 0459 — A trim can be chained through several processes, colour by colour
--
-- doc/file.md §6: "The pipeline allows for chaining multiple stages for a single
-- trim item (e.g. Dyeing -> Printing -> Engraving). This is critical for items
-- involving Contrast Panel Splits, where one bulk 'Grey' purchase is sliced into
-- multiple colour-wise batches based on the Combo-to-Component mapping."
--
-- Everything else §6 asks for is already here and is NOT rebuilt: the challan
-- (0445 · 0446), the stock legs that put material at the processor and bring it
-- back (0447 · 0448), and the colour-wise rollup that turns a per-panel BOM into
-- a per-trim-colour requirement (0436 · 0454, `colourSplits` and the `raw` groups
-- in `bom-ceiling-service.ts`). This migration adds the two facts that were
-- genuinely missing, and nothing else.
--
--   1. WHICH STAGE FEEDS WHICH   -> `prev_row_uid`
--   2. WHICH COLOUR A STAGE MAKES -> `item_color_id`
--
-- ## THE LINK IS BY `row_uid`, AND IT COULD NOT BE ANYTHING ELSE
--
-- `writeChildren` (material-bom-amendment/actions.ts) does, on EVERY save:
--
--     delete from material_bom_amendment_processes where amendment_id = ?
--     insert ... (normalizeProcesses(data))
--
-- so `id` is re-minted and `sno` is renumbered on every save. 0446 already
-- learned this the expensive way and minted `row_uid` — an immutable, never-shown
-- anchor — because a legally issued Rule 55 challan points at it. A chain link
-- keyed to `id` would come apart on the first save, silently: stage 2 would read
-- as a head, take its input from grey stock instead of from stage 1's return, and
-- the arithmetic would still add up. That is the failure this column shape
-- prevents.
--
-- Which is also why the chain is NOT a new child table. A child table keyed on
-- the process row's `id` dies at the same save; keyed on `row_uid` it is a second
-- structure `writeChildren` must delete and reinsert in step with the first, and
-- a table on the insert side and not the delete side is the standing warning at
-- the top of that file. Two columns on the row the challan already anchors is one
-- write, one delete, and one thing to keep true.
--
-- ## `stage_no` IS DELIBERATELY NOT STORED
--
-- The obvious companion column is an ordinal. It is not here, because it would be
-- a second statement of a fact `prev_row_uid` already makes — and the Balance
-- cell on this very screen carries the rule: "two columns and their difference
-- kept in three places is two chances for them to disagree". A stored ordinal
-- that disagrees with the links is unreadable by anything: the operator sees
-- "Stage 2" while the arithmetic draws from a different row.
--
-- The stage NUMBER is depth in the link graph, derived once by `readChain()`
-- (lib/orders/process-chain/chain.ts) and read by the screen and the server from
-- that one function. Grid ORDER is unaffected — `sno` still holds it, exactly as
-- before.
--
-- ## A CHAIN IS A TREE, NOT A LIST, AND THAT IS ON PURPOSE
--
-- Nothing here says a stage may have only one successor, because the trade case
-- is real and ordinary: 1,000 buttons come back from the dyer as navy, 400 of
-- them go on to be engraved and 600 do not. Forbidding the split would refuse
-- correct work. The quantity rule generalises with it — a stage may forward at
-- most what came BACK from its predecessor, less whatever its siblings have
-- already forwarded (`dispatchCeiling`).
--
-- Fan-IN is what is refused, structurally: one `prev_row_uid` per row means a
-- stage has exactly one source. Two dye lots merging into one print run would
-- make "how much came back to feed this" unanswerable without a second quantity
-- column, and an unanswerable number here is a number somebody sends a lorry on.
--
-- ## `status` IS NOT EXTENDED, AND THE FOURTH LIFECYCLE STATE IS WHY
--
-- §6 names four states, ending "Issued to Production". The temptation is to add
-- `issued` to this table's `status` check. It is the wrong home: an issue is a
-- `stock_ledger` movement out of the material store, gated by
-- `apply_stock_movement`'s negative-balance raise (0447's "the gate comes free").
-- A BOM row claiming `issued` would be a copy of a fact it cannot keep true — the
-- goods can be issued, returned and re-issued without this row ever being saved
-- again. The lifecycle is DERIVED instead, by `lifecycleOf()`, from the row, its
-- challan and the stock figures. Nothing is stored twice.
--
-- ## NO FUNCTION IS CREATED HERE
--
-- so there is nothing to `revoke ... from public, anon` (AGENTS.md, "Function
-- grants"). Stated rather than left to be noticed as an omission.
-- =============================================================================

alter table public.material_bom_amendment_processes
  add column if not exists prev_row_uid  uuid,
  add column if not exists item_color_id uuid references public.config_lookups(id);

comment on column public.material_bom_amendment_processes.prev_row_uid is
  'The stage whose RETURN feeds this one (0459). NULL = a head: its input is grey '
  'stock, not another stage. Points at row_uid and never at id — writeChildren '
  're-mints id on every save and row_uid is the one thing that survives (0446).';

comment on column public.material_bom_amendment_processes.item_color_id is
  'The colourway this stage PRODUCES (0459). NULL = grey/undyed at this stage — a '
  'real value, not "missing": one bulk grey purchase is sliced colour-wise, and '
  'the head of a dye chain is exactly the row whose input has no colour. Same FK '
  'target as material_bom_amendment_requirements.item_color_id (0454), so a chain '
  'head and the requirement it satisfies compare without a translation.';

-- THE COMPOSITE FK, and each half of it is load-bearing.
--
-- `amendment_id` rides along so a chain cannot reach across two BOMs — without
-- it, a stale form could point stage 2 of this order's BOM at a row belonging to
-- another order's, and every quantity downstream would be drawn from the wrong
-- document. The target is `uq_mba_proc_row_uid (amendment_id, row_uid)`, the
-- unique index 0446 already created for the challan link.
--
-- ON DELETE NO ACTION, NOT CASCADE, and this is the one clause worth reading
-- twice. Cascade would let removing a Dyeing row silently delete the Printing row
-- beneath it — including a Printing row that has already gone out under a
-- challan. That is precisely the refusal 0446 built (`writeChildren` names the
-- challan and declines the save), defeated by a foreign key doing it quietly.
--
-- NO ACTION is also what keeps the wholesale delete working: it is checked at
-- END OF STATEMENT, so `delete ... where amendment_id = ?` removes parent and
-- child together and passes, while deleting a parent alone is refused. RESTRICT
-- would have broken every save. The assert block below proves both, by doing them.
alter table public.material_bom_amendment_processes
  drop constraint if exists mba_proc_prev_row_fkey;

alter table public.material_bom_amendment_processes
  add constraint mba_proc_prev_row_fkey
  foreign key (amendment_id, prev_row_uid)
  references public.material_bom_amendment_processes (amendment_id, row_uid)
  on delete no action on update no action;

-- The cheapest cycle is a row pointing at itself, and it is the one a copy-paste
-- of a row's own uid produces. A longer cycle cannot be expressed as a CHECK —
-- `readChain()` refuses those, with the sentence naming the stages involved.
alter table public.material_bom_amendment_processes
  drop constraint if exists mba_proc_prev_not_self;

alter table public.material_bom_amendment_processes
  add constraint mba_proc_prev_not_self
  check (prev_row_uid is null or prev_row_uid <> row_uid);

-- Walking a chain reads "every row whose prev is X", per amendment.
create index if not exists idx_mba_proc_prev
  on public.material_bom_amendment_processes (amendment_id, prev_row_uid)
  where prev_row_uid is not null;

create index if not exists idx_mba_proc_colour
  on public.material_bom_amendment_processes (amendment_id, item_color_id)
  where item_color_id is not null;


do $assert$
declare
  v_target  text;
  v_ncols   int;
  v_deltype "char";
  v_amd     uuid;
  v_a       uuid := gen_random_uuid();   -- row A's row_uid
  v_b       uuid := gen_random_uuid();   -- row B's row_uid, chained to A
  v_dangling_refused   boolean := false;
  v_self_refused       boolean := false;
  v_lone_delete_refused boolean := false;
  v_bulk_delete_ok     boolean := false;
begin
  -- 1. Both columns landed.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='material_bom_amendment_processes'
       and column_name='prev_row_uid'
  ) then
    raise exception '0459: prev_row_uid is missing — nothing sequences the stages';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='material_bom_amendment_processes'
       and column_name='item_color_id'
  ) then
    raise exception '0459: item_color_id is missing — a grey lot cannot be sliced colour-wise';
  end if;

  -- 2. The FK is self-referential, composite, and NOT cascading.
  select confrelid::regclass::text, array_length(conkey, 1), confdeltype
    into v_target, v_ncols, v_deltype
    from pg_constraint where conname = 'mba_proc_prev_row_fkey' and contype = 'f';

  if v_target is null then
    raise exception '0459: mba_proc_prev_row_fkey is missing — a chain link could point anywhere';
  end if;
  if v_target <> 'material_bom_amendment_processes' then
    raise exception '0459: mba_proc_prev_row_fkey points at % — it must be self-referential', v_target;
  end if;
  if v_ncols <> 2 then
    raise exception '0459: mba_proc_prev_row_fkey is not composite — a chain could reach across two BOMs';
  end if;
  -- 'a' = NO ACTION. 'c' would be CASCADE, which is the failure described above:
  -- deleting a Dyeing row would silently take a DISPATCHED Printing row with it.
  if v_deltype <> 'a' then
    raise exception '0459: mba_proc_prev_row_fkey delete action is %, not NO ACTION — a dispatched successor could be deleted silently',
      v_deltype;
  end if;

  -- 3. THE PROBE. Every claim above is a claim about a catalogue row; these are
  --    claims about what the database DOES. `material_bom_amendment_processes`
  --    holds zero rows (catalogue, 2026-08-23), so this creates its own subject
  --    and unwinds it — plpgsql variables survive the rollback, DB state does not.
  begin
    insert into public.material_bom_amendments default values returning id into v_amd;

    insert into public.material_bom_amendment_processes (amendment_id, sno, row_uid)
    values (v_amd, 1, v_a);

    -- 3a. A link to a row that does not exist must be refused. Without this the
    --     chain silently un-chains: stage 2 reads as a head and draws its input
    --     from grey stock instead of from stage 1's return.
    begin
      insert into public.material_bom_amendment_processes
        (amendment_id, sno, row_uid, prev_row_uid)
      values (v_amd, 9, gen_random_uuid(), gen_random_uuid());
    exception when foreign_key_violation then
      v_dangling_refused := true;
    end;

    -- 3b. A real link must be accepted, or the feature does not exist.
    insert into public.material_bom_amendment_processes
      (amendment_id, sno, row_uid, prev_row_uid)
    values (v_amd, 2, v_b, v_a);

    -- 3c. A row may not feed itself.
    begin
      update public.material_bom_amendment_processes
         set prev_row_uid = v_b
       where amendment_id = v_amd and row_uid = v_b;
    exception when check_violation then
      v_self_refused := true;
    end;

    -- 3d. Deleting the PARENT alone, while its successor still stands, must be
    --     refused — that is the cascade failure, arrived at by hand.
    begin
      delete from public.material_bom_amendment_processes
       where amendment_id = v_amd and row_uid = v_a;
    exception when foreign_key_violation then
      v_lone_delete_refused := true;
    end;

    -- 3e. AND THE WHOLESALE DELETE MUST STILL PASS. This is what `writeChildren`
    --     does on every save; a RESTRICT here would have broken every save of
    --     every chained BOM, and the catalogue check above cannot tell the two
    --     apart by reading.
    delete from public.material_bom_amendment_processes where amendment_id = v_amd;
    v_bulk_delete_ok := true;

    -- Unwind. Raised rather than rolled back because a DO block has no
    -- transaction control; the handler below swallows exactly this one.
    raise exception 'PROBE_UNWIND';
  exception when others then
    if sqlerrm <> 'PROBE_UNWIND' then raise; end if;
  end;

  if not v_dangling_refused then
    raise exception '0459: a chain link to a non-existent stage was ACCEPTED — stage 2 would silently read as a head';
  end if;
  if not v_self_refused then
    raise exception '0459: a stage was allowed to feed itself — mba_proc_prev_not_self is not doing anything';
  end if;
  if not v_lone_delete_refused then
    raise exception '0459: deleting a stage out from under its successor was ACCEPTED — a dispatched row could be orphaned';
  end if;
  if not v_bulk_delete_ok then
    raise exception '0459: the wholesale delete writeChildren performs on every save was REFUSED';
  end if;
end $assert$;
