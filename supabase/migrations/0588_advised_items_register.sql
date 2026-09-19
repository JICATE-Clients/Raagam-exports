-- ============================================================================
-- Raagam ERP — 0588 Advised Items: the TBA state becomes a checked, stamped,
-- purchasable-only-once-settled state on the Material BOM line
--
-- `doc/order/advised-items-plan.md` (2026-09-19), from the client's "Advised
-- Item System Logic & Lifecycle Workflow": Material BOM entry → Budget →
-- Advised Items Register → hard PO block → buyer confirms → Available → PO
-- unlocked. (Written as 0587 in the plan; 0587 was taken by the IWO work by the
-- time this was written.)
--
--
-- ONE STATE, ON THE BOM LINE
--
-- The advised state already IS `material_bom_amendment_items.type` (0265) —
-- "To be advised" vs "Available Item", flipped by the TBA toggle. There is NO
-- second enum beside it and NO stored `is_po_locked`: the PO block is DERIVED
-- from `type`, because a stored flag can be left TRUE after conversion and block
-- a real item for ever. The Register (/orders/advised-items) is a VIEW of these
-- lines, never a second list to keep in step — which is why the orphan
-- `order_advised_items` (0032, a free-text list nothing reads) is dropped here.
--
--
-- (a) `type` IS CONSTRAINED — normalised first
--
-- NOT NULL, default 'Available Item', CHECK in the two values the switch has.
-- Live on 2026-09-19 every line is 'Available Item', so the normalising UPDATE
-- is a no-op here and is written anyway for any environment that differs:
--   blank / NULL        → 'Available Item' (the switch's OFF, and the default
--                          the app has written since 2026-08-21);
--   'To be developed'   → 'To be advised', with a reason saying so. It is NOT
--                          mapped to Available: the retired value means
--                          "unsettled" (UNSETTLED_MATERIAL_TYPES), and mapping it
--                          to Available would silently open the PO gate on a
--                          material nobody has settled;
--   any case / spacing  → the canonical spelling (AGENTS.md: the supply-type
--                          enums disagreed on case, and a CHECK is the end of
--                          that for this column).
--
-- THE ORDER LOCK (0576) IS SUSPENDED AROUND THE NORMALISATION ONLY. A line of an
-- approved RE carrying a blank type could not otherwise be normalised — changing
-- `type` on an Available line is exactly what the lock refuses. The UPDATE
-- changes nothing but the spelling of the state the line is already in (or, for
-- 'To be developed', states the same unsettledness in the current word), so the
-- margin the lock protects cannot move.
--
--
-- (b) THE NEW FACTS OF AN ADVISED LINE
--
-- estimated_rate  what the budget prices the line at before the buyer confirms
--                 (any line; the Budget pull pre-fills its rate from it, the way
--                 a Fabric BOM line's rate already does). Non-negative.
-- brand, artwork_code
--                 what the buyer confirms, beside `specification`,
--                 `item_color_id` and `size` which the line already has.
-- pending_reason  WHY it is still advised — MANDATORY while it is
--                 (`chk_mbai_advised_reason`); a TBA line nobody can explain is
--                 a line nobody will chase.
-- converted_at, converted_by
--                 when and by whom TBA became Available. ONE WRITER — the
--                 trigger in (c); never trusted from a payload on an UPDATE.
--
--
-- (c) THE STAMPS — `stamp_advised_conversion()`, BEFORE INSERT OR UPDATE
--
-- UPDATE: 'To be advised' → Available stamps now() and auth.uid(); anything →
-- 'To be advised' clears them; every other update KEEPS the stored stamps
-- whatever the payload says, so the pair cannot be forged or blanked by an
-- ordinary save.
-- INSERT: a TBA line carries no stamps. An Available line KEEPS the stamps it
-- is inserted with — because the Material BOM editor saves by deleting and
-- re-inserting every line, and a converted line's history would otherwise be
-- wiped by the next save. That is the one place a stamp comes from a payload,
-- and it can only ever restate a conversion, never create one on a TBA line.
-- Invoker rights: `auth.uid()` is the session's own, and nothing here reads
-- past RLS.
--
--
-- (d) CONVERSION THROUGH THE LOCK — `refuse_when_order_locked()` widened
--
-- User, 2026-09-19: on an approved RE the lock stays on quantity, item and rate,
-- but an ADVISED line may still be converted — `type` → Available, `brand`,
-- `artwork_code`, `specification`, `item_color_id`, `size`, `pending_reason` and
-- the stamps. Only a line that WAS advised (OLD.type) gets this; an Available
-- line of a locked RE stays fully locked. The body is 0576's EXACTLY, with that
-- one case added; `order_lock_row_order` (0577) is untouched. The field is read
-- as `to_jsonb(OLD) ->> 'type'`, never `OLD.type`, because this function fires
-- on 47 tables and only this one has the column.
--
--
-- (e) THE PO BLOCK IN THE DATABASE — `refuse_advised_po_line()` on po_line_items
--
-- `refuseUnsettledMaterials` (lib/purchase/bom-ceiling-service.ts) refuses a PO
-- line whose material is unsettled on its order's latest non-draft Material BOM
-- — in TypeScript, at four write paths, and `approvePo` did not re-check. This
-- is the same rule, the same way to reach the BOM (sales_order_id → the garment
-- order documents raised against it → their newest non-draft Material BOM by
-- amendment_no) and the same sentence, as the guard every path passes through.
-- On UPDATE it asks only when the line is re-pointed (item, order) or its
-- QUANTITY changes — a GRN writing `received_qty` against an old line must not
-- be refused. The work-order half (`refuseAdvisedIwoItems`, 0586) stays in
-- TypeScript. SECURITY DEFINER: the buyer's session need not read the order's
-- BOM tables for the rule to hold.
--
--
-- THE SENTENCE IS `advisedItemMessage()`'s (lib/purchase/bom-ceiling-service.ts)
-- word for word — it names the material and the RE No and points at the one
-- place a conversion happens, the Advised Items Register.
--
--
-- (f) `order_advised_items` IS DROPPED — refused if it holds a single row.
--
--
-- (g) CONVERSION HAS ONE DOOR — the Register (`convertAdvisedItem`)
--
-- The Material BOM editor saves by DELETING AND RE-INSERTING every line
-- (lib/orders/material-bom-amendment/actions.ts). A TBA switch flipped off
-- there would reach the database as a DELETE of the advised line and an
-- INSERT of an Available one — the BEFORE UPDATE stamp in (c) never fires, the
-- conversion is unstamped, and the audit below never sees it. So the editor's
-- save REFUSES turning a saved advised material Available (in TypeScript, where
-- the before-and-after of a wholesale rewrite can be compared), and the
-- Register's single UPDATE is the only way through — which is the spec's own
-- Step 4.
--
--
-- (h) AUDIT — `audit_record_change()` (0041), AFTER UPDATE ONLY
--
-- The other tables carry it AFTER INSERT/UPDATE/DELETE. This one cannot,
-- usefully: the editor's save deletes and re-inserts every line, so a full-row
-- audit would log each line TWICE per save (a DELETE and an INSERT of an
-- identical row) and split one line's history across a new id every time. The
-- UPDATEs are the edits that are real — the conversion above, and any targeted
-- change — and each is logged once, old → new, against a stable id.
-- ============================================================================


-- ---------- (a) `type`, normalised then constrained -------------------------

alter table public.material_bom_amendment_items
  add column if not exists pending_reason text;

alter table public.material_bom_amendment_items disable trigger trg_order_lock;

update public.material_bom_amendment_items
   set type = 'Available Item'
 where type is null
    or btrim(type) = ''
    or (lower(btrim(type)) = 'available item' and type <> 'Available Item');

update public.material_bom_amendment_items
   set type = 'To be advised'
 where lower(btrim(type)) = 'to be advised' and type <> 'To be advised';

update public.material_bom_amendment_items
   set type = 'To be advised',
       pending_reason = coalesce(nullif(btrim(pending_reason), ''),
                                 'Carried over from the retired "To be developed" type')
 where lower(btrim(type)) = 'to be developed';

-- A TBA line with no reason would violate (b)'s CHECK the moment it is added.
update public.material_bom_amendment_items
   set pending_reason = 'Reason not recorded before 0588'
 where type = 'To be advised'
   and btrim(coalesce(pending_reason, '')) = '';

alter table public.material_bom_amendment_items enable trigger trg_order_lock;

alter table public.material_bom_amendment_items
  alter column type set default 'Available Item';
alter table public.material_bom_amendment_items
  alter column type set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_mbai_type') then
    alter table public.material_bom_amendment_items
      add constraint chk_mbai_type check (type in ('Available Item', 'To be advised'));
  end if;
end
$$;


-- ---------- (b) The new facts ------------------------------------------------

alter table public.material_bom_amendment_items
  add column if not exists estimated_rate numeric(14,4),
  add column if not exists brand          text,
  add column if not exists artwork_code   text,
  add column if not exists converted_at   timestamptz,
  add column if not exists converted_by   uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_mbai_estimated_rate') then
    alter table public.material_bom_amendment_items
      add constraint chk_mbai_estimated_rate check (estimated_rate is null or estimated_rate >= 0);
  end if;
  -- `coalesce`, not a bare `btrim(pending_reason) <> ''`: btrim(NULL) is NULL,
  -- and a CHECK treats NULL as a PASS — the bare form would admit exactly the
  -- blank reason it exists to refuse.
  if not exists (select 1 from pg_constraint where conname = 'chk_mbai_advised_reason') then
    alter table public.material_bom_amendment_items
      add constraint chk_mbai_advised_reason
      check (type <> 'To be advised' or btrim(coalesce(pending_reason, '')) <> '');
  end if;
end
$$;

comment on column public.material_bom_amendment_items.type is
  'Available Item | To be advised (0588 CHECK; the TBA toggle). An advised line '
  'cannot be purchased (refuse_advised_po_line) and may be converted through an '
  'approved RE''s lock (refuse_when_order_locked, 0588).';
comment on column public.material_bom_amendment_items.estimated_rate is
  'The budget''s rate for this material before it is confirmed; the Budget pull '
  'pre-fills the material line''s rate from it. 0588.';
comment on column public.material_bom_amendment_items.pending_reason is
  'Why this material is still To be advised — mandatory while it is '
  '(chk_mbai_advised_reason). 0588.';
comment on column public.material_bom_amendment_items.converted_at is
  'When To be advised became Available Item. Written only by '
  'stamp_advised_conversion(). 0588.';
comment on column public.material_bom_amendment_items.converted_by is
  'Who converted it (auth.uid()). Written only by stamp_advised_conversion(). 0588.';


-- ---------- (c) The stamps ---------------------------------------------------

create or replace function public.stamp_advised_conversion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.type = 'To be advised' then
      NEW.converted_at := null;
      NEW.converted_by := null;
    end if;
    return NEW;
  end if;

  if OLD.type = 'To be advised' and NEW.type = 'Available Item' then
    NEW.converted_at := now();
    NEW.converted_by := auth.uid();
  elsif NEW.type = 'To be advised' then
    NEW.converted_at := null;
    NEW.converted_by := null;
  else
    -- ONE WRITER: an ordinary update keeps the stored stamps, whatever it sent.
    NEW.converted_at := OLD.converted_at;
    NEW.converted_by := OLD.converted_by;
  end if;
  return NEW;
end;
$$;

-- Named to fire BEFORE `trg_order_lock` (BEFORE triggers run in name order), so
-- the lock judges the row as it will be stored — stamps included, which the
-- widened allowlist admits.
drop trigger if exists trg_mbai_advised_stamp on public.material_bom_amendment_items;
create trigger trg_mbai_advised_stamp
  before insert or update on public.material_bom_amendment_items
  for each row execute function public.stamp_advised_conversion();


-- ---------- (d) The lock, widened for conversion -----------------------------

create or replace function public.refuse_when_order_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- (4) of 0576: bookkeeping that must pass the lock.
  v_allow text[] := array[
    're_status', 're_status_at', 'approval_status', 'approved_by',
    'approved_at', 'approval_reason', 'updated_at'
  ];
  v_rows jsonb[];
  v_row  jsonb;
  v_msg  text;
begin
  if TG_OP = 'UPDATE' then
    -- 0588: CONVERSION THROUGH THE LOCK. An ADVISED Material BOM line (OLD, so
    -- only a line that WAS advised) may still take its confirmed specification
    -- and become Available; quantity, item and rate stay locked. Read through
    -- jsonb because this function fires on 47 tables and only this one has
    -- `type`.
    if TG_TABLE_NAME = 'material_bom_amendment_items'
       and (to_jsonb(OLD) ->> 'type') = 'To be advised' then
      v_allow := v_allow || array[
        'type', 'brand', 'artwork_code', 'specification', 'item_color_id',
        'size', 'pending_reason', 'converted_at', 'converted_by'
      ];
    end if;
    if (to_jsonb(NEW) - v_allow) = (to_jsonb(OLD) - v_allow) then
      return NEW;
    end if;
    v_rows := array[to_jsonb(OLD), to_jsonb(NEW)];
  elsif TG_OP = 'INSERT' then
    v_rows := array[to_jsonb(NEW)];
  else
    v_rows := array[to_jsonb(OLD)];
  end if;
  foreach v_row in array v_rows loop
    if TG_TABLE_NAME = 'garment_order_amendments' then
      v_msg := public.order_lock_message((v_row ->> 'id')::uuid, (v_row ->> 'sales_order_id')::uuid);
    else
      v_msg := public.order_lock_message(public.order_lock_row_order(v_row, TG_ARGV));
    end if;
    if v_msg is not null then
      raise exception using message = v_msg, errcode = 'P0001', hint = 'order_locked';
    end if;
  end loop;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;


-- ---------- (e) The PO block ---------------------------------------------------

create or replace function public.refuse_advised_po_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bom  uuid;
  v_name text;
  v_re   text;
begin
  -- A line naming no order or no material is general stock buying: not checked,
  -- exactly as `refuseUnsettledMaterials` skips it.
  if NEW.sales_order_id is null or NEW.item_id is null then
    return NEW;
  end if;
  -- UPDATE: only a re-point or a new quantity is a new purchase decision.
  if TG_OP = 'UPDATE'
     and NEW.item_id is not distinct from OLD.item_id
     and NEW.sales_order_id is not distinct from OLD.sales_order_id
     and NEW.quantity is not distinct from OLD.quantity then
    return NEW;
  end if;

  -- The order's newest NON-DRAFT Material BOM across every document raised
  -- against the sales order — `recordedBomForOrder`'s rule. No BOM: buying ahead
  -- of the plan is ordinary work, and is not refused.
  select m.id
    into v_bom
    from public.material_bom_amendments m
    join public.garment_order_amendments a on a.id = m.garment_order_id
   where a.sales_order_id = NEW.sales_order_id
     and m.is_draft = false
   order by m.amendment_no desc
   limit 1;
  if v_bom is null then
    return NEW;
  end if;

  select coalesce(nullif(btrim(it.name), ''), 'A material')
    into v_name
    from public.material_bom_amendment_items i
    left join public.items it on it.id = i.item_id
   where i.amendment_id = v_bom
     and i.item_id = NEW.item_id
     -- 'To be developed' cannot exist after (a)'s normalisation and chk_mbai_type.
     and i.type = 'To be advised'
   limit 1;
  if v_name is null then
    return NEW;
  end if;

  select o.order_number into v_re from public.sales_orders o where o.id = NEW.sales_order_id;

  -- `advisedItemMessage()`'s sentence, word for word (U+2014 dash, U+25B8 ▸).
  raise exception using
    message = v_name
      || ' is To be advised '
      || case when nullif(btrim(v_re), '') is not null then 'on RE ' || btrim(v_re) else 'on this order' end
      || ' — convert it on Orders ▸ Order Execution ▸ Advised Items once the buyer confirms.',
    errcode = 'P0001',
    hint = 'advised_material';
end;
$$;

drop trigger if exists trg_poli_advised on public.po_line_items;
create trigger trg_poli_advised
  before insert or update on public.po_line_items
  for each row execute function public.refuse_advised_po_line();


-- ---------- (h) Audit — AFTER UPDATE only (see the header) -------------------

drop trigger if exists trg_audit_material_bom_amendment_items on public.material_bom_amendment_items;
create trigger trg_audit_material_bom_amendment_items
  after update on public.material_bom_amendment_items
  for each row execute function public.audit_record_change();


-- ---------- (i) The Register's count, for the hub card -----------------------
--
-- `hub_record_counts()` counts a whole table or view, never a filter, so the
-- Advised Items card counts THIS. `security_invoker = true`, so it is read with
-- the reader's own rights and the base table's RLS still applies — a view that
-- ran as its owner would be a way round it.

create or replace view public.advised_pending_lines
  with (security_invoker = true) as
  select i.id
    from public.material_bom_amendment_items i
   where i.type = 'To be advised';

comment on view public.advised_pending_lines is
  'Material BOM lines still To be advised — the Advised Items hub count. '
  'security_invoker: the base table''s RLS applies to the reader. 0588.';

-- STATED, not left to default privileges: `hub_record_counts()` silently SKIPS
-- a relation the caller cannot select, so a missing grant is a card with no
-- number and no error. No logged-out surface exists, so anon gets nothing.
revoke all on public.advised_pending_lines from public, anon;
grant select on public.advised_pending_lines to authenticated;


-- ---------- (f) The orphan ------------------------------------------------------

do $$
begin
  if to_regclass('public.order_advised_items') is not null then
    if exists (select 1 from public.order_advised_items) then
      raise exception '0588: order_advised_items holds rows — migrate them onto Material BOM lines before dropping it';
    end if;
    drop table public.order_advised_items;
  end if;
end
$$;


-- ---------- Grants (AGENTS.md "Function grants") -------------------------------

revoke all on function public.stamp_advised_conversion() from public, anon, authenticated;
revoke all on function public.refuse_advised_po_line()   from public, anon, authenticated;
revoke all on function public.refuse_when_order_locked() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- Read the result back — and TEST THE BEHAVIOUR, rolled back.
--
-- 0576 asserted its triggers EXISTED and every one of them was a no-op (0577).
-- So this block does not stop at the catalog: on a real Material BOM line of a
-- real order it marks the line advised, approves a throwaway budget, and asserts
-- that a quantity edit is REFUSED, a conversion PASSES and is stamped, and a PO
-- line for the material is REFUSED while advised and not refused after. All of
-- it inside a sub-block that raises a sentinel, so nothing survives. Skipped
-- cleanly on a database with no such line.
-- ----------------------------------------------------------------------------

do $verify$
declare
  v_line   uuid;
  v_item   uuid;
  v_go     uuid;
  v_so     uuid;
  v_loc    uuid;
  v_b      uuid;
  v_stamp  timestamptz;
  r_qty    text := 'not run';
  r_conv   text := 'not run';
  r_stamp  text := 'not run';
  r_po_tba text := 'not run';
  r_po_ok  text := 'not run';
  r_audit  text := 'not run';
begin
  -- the catalog
  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'material_bom_amendment_items'
     and column_name = 'type' and is_nullable = 'NO' and column_default like '''Available Item''%';
  if not found then
    raise exception '0588: material_bom_amendment_items.type is nullable or not defaulted to Available Item';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_mbai_type')
     or not exists (select 1 from pg_constraint where conname = 'chk_mbai_advised_reason')
     or not exists (select 1 from pg_constraint where conname = 'chk_mbai_estimated_rate') then
    raise exception '0588: a CHECK on material_bom_amendment_items is missing';
  end if;
  if exists (select 1 from public.material_bom_amendment_items where type not in ('Available Item', 'To be advised')) then
    raise exception '0588: a line still carries a type outside the two values';
  end if;
  if to_regclass('public.order_advised_items') is not null then
    raise exception '0588: order_advised_items was not dropped';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_poli_advised' and tgrelid = 'public.po_line_items'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_mbai_advised_stamp' and tgrelid = 'public.material_bom_amendment_items'::regclass
                      and tgenabled <> 'D')
     or not exists (select 1 from pg_trigger where tgname = 'trg_order_lock' and tgrelid = 'public.material_bom_amendment_items'::regclass
                      and tgenabled <> 'D') then
    raise exception '0588: a trigger is missing or left disabled (the normalisation re-enables trg_order_lock)';
  end if;
  -- the hub view keeps the base table's RLS (security_invoker)
  if not exists (
    select 1 from pg_class c
     where c.oid = to_regclass('public.advised_pending_lines')
       and c.relkind = 'v'
       and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))
  ) then
    raise exception '0588: advised_pending_lines is missing or not security_invoker';
  end if;
  if not has_table_privilege('authenticated', 'public.advised_pending_lines', 'select') then
    raise exception '0588: authenticated cannot select advised_pending_lines — the hub card would silently show no count';
  end if;
  if has_table_privilege('anon', 'public.advised_pending_lines', 'select') then
    raise exception '0588: anon can select advised_pending_lines';
  end if;

  -- the audit is AFTER UPDATE and nothing else (header h)
  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'trg_audit_material_bom_amendment_items'
       and t.tgrelid = 'public.material_bom_amendment_items'::regclass
       and (t.tgtype & 16) <> 0          -- UPDATE
       and (t.tgtype & 4) = 0            -- not INSERT
       and (t.tgtype & 8) = 0            -- not DELETE
       and (t.tgtype & 2) = 0            -- AFTER, not BEFORE
  ) then
    raise exception '0588: the audit trigger on material_bom_amendment_items is missing or not AFTER UPDATE only';
  end if;
  if exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('stamp_advised_conversion', 'refuse_advised_po_line', 'refuse_when_order_locked')
       and (p.proacl is null
            or exists (select 1 from unnest(p.proacl) a where a::text like '=%' or a::text like 'anon=%'))
  ) then
    raise exception '0588: a function is executable by PUBLIC or anon';
  end if;

  -- the behaviour, on a real line of a real OPEN order
  select i.id, i.item_id, m.garment_order_id, a.sales_order_id
    into v_line, v_item, v_go, v_so
    from public.material_bom_amendment_items i
    join public.material_bom_amendments m on m.id = i.amendment_id
    join public.garment_order_amendments a on a.id = m.garment_order_id
   where m.is_draft = false
     and i.item_id is not null
     and a.sales_order_id is not null
     and a.re_status = 'open'
     -- it must be THE BOM the PO rule reads: the newest non-draft one of its RE
     and m.id = (
       select m2.id from public.material_bom_amendments m2
         join public.garment_order_amendments a2 on a2.id = m2.garment_order_id
        where a2.sales_order_id = a.sales_order_id and m2.is_draft = false
        order by m2.amendment_no desc limit 1)
     and not exists (
       select 1 from public.garment_order_amendments s
        where s.sales_order_id = a.sales_order_id and s.re_status = 'approved')
   limit 1;
  select id into v_loc from public.locations limit 1;
  if v_line is null or v_loc is null then
    return;
  end if;

  begin
    update public.material_bom_amendment_items
       set type = 'To be advised', pending_reason = '0588 verify'
     where id = v_line;

    -- a PO line for the advised material is refused (the purchase_order_id is
    -- a throwaway: the BEFORE trigger runs before any FK is checked)
    begin
      insert into public.po_line_items (purchase_order_id, item_id, quantity, sales_order_id)
      values (gen_random_uuid(), v_item, 1, v_so);
      r_po_tba := 'NOT refused';
    exception when others then
      r_po_tba := case when sqlerrm like '%is To be advised on%Advised Items once the buyer confirms.' then 'refused' else 'wrong error: ' || sqlerrm end;
    end;

    insert into public.order_budgets (budget_date, status, location_id)
    values (current_date, 'draft', v_loc) returning id into v_b;
    insert into public.order_budget_orders (budget_id, garment_order_id, sales_refusal)
    values (v_b, v_go, '0588 verify');
    update public.order_budgets
       set status = 'approved', decided_at = now(), decided_by = gen_random_uuid()
     where id = v_b;

    -- a quantity edit on the advised line of the now-locked RE is refused
    begin
      update public.material_bom_amendment_items
         set no_of_items = coalesce(no_of_items, 0) + 1
       where id = v_line;
      r_qty := 'NOT refused';
    exception when others then
      r_qty := case when sqlerrm like '%is locked%' then 'refused' else 'wrong error: ' || sqlerrm end;
    end;

    -- the conversion passes through the lock, and is stamped
    begin
      update public.material_bom_amendment_items
         set type = 'Available Item', brand = '0588 VERIFY', specification = '0588 VERIFY'
       where id = v_line;
      r_conv := 'passed';
    exception when others then
      r_conv := 'refused: ' || sqlerrm;
    end;
    select converted_at into v_stamp from public.material_bom_amendment_items where id = v_line;
    r_stamp := case when v_stamp is not null then 'stamped' else 'NOT stamped' end;

    -- the conversion is AUDITED, old → new on the type
    r_audit := case when exists (
      select 1 from public.record_audit ra
       where ra.table_name = 'material_bom_amendment_items'
         and ra.record_id = v_line
         and ra.operation = 'UPDATE'
         and ra.old_data ->> 'type' = 'To be advised'
         and ra.new_data ->> 'type' = 'Available Item'
         and 'type' = any (ra.changed_fields)
    ) then 'audited' else 'NOT audited' end;

    -- once Available, the PO rule no longer refuses (the FK then fails instead)
    begin
      insert into public.po_line_items (purchase_order_id, item_id, quantity, sales_order_id)
      values (gen_random_uuid(), v_item, 1, v_so);
      r_po_ok := 'not refused';
    exception when others then
      r_po_ok := case when sqlerrm like '%is To be advised on%' then 'STILL refused' else 'not refused' end;
    end;

    raise exception '0588_ROLLBACK';
  exception when others then
    if sqlerrm <> '0588_ROLLBACK' then
      raise;
    end if;
  end;

  if r_po_tba <> 'refused' then
    raise exception '0588: a PO line for an advised material was %', r_po_tba;
  end if;
  if r_qty <> 'refused' then
    raise exception '0588: a quantity edit on an advised line of an approved RE was %', r_qty;
  end if;
  if r_conv <> 'passed' then
    raise exception '0588: converting an advised line of an approved RE was %', r_conv;
  end if;
  if r_stamp <> 'stamped' then
    raise exception '0588: the conversion was % (converted_at)', r_stamp;
  end if;
  if r_audit <> 'audited' then
    raise exception '0588: the conversion was % (record_audit)', r_audit;
  end if;
  if r_po_ok <> 'not refused' then
    raise exception '0588: a PO line for a CONVERTED material was %', r_po_ok;
  end if;
end $verify$;
