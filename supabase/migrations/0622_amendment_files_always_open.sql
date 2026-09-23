-- 0622 — An order's attached files are writable under EVERY open amendment
-- (user, 2026-09-23, screenshot 3026: "file field only allowing 1 file only
-- why?").
--
-- ## THE REPORT 0604 WAS WAITING FOR
--
-- HO/RE/26-27/0001 is `amending` under AMD/26-27/0002 — Combo / Color Change +
-- Quantity Addition. The merchandiser tried to attach the revised sketch to a
-- style and the Files cell was locked; had the screen let it through, the
-- trigger would have refused it:
--
--   This amendment (AMD/26-27/0002) is a Combo / Color Change + Quantity
--   Addition — Attachments is not open to it.
--
-- That is 0604's own enumeration doing what it said (§3, ATTACHMENTS: "closed
-- here too rather than opened by a guess. The first client report of 'I cannot
-- attach the revised sketch' is what should open it, on its own evidence").
-- This is the report. A document DOCUMENTS the order; it does not move the
-- margin the approval lock protects, and a combo change is exactly when a new
-- sketch arrives.
--
-- ## WHY IT IS NOT A SEED ROW
--
-- The obvious edit — add the files table to all nine categories in
-- `order_amendment_scopes` — does NOT fix the order in the report. A scope is
-- FROZEN on the entry when it is raised (`order_budget_revisions.scope`, the
-- union `order_amendment_record` stores), and 0604 made that deliberate so a
-- seed edit cannot widen an entry already in flight. AMD/26-27/0002 would stay
-- shut until it was abandoned and raised again.
--
-- So the files table is laid over the frozen scope at READ time, in the one
-- function every reader goes through: `order_amendment_of()` — the trigger's
-- (`refuse_when_order_locked`), and the app's (`order_amendment_scope_of`,
-- `lib/orders/budget/lock.ts`). The literal is one function,
-- `order_amendment_always_open()`, and its TypeScript twin is
-- `ALWAYS_OPEN_WHILE_AMENDING` in `lib/orders/amendments/amendment-entry.ts`,
-- merged by `scopeFromJson` for the readers that select the stored column
-- directly (`lib/orders/order-locks.ts`). `check:amendment-scope` parses this
-- file and fails the build if the two disagree.
--
-- `jsonb ||` with the constant on the RIGHT: the always-open verdict wins over
-- anything a stored scope says about the same table, so no entry can be frozen
-- narrower than this.
--
-- ## WHAT STAYS EXACTLY AS IT WAS
--
--   * An APPROVED order with no open entry — `order_lock_message` refuses before
--     any scope is read. Nothing here runs outside `re_status = 'amending'`.
--   * The seed. `order_amendment_scopes` is untouched and the files table is
--     still in 0604's closed-to-every-TYPE list; what changed is what an ENTRY
--     reads, not what a category opens. 0604's verification is therefore still
--     true, and 0621's assertion that no scope row names this table still holds.
--   * Every other table. Only `garment_order_amendment_files`, whole (insert,
--     delete, every column — `is_primary` and `print_on_report` from 0621
--     included), because the Order Entry save rewrites that grid wholesale.

create or replace function public.order_amendment_always_open()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"garment_order_amendment_files": {"columns": null, "insert": true, "delete": true}}'::jsonb;
$$;

comment on function public.order_amendment_always_open() is
  'Tables writable under EVERY open Amendment Entry whatever its categories, laid over the frozen scope by order_amendment_of (0622). Mirrored by ALWAYS_OPEN_WHILE_AMENDING in lib/orders/amendments/amendment-entry.ts; check:amendment-scope holds them together.';

-- AGENTS.md "Function grants": both grants, one statement.
revoke all on function public.order_amendment_always_open() from public, anon;
grant execute on function public.order_amendment_always_open() to authenticated, service_role;

