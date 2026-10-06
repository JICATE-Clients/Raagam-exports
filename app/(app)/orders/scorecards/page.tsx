import Link from "next/link";
import { requirePermission, requireUser } from "@/lib/auth/server";
import { getScorecards, type BuyerRow, type MerchandiserRow, type Period, type Rate, type SupplierRow } from "@/lib/orders/scorecards/service";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { SEG_IDLE, SEG_ITEM, SEG_LIT, SEG_TRACK } from "@/components/ui/segmented";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";

/**
 * ORDERS ▸ ORDER MANAGEMENT ▸ SCORECARDS (user 2026-10-01). Three cards —
 * Merchandisers, Buyers, Suppliers — counted on read by
 * `lib/orders/scorecards/service.ts`, which also holds who may see what.
 * Tabs and period are links (`tab`, `period`), so a view can be bookmarked.
 */
type Tab = "merchandisers" | "buyers" | "suppliers";

const PERIODS: { key: Period; label: string }[] = [
  { key: "fy", label: "This FY" },
  { key: "90d", label: "Last 90 days" },
  { key: "all", label: "All time" },
];

export default async function ScorecardsPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string }> }) {
  await requirePermission("orders", "view");
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const period: Period = sp.period === "90d" || sp.period === "all" ? sp.period : "fy";
  const sc = await getScorecards(user, period);
  const tab: Tab = sc.isManager && (sp.tab === "buyers" || sp.tab === "suppliers") ? sp.tab : "merchandisers";
  const href = (p: { tab?: Tab; period?: Period }) => `/orders/scorecards?tab=${p.tab ?? tab}&period=${p.period ?? period}`;

  const span = period === "all" ? `all time, to ${fmtDate(sc.to)}` : `${fmtDate(sc.from)} to ${fmtDate(sc.to)}`;
  const notes: string[] = [];
  if (tab === "buyers" && sc.emptySources.shipments) notes.push("On-time shipping fills in once shipments are entered on Logistics — none in this period yet.");
  if (tab === "buyers" && sc.emptySources.receipts) notes.push("Payment days fill in once buyer receipts are recorded — none in this period yet.");
  if (tab === "suppliers" && sc.emptySources.purchaseOrders) notes.push("No purchase orders were due in this period, so there is nothing to score yet.");
  if (tab === "merchandisers" && !sc.isManager && !sc.myStaffId)
    notes.push("This login is not linked to a staff record, so your own score cannot be shown.");

  // Worst first (design 2026-10-01): the row to talk to tops the list. A row
  // with nothing due yet has no score to rank, so it goes last.
  const pctOf = (r: Rate) => (r.den ? r.num / r.den : 2);
  const merchRows = [...sc.merchandisers].sort((x, y) => pctOf(x.taOnTime) - pctOf(y.taOnTime) || y.orders - x.orders);
  const buyerRows = sc.buyers ? [...sc.buyers].sort((x, y) => pctOf(x.shipOnTime) - pctOf(y.shipOnTime) || y.revisions - x.revisions || y.orders - x.orders) : [];
  const supplierRows = sc.suppliers ? [...sc.suppliers].sort((x, y) => pctOf(x.onTime) - pctOf(y.onTime) || y.pos - x.pos) : [];
  const sortNote = { merchandisers: "Sorted by T&A on time, worst first", buyers: "Sorted by shipped on time, then revisions", suppliers: "Sorted by on-time delivery, worst first" }[tab];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Scorecards"
        description={sc.isManager ? `How merchandisers, buyers and suppliers performed — ${span}` : `Your own score — ${span}`}
        actions={<Segmented active={period} items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: href({ period: p.key }) }))} />}
      />

      {sc.totals && (
        // Section cap 72rem, the same as the table below: four tiles of ~17rem.
        <div className="grid max-w-[72rem] grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="T&A on time — whole team" rate={sc.totals.taOnTime} unit="tasks due" emptyHint="No T&A tasks due yet" />
          <Tile
            label="Buyer reply time"
            value={sc.totals.approvalDays == null ? null : `${fmtNumber(sc.totals.approvalDays)} d`}
            hint={sc.totals.approvalDays == null ? "No approvals answered yet" : "average, sample sent → answer"}
          />
          <Tile label="Shipped on time" rate={sc.totals.shipOnTime} unit="orders shipped" emptyHint="No shipments entered yet" />
          <Tile label="Supplier on time" rate={sc.totals.supplierOnTime} unit="POs due" emptyHint="No purchase orders due yet" />
        </div>
      )}

      {sc.errors.length > 0 && <p className="text-sm text-danger">Could not load: {sc.errors.join(" · ")}</p>}

      {/* Section cap: the widest card (Buyers, 7 columns ≈ 14rem name + 6 ×
          ~9rem figures) fits 72rem; wider only spreads the numbers apart. */}
      <Card className="max-w-[72rem] overflow-hidden">
        <div className="flex flex-wrap items-center border-b border-border px-3">
          {sc.isManager ? (
            <>
              <TabLink active={tab === "merchandisers"} href={href({ tab: "merchandisers" })} label="Merchandisers" count={sc.merchandisers.length} />
              <TabLink active={tab === "buyers"} href={href({ tab: "buyers" })} label="Buyers" count={sc.buyers?.length ?? 0} />
              <TabLink active={tab === "suppliers"} href={href({ tab: "suppliers" })} label="Suppliers" count={sc.suppliers?.length ?? 0} />
            </>
          ) : (
            <span className="px-3 py-3 text-sm font-bold">Your score</span>
          )}
          <span className="ml-auto py-2 pr-2 text-xs text-muted-foreground">{sortNote}</span>
        </div>
        {notes.length > 0 && (
          <div className="space-y-0.5 border-b border-border bg-surface-muted/50 px-4 py-2">
            {notes.map((n) => (
              <p key={n} className="text-xs text-muted-foreground">
                {n}
              </p>
            ))}
          </div>
        )}
        {tab === "merchandisers" && (
          <DataTable<MerchandiserRow>
            bare
            rows={merchRows}
            getKey={(r) => r.key}
            columns={withCreatedColumns(merchColumns, merchRows)}
            empty="No orders in this period."
          />
        )}
        {tab === "buyers" && (
          <DataTable<BuyerRow> bare rows={buyerRows} getKey={(r) => r.key} columns={withCreatedColumns(buyerColumns, buyerRows)} empty="No orders in this period." />
        )}
        {tab === "suppliers" && (
          <DataTable<SupplierRow> bare rows={supplierRows} getKey={(r) => r.key} columns={withCreatedColumns(supplierColumns, supplierRows)} empty="No purchase orders due in this period." />
        )}
        <p className="border-t border-border bg-surface-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          Only work already due is scored. A dash means nothing was due yet — never a score of zero. Figures are counted live from
          the orders, T&amp;A, shipments, receipts and goods receipts, so a corrected date corrects the score.
        </p>
      </Card>
    </div>
  );
}

