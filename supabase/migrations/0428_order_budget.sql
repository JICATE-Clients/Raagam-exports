-- ============================================================================
-- Raagam ERP — 0428 Order Budget, and its approval
--
-- Steps 7 and 8 of the client's order flow. `doc/prd.md`, in the client's own
-- words:
--
--   "BOM required no approval. After BOM, budgeting is done using Fabric BOM and
--    Material BOM of various orders which are grouped together. This budget is
--    approved. After approval it should downstream to purchase module."
--
-- Three facts in one sentence, and each shapes a table below:
--
--   1. A BUDGET COVERS MANY ORDERS — `order_budget_orders`. This is where
--      doc/orders-six-step.md §3 is superseded: it sketched
--      `order_budgets.sales_order_id`, one order per budget. The legacy schema
--      agrees with the client, not the sketch — `budgets` (0369) carries
--      `group_no` and `group_description`.
--   2. ITS COSTS COME FROM THE TWO BOMs — `order_budget_lines.source`, with
--      'fabric' and 'material' PULLED rather than typed.
--   3. IT IS THE THING THAT GETS APPROVED — and the BOMs are not, which is why
--      neither 0426 nor 0427 carries a status column.
--
--
-- A SEPARATE STEP IS NOT A SECOND DOCUMENT
--
-- Budgeting (7) and Approval (8) are two steps because the client counts them as
-- two. They are ONE table. Approval is a transition on `order_budgets.status`,
-- and step 8 is a SCREEN — a queue of submitted budgets — not a second record.
-- doc/orders-six-step.md argues this at length and it is unchanged by the
-- 08-17 revision that un-collapsed the two steps: two records would let the
-- approved figures drift from the budget they approved.
--
--
-- THE STATUSES ARE A LINE, NOT A SET
--
--     draft -> submitted -> approved
--                        -> rejected -> draft
--
-- `draft` is the operator's, `submitted` is the queue's, and the last two are the
-- approver's. A rejected budget goes back to draft to be reworked — there is no
-- 'reopened' state, because it would be a draft under another name and the queue
-- would then have two words for "not with the approver".
--
--
-- WHO MAY APPROVE: THE `approve` PERMISSION, USED HERE FIRST
--
-- `lib/auth/types.ts` has declared an `approve` action since 0001 and NOTHING
-- HAS EVER USED IT — every existing workflow gates on `edit`. That is exactly
-- what makes it right here and wrong to keep borrowing: a merchandiser who may
-- edit a budget is not thereby a person who may approve one, and gating approval
-- on `edit` grants it to everybody who can type in the document.
--
-- The RLS below therefore differs from every other table in this repo: the
-- UPDATE policy takes `orders:edit` OR `orders:approve`, because both kinds of
-- user write to this row — one edits the lines, the other sets the status. RLS
-- cannot express "may change only these columns", so the column-level rule lives
-- in the server action and this is the coarse gate underneath it. Saying so here
-- is the point: a reader who finds only the RLS would conclude an editor can
-- approve.
--
--
-- AN ORDER IN TWO APPROVED BUDGETS IS WRONG, AND IS NOT A CONSTRAINT
--
-- Two approved budgets covering one order means two cost ceilings downstream in
-- purchase, which is unambiguously wrong. It is still NOT a unique index, and the
-- reason is mechanical rather than a preference: the status lives on the PARENT
-- (`order_budgets`) and the order lives on the CHILD, so a partial unique index
-- on the child cannot see the condition that makes it wrong. The alternatives
-- are a denormalised status column on every child row or a trigger, and both are
-- a second place for the status to be true.
--
-- So the guard is in `approveBudget()` in lib/orders/budget/actions.ts, which
-- refuses and NAMES the other budget. Two DRAFT budgets over one order are fine
-- and deliberately allowed — that is someone comparing two groupings, which is
-- what a draft is for.
--
--
-- `amount` HAS NO COLUMN
--
-- It is `qty x rate`, derived by `lineAmount()` in lib/orders/budget/totals.ts.
-- A stored Amount beside a stored Qty and Rate is three numbers stating two
-- facts; they disagree the first time someone edits the rate and not the amount,
-- and the document then holds a total nobody can reproduce from its own lines. A
-- lump sum is entered as qty 1 — visibly, in the box.
--
-- The TOTALS have no columns either, for the same reason plus a sharper one: the
-- sales figure REFUSES when any grouped order cannot be valued, and a numeric
-- column cannot hold a refusal. Storing it would mean storing a partial sum,
-- which is the exact failure `order-value.ts` and `totals.ts` both exist to
-- prevent. `order_budget_orders.sales_value` IS stored — but that is a per-order
-- SNAPSHOT with a `sales_refusal` column beside it to carry the other answer.
-- ============================================================================


