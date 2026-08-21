"""Generate supabase/seed/aarsan-order-book.sql from doc/demo.xlsx.

    python scripts/gen-aarsan-order-book.py     (run from the repo root)

`doc/demo.xlsx` IS A TAB-SEPARATED TEXT FILE despite its extension — `exceljs`
rejects it outright ("Can't find end of central directory : is this a zip
file?"). It is read as TSV here; do not "repair" it into a real workbook without
re-checking these column names.

The seed exists so the loaded figures are reviewable and reversible, and this
script exists so a re-supplied file is REGENERATED rather than reconciled by
hand. Nothing here talks to a database: the generated SQL is the artifact.

TODAY is pinned rather than read from the clock, deliberately. It decides which
shipped lines have a defensible invoice date (section 3 of the output), so a
re-run months later must not silently promote three more lines into revenue —
that is a decision for whoever supplies the next file, not for the calendar.
"""
import io, datetime, sys

SRC = "doc/demo.xlsx"
OUT = "supabase/seed/aarsan-order-book.sql"
PREFIX = "aa45a400-0000-4000-8000-"
BUYER = PREFIX + "000000000001"

rows = [l.rstrip("\n").split("\t") for l in io.open(SRC, encoding="utf-8-sig", newline=None) if l.strip()]
head = [c.strip() for c in rows[0]]
data = [dict(zip(head, [c.strip() for c in r])) for r in rows[1:]]

def d(s):
    return datetime.datetime.strptime(s, "%d-%m-%Y").date().isoformat()

def f(v):
    v = (v or "").replace(",", "")
    return float(v) if v else 0.0

def q(s):
    return "'" + s.replace("'", "''") + "'"

lines = []
for i, r in enumerate(data, start=1):
    oid = PREFIX + format(0x1000 + i, "012x")
    qty = f(r["Order Qty"])
    shipped = f(r["Shipped Qty"])
    price = f(r["Price"])
    status = "shipped" if shipped >= qty and qty > 0 else ("in_production" if shipped > 0 else "confirmed")
    lines.append(
        "  ('{id}'::uuid, {num}, {qty:.0f}, {price}, {val}, "
        "'{recv}'::date, '{deli}'::date, '{status}', '{recv}T09:00:00+05:30'::timestamptz)".format(
            id=oid,
            num=q(r["RE No"]),
            qty=qty,
            price=round(price, 2),
            val=round(qty * price, 2),
            recv=d(r["Received Dt"]),
            deli=d(r["Delivery Dt"]),
            status=status,
        )
    )

TODAY = datetime.date(2026, 8, 21)  # the day the file was supplied

# THE SHIPPED PORTION, only where it can be honestly dated. See the header.
recv_lines, skipped = [], []
for i, r in enumerate(data, start=1):
    shipped = f(r["Shipped Qty"])
    if shipped <= 0:
        continue
    price = f(r["Price"])
    usd = round(shipped * price, 2)
    deli = datetime.datetime.strptime(r["Delivery Dt"], "%d-%m-%Y").date()
    if deli > TODAY:
        skipped.append((r["RE No"], usd, deli.isoformat()))
        continue
    recv_lines.append(
        "  ('{id}'::uuid, '{deli}'::date, {usd}, {inr}, {note})".format(
            id=PREFIX + format(0x2000 + i, "012x"),
            deli=deli.isoformat(),
            usd=usd,
            inr=round(usd * 84.0, 2),
            note=q("Shipped portion of " + r["RE No"] + " — " + str(int(shipped)) + " pcs. Source file states no invoice number and no invoice date; dated on its delivery date."),
        )
    )

recv_usd = sum(f(r["Shipped Qty"]) * f(r["Price"]) for r in data if f(r["Shipped Qty"]) > 0
               and datetime.datetime.strptime(r["Delivery Dt"], "%d-%m-%Y").date() <= TODAY)
