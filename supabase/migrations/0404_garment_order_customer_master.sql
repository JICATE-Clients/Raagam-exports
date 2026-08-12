-- 0404 — the Garment Order's "Customer" IS the Customer master
--
-- Client, 2026-08-11, looking at the New Garment Order screen: the Customer
-- dropdown offered Aurelia Retail / Cotton & Co / H&B Sourcing / Nordheim
-- Apparel — four DEMO rows (`decade00-…`) — beside ABASIC and NEXT, while the
-- two real parties they had entered on the Customer master, ASMARA and OXBOW,
-- could not be picked at all.
--
-- The cause is two party tables that have coexisted since the scaffold:
--
--   public.buyers    (0004) — a thin generic-ERP table: 19 columns, maintained
--                             on the legacy `/masters` Buyers tab.
--   public.customers (0240) — the legacy-faithful party master: GST, contacts,
--                             consignees, markings, agents, nominated vendors.
--
-- `customers` is the master the business actually keeps. `buyers` is the spine
-- the Sales/Orders scaffold was built on, and 30 tables still reference it.
--
-- WHAT THIS MIGRATION DOES NOT DO, AND WHY. It does not repoint `buyers`
-- wholesale. ~20 services embed the buyer THROUGH the order — PostgREST
-- `.select("*, buyers(name)")` on `sales_orders`, in dashboard, logistics,
-- production, integration and eight Orders sub-modules. Those embeds resolve by
-- FK: move the FK and every one of them fails at RUNTIME with "could not find a
-- relationship", which neither `tsc` nor `next build` can see. A 20-file
-- runtime-only blast radius is not the right price for the field that was
-- reported, so `sales_orders.buyer_id` keeps its FK and every embed keeps
-- working.
--
-- Safe to do at all only because BOTH order tables are EMPTY (verified against
-- the catalog 2026-08-11: sales_orders 0 rows, garment_order_amendments 0 rows).
-- There is no data to migrate and no historic row whose party would change
-- meaning underneath it. This migration would be a different and much more
-- dangerous proposition a month from now.

begin;

-- 1. The number-minting shell may name no buyer.
--
-- `createAmendment` inserts a `sales_orders` row before the amendment purely so
-- 0395's `assign_order_number()` trigger stamps the SC No; the party now lives
-- on the amendment, as a CUSTOMER. `buyer_id` was `not null`, so that insert
-- would have had to invent a buyer for a document that has none.
--
-- Nullable, NOT repointed: the column keeps referencing `buyers`, which is what
-- keeps the ~20 embeds above alive. A minted shell simply leaves it empty.
alter table public.sales_orders alter column buyer_id drop not null;

comment on column public.sales_orders.buyer_id is
  'Legacy buyers FK. NULL on a shell minted by the Garment Order screen, whose '
  'party is garment_order_amendments.customer_id -> customers (0404).';

-- 2. The amendment's party becomes a Customer.
--
-- Renamed as well as repointed, deliberately. A column called `buyer_id` that
-- points at `customers` is the exact shape of the FK landmines 0355 (state_id)
-- and 0375/0376 (payment_term, vendors) were written to clear up: same name,
-- different target, and every reader compiles while meaning something else.
alter table public.garment_order_amendments
  drop constraint if exists garment_order_amendments_buyer_id_fkey;

alter table public.garment_order_amendments
  rename column buyer_id to customer_id;

alter table public.garment_order_amendments
  add constraint garment_order_amendments_customer_id_fkey
  foreign key (customer_id) references public.customers(id);

comment on column public.garment_order_amendments.customer_id is
  'The Customer master row this order is for (0404). Was buyer_id -> buyers, '
  'which offered demo rows and could not reach the Customer master.';

create index if not exists garment_order_amendments_customer_id_idx
  on public.garment_order_amendments (customer_id);

commit;

-- ---------------------------------------------------------------------------
-- Verify FROM THE CATALOG, never from this file reporting success (0386).
--
--   select conname, confrelid::regclass::text
--     from pg_constraint
--    where conrelid = 'public.garment_order_amendments'::regclass
--      and contype = 'f' and conname like '%customer%';
--   -- expect: garment_order_amendments_customer_id_fkey | customers
--
--   select is_nullable from information_schema.columns
--    where table_name = 'sales_orders' and column_name = 'buyer_id';
--   -- expect: YES
--
-- KNOWN CONSEQUENCE, stated rather than discovered later: an order raised on
-- the Garment Order screen mints a `sales_orders` row with no buyer, so the
-- dashboard's "recent orders" strip shows its fallback label instead of a party
-- name for those rows. That is honest — the party is on the amendment — and it
-- is the seam to close when `sales_orders` itself is repointed. It is not a
-- reason to invent a buyer here.
--
-- STILL UNRESOLVED, and NOT this migration's business: `buyers.customer_id`
-- (0380) remains the nullable bridge, set for none of the 6 buyers. Shipments,
-- receivables and invoices still key on `buyers`, so a shipment's party and an
-- order's party are not yet joinable. Closing that means repointing
-- `sales_orders` and fixing those ~20 embeds together, as one deliberate piece
-- of work.