function TabLink({ active, href, label, count }: { active: boolean; href: string; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "px-3 py-3 text-sm",
        active ? "font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]" : "font-semibold text-muted-foreground hover:text-foreground",
      )}
    >
      {label} · {count}
    </Link>
  );
}

/** A summary tile: a rate (toned at 90 / 75) or a plain value. Nothing to count reads "—" and says why. */
function Tile({
  label,
  rate,
  unit,
  emptyHint,
  value,
  hint,
}: {
  label: string;
  rate?: Rate;
  unit?: string;
  emptyHint?: string;
  value?: string | null;
  hint?: string;
}) {
  const pct = rate && rate.den ? Math.round((rate.num / rate.den) * 100) : null;
  const shown = rate ? (pct == null ? null : `${pct}%`) : (value ?? null);
  const sub = rate ? (pct == null ? emptyHint : `${rate.num} of ${rate.den} ${unit}`) : hint;
  return (
    <Card className="flex flex-col gap-1 px-4 py-3">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-bold tabular-nums", shown == null ? "text-muted-foreground" : pct == null ? "text-foreground" : toneText(pct))}>
        {shown ?? "—"}
      </span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </Card>
  );
}

const toneText = (pct: number) => (pct >= 90 ? "text-success" : pct >= 75 ? "text-warning" : "text-danger");
const toneBg = (pct: number) => (pct >= 90 ? "bg-success" : pct >= 75 ? "bg-warning" : "bg-danger");