skip_usd = sum(x[1] for x in skipped)
skip_list = chr(10).join(f"--      {a}   USD {b:>10,.2f}   delivery {c}" for a, b, c in skipped)

total_qty = sum(f(r["Order Qty"]) for r in data)
total_shipped = sum(f(r["Shipped Qty"]) for r in data)
total_pending = sum(f(r["QTY"]) for r in data)
total_usd = sum(f(r["Order Qty"]) * f(r["Price"]) for r in data)
pending_usd = sum(f(r["FGN Value"]) for r in data)
pending_inr = sum(f(r["INRValue"]) for r in data)

sql = f"""-- ============================================================================
-- Raagam ERP — AARSAN AMERICAS order book, for the dashboard
--
-- Source: `doc/demo.xlsx` as supplied by the client on 2026-08-21. Despite the
-- extension it is a TAB-SEPARATED text file, not a workbook — `exceljs` refuses
-- it ("Can't find end of central directory"), and that is the file being read
-- here, not a conversion of it. Generated, never hand-typed: every figure below
-- is copied from a row of that file, so a re-supply regenerates rather than
-- being reconciled by eye.
--
-- ## What it is
--
-- {len(data)} order lines, one customer, USD at 84.00 throughout:
--
--     ordered   {total_qty:>12,.0f} pcs
--     shipped   {total_shipped:>12,.0f} pcs   ({sum(1 for r in data if f(r['Shipped Qty']) > 0)} lines have shipped anything)
--     pending   {total_pending:>12,.0f} pcs
--     order value      USD {total_usd:>14,.2f}   (Order Qty x Price)
--     pending value    USD {pending_usd:>14,.2f}   = INR {pending_inr:,.2f} at 84.00
--
-- ## THE FILE'S "VALUE" COLUMNS ARE THE PENDING BALANCE, NOT THE ORDER
--
-- `FGN Value` is `QTY x Price` where `QTY` is Order Qty MINUS Shipped Qty, and
-- `INRValue` is that times the Ex Rate. They are what is still to ship, which is
-- the number an exporter's order book is about — and it is NOT what
-- `sales_orders.total_value` means. That column holds the value of the order, so
-- it is loaded as `Order Qty x Price`. The two differ by the shipped portion
-- (USD {total_usd - pending_usd:,.2f} across {sum(1 for r in data if f(r['Shipped Qty']) > 0)} lines) and conflating them would
-- overstate neither figure but silently answer a different question.
--
-- There is no column anywhere for shipped-to-date on an order, so the pending
-- balance is NOT stored: it would have to be invented as a shipment or an
-- invoice, and this file names no shipment and no invoice.
--
-- ## Every row is tagged and reversible
--
-- Ids are deterministic under `{PREFIX}...`, a prefix no
-- `gen_random_uuid()` will produce, so `aarsan-order-book-cleanup.sql` removes
-- exactly this dataset and nothing else. It is deliberately a DIFFERENT prefix
-- from `decade00-...` (the invented demo dataset in `demo-data.sql`): this is
-- the client's own trading data, and the two must be removable independently.
-- Re-running this script is safe — it begins with the same delete.
--
-- ## Dates
--
-- `created_at` carries `Received Dt`, because that is the column
-- `analytics_monthly_sales` buckets on (0042) and therefore what every
-- order figure on the dashboard is grouped by. `order_date` gets the same date —
-- it decides which fiscal year an SC No numbers into. `ship_date` and
-- `delivery_date` carry `Delivery Dt`.
--
-- ## What this does NOT touch
--
-- Production (`production_entries`), dispatch (`shipments`), purchases
-- (`purchase_orders`) and inventory (`stock_ledger`) — the file says nothing
-- about any of them, so nothing here writes to them. Revenue IS written, but
-- only the part that can be dated; see section 3.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Remove any previous run of THIS dataset (not the decade00 one)
-- ---------------------------------------------------------------------------
delete from public.sales_orders where id::text like '{PREFIX}%';
delete from public.buyers        where id::text like '{PREFIX}%';

-- ---------------------------------------------------------------------------
-- 1. The customer
--    `buyers` is the party `sales_orders.buyer_id` points at, and the dashboard's
--    recent-orders list embeds `buyers(name)` — an order with a null buyer shows
--    no customer at all, which the four existing live orders already demonstrate.
-- ---------------------------------------------------------------------------
insert into public.buyers (id, code, name, country, currency_code, is_active)
values ('{BUYER}'::uuid, 'AARSAN', 'AARSAN AMERICAS', 'United States', 'USD', true);

-- ---------------------------------------------------------------------------
-- 2. The order book
--    `location_id` is looked up by CODE rather than hard-coded: the RE Nos all
--    begin "U2/", which is Unit 2 in `locations`.
--    `status` is derived from the file's own Shipped Qty — nothing shipped is
--    `confirmed`, part-shipped is `in_production`, fully shipped would be
--    `shipped` (no line in this file is fully shipped).
-- ---------------------------------------------------------------------------
insert into public.sales_orders
  (id, buyer_id, location_id, currency_code,
   order_number, order_qty, fob_price, total_value,
   order_date, ship_date, delivery_date, status, created_at)
select
  v.id, '{BUYER}'::uuid,
  (select id from public.locations where code = 'U2' limit 1),
  'USD',
  v.order_number, v.order_qty, v.fob_price, v.total_value,
  v.order_date, v.ship_date, v.ship_date, v.status, v.created_at
from (values
{",".join(chr(10) + l for l in lines)}
) as v(id, order_number, order_qty, fob_price, total_value,
       order_date, ship_date, status, created_at);

-- ---------------------------------------------------------------------------
-- 3. The shipped portion, as receivables — ONLY WHERE IT CAN BE DATED
--
--    `analytics_revenue_trend` (0042) buckets on `invoice_date`, so every row
--    here has to name a month. The file names none: it has a Shipped Qty and no
--    invoice number, no invoice date and no shipment date.
--
--    Delivery Dt is the only shipment-adjacent date it carries, and for THREE of
--    the eleven shipped lines that date has not arrived yet — USD {skip_usd:,.2f}
--    of the USD {recv_usd + skip_usd:,.2f} shipped, {skip_usd / (recv_usd + skip_usd) * 100:.0f}% of it. Posting those would put
--    revenue in a month that has not happened, which is worse than omitting it:
--    a future bar on a revenue chart is read as history by everyone who sees it.
--
--    So the eight whose delivery date has passed are loaded, dated on it, and
--    the three are left out and named below. Client decision, 2026-08-21, asked
--    with the arithmetic in front of them.
--
--    NOT LOADED (no defensible date):
{skip_list}
-- ---------------------------------------------------------------------------
delete from public.receivables where id::text like '{PREFIX}%';

insert into public.receivables
  (id, buyer_id, location_id, currency_code, invoice_date,
   amount_fc, exchange_rate, amount_inr, status, notes, created_at)
select
  v.id, '{BUYER}'::uuid,
  (select id from public.locations where code = 'U2' limit 1),
  'USD', v.invoice_date, v.amount_fc, 84.00, v.amount_inr, 'open', v.notes,
  v.invoice_date::timestamptz
from (values
{",".join(chr(10) + l for l in recv_lines)}
) as v(id, invoice_date, amount_fc, amount_inr, notes);

commit;

-- Verify:
--   select count(*), sum(order_qty), sum(total_value)
--   from public.sales_orders where id::text like '{PREFIX}%';
--   -- expect {len(data)} | {total_qty:,.0f} | {total_usd:,.2f}
"""

io.open(OUT, "w", encoding="utf-8", newline="\n").write(sql)
print(f"wrote {OUT}: {len(data)} orders, {total_qty:,.0f} pcs, USD {total_usd:,.2f}")