-- Same body as 0616's, with the scope merged. `create or replace` keeps the
-- existing ACL (authenticated + service_role, no anon).
create or replace function public.order_amendment_of(p_order uuid, p_sales_order uuid default null)
returns table (
  amending_order_id uuid,
  entry_id          uuid,
  entry_no          text,
  amendment_type    text,
  amendment_types   text[],
  scope             jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select coalesce(
      p_sales_order,
      (select a.sales_order_id from public.garment_order_amendments a where a.id = p_order)
    ) as so
  )
  select a.id, r.id, r.entry_no, r.amendment_type, r.amendment_types,
         coalesce(r.scope, '{}'::jsonb) || public.order_amendment_always_open()
    from public.garment_order_amendments a
    cross join me
    join public.order_budget_revisions r on r.id = a.re_amendment_id
   where a.re_status = 'amending'
     and (a.id = p_order or (me.so is not null and a.sales_order_id = me.so))
   order by (a.id = p_order) desc
   limit 1;
$$;


-- ---------- verification ----------

do $verify$
declare
  v_order   uuid;
  v_entry   text;
  v_scope   jsonb;
  v_ok      boolean := false;
  v_locked  uuid;
  v_refused boolean := false;
begin
  -- No anon door on either function.
  if exists (select 1 from pg_proc
              where oid in ('public.order_amendment_always_open()'::regprocedure,
                            'public.order_amendment_of(uuid,uuid)'::regprocedure)
                and (proacl is null or proacl::text like '%anon=%' or proacl::text ~ '(^|[{,])=X/')) then
    raise exception '0622: order_amendment_always_open / order_amendment_of is executable by anon or PUBLIC';
  end if;

  -- The seed is untouched: no category row names the files table.
  if exists (select 1 from public.order_amendment_scopes
              where table_name::text = 'garment_order_amendment_files') then
    raise exception '0622: a seed row opens the files table — this migration opens it at read time, not in the seed';
  end if;

  -- Every amending order's scope now carries the files table whole.
  if exists (select 1 from public.garment_order_amendments a
              cross join lateral public.order_amendment_of(a.id, null) m
              where a.re_status = 'amending'
                and (m.scope -> 'garment_order_amendment_files') is distinct from
                    '{"columns": null, "insert": true, "delete": true}'::jsonb) then
    raise exception '0622: an amending order''s scope does not open the files table whole';
  end if;

  -- THE REPORT: an insert under an amending order with a NON-file scope is
  -- admitted. Made to FAIL first (before this migration it was refused with
  -- "Attachments is not open to it").
  select a.id into v_order
    from public.garment_order_amendments a
   where a.re_status = 'amending'
   limit 1;
  if v_order is null then
    raise notice '0622: no amending order to probe with — asserted structurally only';
  else
    insert into public.garment_order_amendment_files
      (amendment_id, sno, storage_path, mime_type, is_primary, print_on_report)
    values (v_order, 9701, '__0622_probe/a.jpg', 'image/jpeg', false, true);
    update public.garment_order_amendment_files set print_on_report = false
     where amendment_id = v_order and storage_path = '__0622_probe/a.jpg';
    delete from public.garment_order_amendment_files
     where amendment_id = v_order and storage_path = '__0622_probe/a.jpg';
  end if;

  -- …and a sibling table the entry does not open is STILL refused under it:
  -- the merge opened one table, not the order.
  if v_order is not null then
    begin
      -- BEFORE trigger, so the refusal lands ahead of any NOT NULL check.
      insert into public.garment_order_amendment_pack_types (amendment_id, sno)
      values (v_order, 9702);
    exception when raise_exception then
      v_refused := true;
    end;
    if not v_refused then
      raise exception '0622: a pack type was admitted under an amendment that does not open it — the merge widened more than the files table';
    end if;
  end if;

  -- An APPROVED order with no open entry is still refused.
  select l.locked_order_id into v_locked
    from public.garment_order_amendments a
    cross join lateral public.order_lock_of(a.id, null) l
   limit 1;
  if v_locked is null then
    raise notice '0622: no approved-and-locked order to probe with — the lock is asserted by 0576';
  else
    v_refused := false;
    begin
      insert into public.garment_order_amendment_files (amendment_id, sno, storage_path, mime_type)
      values (v_locked, 9703, '__0622_probe/b.jpg', 'image/jpeg');
    exception when raise_exception then
      v_refused := true;
    end;
    if not v_refused then
      delete from public.garment_order_amendment_files where storage_path like '__0622_probe/%';
      raise exception '0622: a file was admitted on an APPROVED order with no open amendment';
    end if;
  end if;

  raise notice '0622 verified: files open whole under every amending order, seed untouched, other tables still scoped, approved orders still locked';
end $verify$;