/** The period switch. Its words are `<Link>`s (this page is server-only), so it
 *  draws from the SEG_* strings rather than `ToggleGroup` — the one-shape rule,
 *  user 2026-10-06. */
function Segmented({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div role="group" aria-label="Period" data-segmented="" className={SEG_TRACK}>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "page" : undefined}
          className={cn(SEG_ITEM, i.key === active ? SEG_LIT : SEG_IDLE)}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/** A bar, "86%" and "12/14", toned at 90 / 75. A rate with nothing due is a dash. */
function RateCell({ rate }: { rate: Rate }) {
  if (rate.den === 0) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round((rate.num / rate.den) * 100);
  return (
    <span className="inline-flex w-48 items-center gap-2 tabular-nums">
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <span className={cn("block h-full rounded-full", toneBg(pct))} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn("w-10 text-right font-bold", toneText(pct))}>{pct}%</span>
      <span className="w-12 text-xs text-muted-foreground">
        {rate.num}/{rate.den}
      </span>
    </span>
  );
}

const initials = (name: string) =>
  name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const num = (n: number | null, suffix = "") =>
  n == null ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums">{`${fmtNumber(n)}${suffix}`}</span>;

const merchColumns: Column<MerchandiserRow>[] = [
  {
    header: "Merchandiser",
    cell: (r) => (
      <span className="inline-flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold",
            r.staffId ? "bg-primary/10 text-primary" : "bg-surface-muted text-muted-foreground",
          )}
        >
          {r.staffId ? initials(r.name) : "?"}
        </span>
        <span className={cn("font-semibold", !r.staffId && "italic text-muted-foreground")}>{r.name}</span>
      </span>
    ),
  },
  { header: "Orders", align: "right", cell: (r) => num(r.orders) },
  { header: "T&A on time", align: "right", cell: (r) => <RateCell rate={r.taOnTime} /> },
  { header: "T&A overdue", align: "right", cell: (r) => (r.taOverdue ? <span className="font-semibold tabular-nums text-danger">{r.taOverdue}</span> : num(0)) },
  { header: "Samples sent on time", align: "right", cell: (r) => <RateCell rate={r.approvalsOnTime} /> },
  { header: "Revisions", align: "right", cell: (r) => num(r.revisions) },
];

const buyerColumns: Column<BuyerRow>[] = [
  { header: "Buyer", cell: (r) => <span className="font-medium">{r.name}</span> },
  { header: "Orders", align: "right", cell: (r) => num(r.orders) },
  { header: "Revisions", align: "right", cell: (r) => num(r.revisions) },
  { header: "Revisions / order", align: "right", cell: (r) => num(r.orders ? Math.round((r.revisions / r.orders) * 10) / 10 : null) },
  { header: "Approval reply", align: "right", cell: (r) => num(r.approvalDays, " d") },
  { header: "Shipped on time", align: "right", cell: (r) => <RateCell rate={r.shipOnTime} /> },
  { header: "Payment days", align: "right", cell: (r) => num(r.paymentDays, " d") },
];

const supplierColumns: Column<SupplierRow>[] = [
  { header: "Supplier", cell: (r) => <span className="font-medium">{r.name}</span> },
  { header: "POs due", align: "right", cell: (r) => num(r.pos) },
  { header: "Delivered on time", align: "right", cell: (r) => <RateCell rate={r.onTime} /> },
  { header: "Received qty", align: "right", cell: (r) => num(r.received) },
  {
    header: "Rejected",
    align: "right",
    cell: (r) =>
      r.received ? (
        <span className="tabular-nums">
          <span className={cn("font-semibold", r.rejected / r.received > 0.05 ? "text-danger" : "text-foreground")}>
            {Math.round((r.rejected / r.received) * 1000) / 10}%
          </span>
          <span className="ml-1 text-xs text-muted-foreground">{fmtNumber(r.rejected)}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];