-- ---------- 1. The document -------------------------------------------------

create table if not exists public.order_budgets (
  id              uuid primary key default gen_random_uuid(),
  code            text,
  budget_date     date not null default current_date,
  description     text,

  status          text not null default 'draft'
    check (status in ('draft','submitted','approved','rejected')),
  submitted_at    timestamptz,
  submitted_by    uuid,
  decided_at      timestamptz,
  decided_by      uuid,
  decision_remark text,

  currency_code   text references public.currencies(code),
  exchange_rate   numeric(14,6) not null default 1
    check (exchange_rate > 0),

  remark          text,
  location_id     uuid references public.locations(id),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A decision carries both halves or neither. One without the other is a row
  -- that says it was approved by nobody, or at no time.
  constraint chk_ob_decision
    check ((decided_at is null) = (decided_by is null)),
  -- And a decided budget must actually be in a decided state. Without this, a
  -- rejected budget sent back to draft could keep the old approver's name on it.
  constraint chk_ob_decision_matches_status
    check ((status in ('approved','rejected')) = (decided_at is not null))
);

comment on table public.order_budgets is
  'Steps 7 and 8: the cost of a GROUP of garment orders, and the approval of it. Approval is a transition on `status`, never a second document — two records would let the approved figures drift from the budget they approved (0428).';
comment on column public.order_budgets.status is
  'draft -> submitted -> approved | rejected -> draft. There is no ''reopened'': it would be a draft under another name.';
comment on column public.order_budgets.decided_by is
  'Who approved or rejected. Gated on the `orders:approve` permission, which 0001 declared and nothing had used until 0428 — every other workflow here gates on `edit`, which grants approval to everyone who can type in the document.';
comment on column public.order_budgets.exchange_rate is
  'Strictly positive. A rate of 0 would zero every converted figure, and in a division it is Infinity rather than an error.';

create index if not exists idx_ob_status on public.order_budgets(status);
create index if not exists idx_ob_location on public.order_budgets(location_id);


-- ---------- 2. The orders it covers -----------------------------------------

create table if not exists public.order_budget_orders (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.order_budgets(id) on delete cascade,
  garment_order_id uuid not null
    references public.garment_order_amendments(id) on delete cascade,
  sno              int not null default 0,

  -- The order's value AS IT STOOD when the budget was saved, computed by
  -- `orderValue()` — the same function the Garment Order screen shows. Snapshot,
  -- not a live join: a budget that has been approved must keep meaning what it
  -- meant, and `orderValue` REFUSES rather than part-summing, which is what the
  -- column beside this one is for.
  sales_value      numeric(16,2),
  sales_refusal    text,
  created_at       timestamptz not null default now(),

  -- A row either carries a value or says why it has none.
  constraint chk_obo_value_or_reason
    check ((sales_value is null) <> (sales_refusal is null))
);

comment on column public.order_budget_orders.sales_refusal is
  'Why this order could not be valued — "two prices for one style", "no quantity". A budget can be built while a price is unconfirmed; what it must not do is add up the orders it CAN value and present that as the group''s sales figure (0428).';

create unique index if not exists uq_obo_order
  on public.order_budget_orders(budget_id, garment_order_id);
create index if not exists idx_obo_order on public.order_budget_orders(garment_order_id);


-- ---------- 3. The cost lines -----------------------------------------------

create table if not exists public.order_budget_lines (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.order_budgets(id) on delete cascade,
  sno              int not null default 0,

  source           text not null
    check (source in ('fabric','material','process','cmt','expense','income')),
  -- Which order this cost belongs to. NULL = the whole group, which is the right
  -- answer for a shared overhead and the wrong one for fabric.
  garment_order_id uuid references public.garment_order_amendments(id) on delete set null,
  item_id          uuid references public.items(id),
  description      text,

  qty              numeric(16,4),
  uom_id           uuid references public.uoms(id),
  rate             numeric(14,4) check (rate is null or rate >= 0),
  notes            text,
  created_at       timestamptz not null default now()
);

