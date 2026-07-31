-- ============================================================================
-- Raagam ERP — 0371 Party publishing ("Also …" tick boxes)
--
-- Legacy RP-Software lets one party be several things at once: an applicant that
-- is also a customer, a customer that is also a consignee, a consignee that is
-- also a notify party. Our masters already carry every one of those tick boxes
-- and NONE of them did anything — the flag was stored, echoed as a chip and then
-- ignored. A record ticked "Also Customer" never appeared in the Customer child.
--
-- Ticking now publishes a REAL, LINKED row into the target master, seeded from
-- the source and badged with its origin. These columns are that link.
--
--   customers   .source_applicant_id   ← Applicant ▸ Also Customer
--   consignees  .source_applicant_id   ← Applicant ▸ Also Consignee
--   consignees  .source_customer_id    ← Customer  ▸ Also Consignee
--   notifies    .source_customer_id    ← Customer  ▸ Also Notify
--   notifies    .source_consignee_id   ← Consignee ▸ Also Notify
--
-- ON DELETE SET NULL, deliberately NOT CASCADE. If someone deletes the
-- applicant, the customer it published must survive — it may already be on a
-- sales order. It simply becomes an ordinary customer and loses its origin
-- badge. (The app unlinks published rows before deleting a source anyway, so
-- `first_referencing_table` (0344) does not see this link and mistake it for
-- "in use"; SET NULL is the belt to that braces.)
--
-- The partial unique indexes are the real guard: one source can never publish
-- two rows into the same target, even if a double save races itself.
--
-- The CHECKs say a row is published by ONE parent or it is its own — a consignee
-- cannot be simultaneously "the applicant's" and "the customer's".
--
-- NOTE: `consignees.customer_id` already exists and is something else entirely —
-- the consignee's owning customer, an ordinary picker field the operator sets.
-- `source_customer_id` is the publish link. Do not conflate them.
--
-- ADD-ONLY. Existing rows get NULL = "not published, an ordinary record".
-- ============================================================================

-- ---------------------------------------------------------------- customers
alter table public.customers
  add column if not exists source_applicant_id uuid
    references public.applicants(id) on delete set null;

create unique index if not exists customers_source_applicant_uidx
  on public.customers (source_applicant_id)
  where source_applicant_id is not null;

-- --------------------------------------------------------------- consignees
alter table public.consignees
  add column if not exists source_applicant_id uuid
    references public.applicants(id) on delete set null,
  add column if not exists source_customer_id uuid
    references public.customers(id) on delete set null;

create unique index if not exists consignees_source_applicant_uidx
  on public.consignees (source_applicant_id)
  where source_applicant_id is not null;

create unique index if not exists consignees_source_customer_uidx
  on public.consignees (source_customer_id)
  where source_customer_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'consignees_one_source_chk'
      and conrelid = 'public.consignees'::regclass
  ) then
    alter table public.consignees
      add constraint consignees_one_source_chk
      check (source_applicant_id is null or source_customer_id is null);
  end if;
end $$;

-- ----------------------------------------------------------------- notifies
alter table public.notifies
  add column if not exists source_customer_id uuid
    references public.customers(id) on delete set null,
  add column if not exists source_consignee_id uuid
    references public.consignees(id) on delete set null;

create unique index if not exists notifies_source_customer_uidx
  on public.notifies (source_customer_id)
  where source_customer_id is not null;

create unique index if not exists notifies_source_consignee_uidx
  on public.notifies (source_consignee_id)
  where source_consignee_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notifies_one_source_chk'
      and conrelid = 'public.notifies'::regclass
  ) then
    alter table public.notifies
      add constraint notifies_one_source_chk
      check (source_customer_id is null or source_consignee_id is null);
  end if;
end $$;

comment on column public.customers.source_applicant_id is
  'Published by Applicant ▸ Also Customer (0371). NULL = an ordinary customer.';
comment on column public.consignees.source_applicant_id is
  'Published by Applicant ▸ Also Consignee (0371). NULL = an ordinary consignee.';
comment on column public.consignees.source_customer_id is
  'Published by Customer ▸ Also Consignee (0371). NOT the same as customer_id, which is the consignee''s owning customer.';
comment on column public.notifies.source_customer_id is
  'Published by Customer ▸ Also Notify (0371). NULL = an ordinary notify party.';
comment on column public.notifies.source_consignee_id is
  'Published by Consignee ▸ Also Notify (0371). NULL = an ordinary notify party.';