comment on table public.order_budget_lines is
  'One cost or income line. `amount` is DERIVED (qty x rate) and has no column — three numbers stating two facts disagree the first time one is edited without the other (0428).';
comment on column public.order_budget_lines.source is
  'fabric | material are PULLED from the two BOMs; process | cmt | expense | income are typed. A pulled line''s quantity is a stored requirement somebody else computed, so re-typing it would be a second answer to an answered question.';
comment on column public.order_budget_lines.rate is
  'NON-NEGATIVE. "Income as a negative expense" would subtract from the COST total, which is the figure a purchase ceiling is checked against — so it is refused and Other income is the way to say it. A rate of 0 IS allowed: a free-issue trim is a real line.';

create index if not exists idx_obl_budget on public.order_budget_lines(budget_id);
create index if not exists idx_obl_item on public.order_budget_lines(item_id);
create index if not exists idx_obl_order on public.order_budget_lines(garment_order_id);


-- ---------- 4. RLS ----------------------------------------------------------
--
-- READ and INSERT and DELETE are the module's usual three. UPDATE is the one
-- that differs, and the header explains why: both an editor and an approver
-- write to `order_budgets`, and RLS cannot say "only these columns". The
-- column-level rule is in the server action; this is the gate underneath it.

do $rls$
declare
  t text;
begin
  foreach t in array array['order_budget_orders', 'order_budget_lines'] loop
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t
    ) then
      execute format($f$
        create policy %1$s_read on public.%1$s
          for select to authenticated using (public.has_permission('orders','view'));
        create policy %1$s_insert on public.%1$s
          for insert to authenticated with check (public.has_permission('orders','create'));
        create policy %1$s_update on public.%1$s
          for update to authenticated using (public.has_permission('orders','edit'))
          with check (public.has_permission('orders','edit'));
        create policy %1$s_delete on public.%1$s
          for delete to authenticated using (public.has_permission('orders','delete'));
      $f$, t);
    end if;
    execute format('alter table public.%I enable row level security', t);
  end loop;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'order_budgets'
  ) then
    create policy order_budgets_read on public.order_budgets
      for select to authenticated using (public.has_permission('orders','view'));
    create policy order_budgets_insert on public.order_budgets
      for insert to authenticated with check (public.has_permission('orders','create'));
    -- BOTH, deliberately. See the header.
    create policy order_budgets_update on public.order_budgets
      for update to authenticated
      using (public.has_permission('orders','edit') or public.has_permission('orders','approve'))
      with check (public.has_permission('orders','edit') or public.has_permission('orders','approve'));
    create policy order_budgets_delete on public.order_budgets
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

alter table public.order_budgets enable row level security;


-- ---------- 5. The `approve` permission has to EXIST to be granted ----------
--
-- `has_permission('orders','approve')` joins `public.permissions`, so a policy
-- naming an action with no row there is not an error — it simply matches nobody,
-- forever, and the Approve button is dead for every user including the one the
-- client meant to give it to. That is the silent-failure shape this repo keeps
-- recording, so the row is seeded here rather than assumed.
--
-- SEEDED, NOT GRANTED. No role gets it: who may approve a budget is the client's
-- decision, made on the Roles screen. A migration that handed it to an existing
-- role would be answering a question nobody asked.

insert into public.permissions (module, action)
values ('orders', 'approve')
on conflict do nothing;


-- ============================================================================
-- Read the result back out of the catalog.
--
--   -- three tables, RLS on (expect 3 rows, all true)
--   select relname, relrowsecurity from pg_class
--    where relname like 'order_budget%' and relnamespace = 'public'::regnamespace;
--
--   -- the UPDATE policy really does name `approve` (expect 1)
--   select count(*) from pg_policies
--    where tablename = 'order_budgets' and policyname = 'order_budgets_update'
--      and qual like '%approve%';
--
--   -- the permission row exists, or the Approve button is dead for everyone
--   select count(*) from public.permissions
--    where module = 'orders' and action = 'approve';   -- expect 1
--
--   -- and NOBODY has been granted it by this migration (expect 0)
--   select count(*) from public.role_permissions rp
--     join public.permissions p on p.id = rp.permission_id
--    where p.module = 'orders' and p.action = 'approve';
--
-- No new function, so the `revoke … from public, anon` idiom has nothing to
-- apply to here.
-- ============================================================================
