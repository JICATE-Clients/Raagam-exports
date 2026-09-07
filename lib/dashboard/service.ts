import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getDashboardData } from "@/lib/orders/service";
import { addDays, monthLabel, rangeWindow, today, trailing12 } from "./range";
import { delta, fmtCompactInr, fmtCompactNumber, fmtPct } from "./format";
import type {
  ActivityItem,
  AlertItem,
  ApprovalRow,
  ApprovalsResult,
  Cell,
  DashboardCaps,
  DashboardFilters,
  HeroKpi,
  Leaderboard,
  LeaderRow,
  MiniStatRow,
  PulseRing,
  StageRow,
  StatusSlice,
  TrendPoint,
  TrendsData,
} from "./types";

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

/** PostgREST returns Postgres `numeric` as strings to preserve precision. */
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const s = (v: unknown): string => (v == null ? "" : String(v));

type Row = Record<string, unknown>;
const rows = (res: { data: unknown }): Row[] =>
  Array.isArray(res.data) ? (res.data as Row[]) : [];

/** First element of a PostgREST embed, which arrives as either object or array. */
function embed(row: Row, key: string): Row | null {
  const v = row[key];
  if (Array.isArray(v)) return (v[0] as Row) ?? null;
  return (v as Row) ?? null;
}

class DeniedError extends Error {}

/**
 * The 8 analytics RPCs `raise exception … errcode '42501'` when the caller lacks
 * reports:view. supabase-js does NOT throw on that — it resolves with
 * `{ error }` — so a plain try/catch would swallow the denial and the tile would
 * render a confident `0`. Checking the code explicitly is the whole point.
 */
async function rpc(
  sb: Awaited<ReturnType<typeof createClient>>,
  fn: string,
  args: Record<string, unknown>,
): Promise<Row[]> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    if (error.code === "42501") throw new DeniedError(fn);
    throw new Error(`${fn}: ${error.message}`);
  }
  return Array.isArray(data) ? (data as Row[]) : [];
}

/**
 * Turns "this tile has no data" into a value the UI can render, rather than an
 * exception that takes the page with it. `enabled` is the permission gate;
 * anything thrown inside becomes an isolated error on one tile.
 */
async function cell<T>(enabled: boolean, fn: () => Promise<T>): Promise<Cell<T>> {
  if (!enabled) return { ok: false, reason: "denied" };
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof DeniedError) return { ok: false, reason: "denied" };
    return { ok: false, reason: "error", note: (e as Error).message };
  }
}

/** Product gaps, stated once so the wording stays consistent across tiles. */
export const NOT_TRACKED = {
  machines: {
    ok: false as const,
    reason: "not_tracked" as const,
    note: "No machine master or downtime capture exists yet.",
  },
  reorder: {
    ok: false as const,
    reason: "not_tracked" as const,
    note: "Low-stock alerts need a reorder level on the item master.",
  },
  stage: {
    ok: false as const,
    reason: "not_tracked" as const,
    note: "Production capture covers cutting, sewing and packing only.",
  },
};

/* ------------------------------------------------------------------ *
 * Permissions
 * ------------------------------------------------------------------ */

/**
 * `can()` is already React-cache()d over a single permission fetch, so resolving
 * all nine of these costs zero extra round-trips.
 */
export const getCaps = cache(async (): Promise<DashboardCaps> => {
  const [
    orders,
    sales,
    reports,
    finance,
    production,
    materials,
    stores,
    logistics,
    systemAdmin,
  ] = await Promise.all([
    can("orders", "view"),
    can("sales", "view"),
    can("reports", "view"),
    can("finance", "view"),
    can("production", "view"),
    can("materials_purchase", "view"),
    can("stores", "view"),
    can("logistics", "view"),
    can("system_admin", "view"),
  ]);
  return {
    orders,
    sales,
    reports,
    finance,
    production,
    materials,
    stores,
    logistics,
    systemAdmin,
  };
});

/** Shared between the pulse rings, the order-status donut and the alerts. */
const core = cache(getDashboardData);

/**
 * The five trailing-12-month RPC series, fetched at most once per request.
 *
 * Both the headline section (which needs their tails for the KPI sparklines)
 * and the trends section (which plots them) want this data, and they sit in
 * different Suspense boundaries. `cache()` means whichever resolves first pays
 * for it and the other gets it free, instead of ten RPC calls where five would
 * do.
 *
 * Arguments are primitives, not the filters object: React's cache keys on
 * argument identity, so passing a freshly-built object every call would defeat
 * the memoization entirely.
 */
const trendBundle = cache(
  async (location: string | null, reports: boolean) => {
    const sb = await createClient();
    const t12 = trailing12();
    const args = { p_from: t12.from, p_to: t12.to, p_location: location };
    const [sales, revenue, purchase, inventory, production] = await Promise.all([
      cell(reports, () => rpc(sb, "analytics_monthly_sales", args)),
      cell(reports, () => rpc(sb, "analytics_revenue_trend", args)),
      cell(reports, () => rpc(sb, "analytics_purchase_trend", args)),
      cell(reports, () => rpc(sb, "analytics_inventory_movement", args)),
      cell(reports, () => rpc(sb, "analytics_production_efficiency", args)),
    ]);
    return { sales, revenue, purchase, inventory, production };
  },
);

/** Last 8 monthly points of a series — the shape a sparkline needs. */
function tail(c: Cell<Row[]>, key: string, key2?: string): number[] {
  if (!c.ok) return [];
  return c.value.slice(-8).map((r) => n(r[key]) + (key2 ? n(r[key2]) : 0));
}

/* ------------------------------------------------------------------ *
 * Hero pulse rings
 * ------------------------------------------------------------------ */

/**
 * Three "how are we doing" rings.
 *
 * None of the mockup's original three survived contact with the schema, and the
 * substitutions are deliberate rather than approximate:
 *  - "On-time delivery" needs an actual dispatch date. `shipments` has etd/eta
 *    (both plans) and no delivered-on column, so the honest nearest measure is
 *    T&A milestones closed on or before their planned date.
 *  - "Capacity used" needs a capacity per line. There is none, and the planning
 *    tables that held one were dropped in 0332. Lines reporting output today is
 *    a real signal of the same shape.
 */
export async function getPulse(caps: DashboardCaps): Promise<PulseRing[]> {
  const sb = await createClient();
  const t = today();

  const [milestones, lines, entriesToday, coreData] = await Promise.all([
    caps.orders
      ? sb
          .from("ta_milestones")
          .select("planned_date, actual_date")
          .eq("status", "done")
          .not("actual_date", "is", null)
          .gte("actual_date", addDays(t, -90))
      : Promise.resolve({ data: null }),
    caps.production
      ? sb.from("production_lines").select("id").eq("is_active", true)
      : Promise.resolve({ data: null }),
    caps.production
      ? sb.from("production_entries").select("line_id").eq("entry_date", t)
      : Promise.resolve({ data: null }),
    caps.orders ? core() : Promise.resolve(null),
  ]);

  const out: PulseRing[] = [];

  const ms = rows(milestones);
  if (caps.orders && ms.length > 0) {
    const onTime = ms.filter((m) => s(m.actual_date) <= s(m.planned_date)).length;
    out.push({
      label: "Milestones on time",
      note: `last 90 days · ${onTime} of ${ms.length}`,
      pct: Math.round((onTime / ms.length) * 100),
      tone: "primary",
    });
  }

  const lineRows = rows(lines);
  if (caps.production && lineRows.length > 0) {
    const reporting = new Set(
      rows(entriesToday)
        .map((e) => s(e.line_id))
        .filter(Boolean),
    ).size;
    out.push({
      label: "Lines reporting",
      note: `today · ${reporting} of ${lineRows.length} active`,
      pct: Math.round((reporting / lineRows.length) * 100),
      tone: "accent",
    });
  }

  if (coreData) {
    const open = coreData.openOrders;
    const atRisk = new Set(
      coreData.milestoneRows
        .filter((m) => m.planned_date != null && m.planned_date < t)
        .map((m) => m.sales_order_id),
    ).size;
    if (open > 0) {
      out.push({
        label: "Order health",
        note: atRisk === 0 ? "no orders at risk" : `${atRisk} order(s) at risk`,
        pct: Math.max(0, Math.round(((open - atRisk) / open) * 100)),
        tone: atRisk === 0 ? "success" : "warning",
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Section 01 — hero KPIs + mini stats
 * ------------------------------------------------------------------ */

/**
 * The four headline figures, plus their period-on-period deltas.
 *
 * These go through the analytics RPCs rather than direct queries because the
 * RPCs aggregate in SQL — the equivalent PostgREST call would have to stream
 * every matching row back to sum it. The RPCs filter `WHERE date BETWEEN from
 * AND to` *before* grouping, so summing the rows they return is exactly the
 * range total even when the range is a single day.
 *
 * The cost is that they are gated on reports:view. That is the correct
 * trade: a user without it sees these three tiles omitted and the whole
 * operational half of the dashboard intact.
 */
export async function getHeroKpis(
  f: DashboardFilters,
  caps: DashboardCaps,
): Promise<Cell<HeroKpi>[]> {
  const sb = await createClient();
  const w = rangeWindow(f.range);
  const cur = { p_from: w.from, p_to: w.to, p_location: f.location };
  const prev = { p_from: w.prevFrom, p_to: w.prevTo, p_location: f.location };

  // Sparklines always show the monthly trailing series, never the selected
  // range: an eight-point trace of a single day would be noise. Shared with the
  // trends section via cache(), so this costs nothing extra.
  const bundle = await trendBundle(f.location, caps.reports);
  const spark = {
    sales: tail(bundle.sales, "units"),
    revenue: tail(bundle.revenue, "invoiced_inr", "domestic_inr"),
    production: tail(bundle.production, "good_qty"),
  };

  const sum = (r: Row[], key: string) => r.reduce((t, x) => t + n(x[key]), 0);
  const periodHint =
    f.range === "today" ? "vs yesterday" : f.range === "week" ? "vs last week" : "vs last month";

  const [sales, revenue, production, dispatch] = await Promise.all([
    cell(caps.reports, async () => {
      const [c, p] = await Promise.all([
        rpc(sb, "analytics_monthly_sales", cur),
        rpc(sb, "analytics_monthly_sales", prev),
      ]);
      const value = sum(c, "units");
      const d = delta(value, sum(p, "units"));
      return {
        key: "sales",
        label: "Order volume",
        value: fmtCompactNumber(value),
        delta: d?.text ?? null,
        up: d?.up ?? true,
        hint: `pcs booked · ${periodHint}`,
        icon: "trending-up",
        spark: spark.sales,
      } satisfies HeroKpi;
    }),

    cell(caps.reports, async () => {
      const [c, p] = await Promise.all([
        rpc(sb, "analytics_revenue_trend", cur),
        rpc(sb, "analytics_revenue_trend", prev),
      ]);
      const value = sum(c, "invoiced_inr") + sum(c, "domestic_inr");
      const d = delta(value, sum(p, "invoiced_inr") + sum(p, "domestic_inr"));
      return {
        key: "revenue",
        label: "Revenue invoiced",
        value: fmtCompactInr(value),
        delta: d?.text ?? null,
        up: d?.up ?? true,
        hint: `export + domestic · ${periodHint}`,
        icon: "indian-rupee",
        spark: spark.revenue,
      } satisfies HeroKpi;
    }),

    cell(caps.reports, async () => {
      const [c, p] = await Promise.all([
        rpc(sb, "analytics_production_efficiency", cur),
        rpc(sb, "analytics_production_efficiency", prev),
      ]);
      const value = sum(c, "good_qty");
      const d = delta(value, sum(p, "good_qty"));
      return {
        key: "production",
        label: "Production output",
        value: fmtCompactNumber(value),
        delta: d?.text ?? null,
        up: d?.up ?? true,
        hint: `good pcs confirmed · ${periodHint}`,
        icon: "factory",
        spark: spark.production,
      } satisfies HeroKpi;
    }),

    // Range-independent by nature: a shipment is pending now or it isn't.
    cell(caps.logistics, async () => {
      const t = today();
      const [{ count }, late] = await Promise.all([
        sb
          .from("shipments")
          .select("id", { count: "exact", head: true })
          .in("status", ["planning", "docs_ready"]),
        sb
          .from("shipments")
          .select("id", { count: "exact", head: true })
          .in("status", ["planning", "docs_ready"])
          .lt("etd", t),
      ]);
      const pending = count ?? 0;
      const overdue = late.count ?? 0;
      return {
        key: "dispatch",
        label: "Pending dispatch",
        value: fmtCompactNumber(pending),
        delta: overdue > 0 ? `${overdue} past ETD` : null,
        up: overdue === 0,
        hint: "shipments not yet sailed",
        icon: "truck",
        spark: [],
      } satisfies HeroKpi;
    }),
  ]);

  return [sales, revenue, production, dispatch];
}

/**
 * The six-up strip beneath the headline figures.
 *
 * Two of the mockup's six had no schema behind them and are replaced rather
 * than faked: inventory *value* needs a cost on the item master (there is none,
 * so this reports quantity on hand), and gross margin needs the shipment P&L
 * join, which is unbounded and far too heavy for a dashboard — overdue
 * receivables occupies that slot instead. Low-stock has no substitute and is
 * rendered as an explicit gap.
 */
export async function getMiniStats(
  f: DashboardFilters,
  caps: DashboardCaps,
): Promise<Cell<MiniStatRow>[]> {
  const sb = await createClient();
  const w = rangeWindow(f.range);
  const t = today();

  const [orderCount, stock, indents, pos, overdueAr] = await Promise.all([
    cell(caps.orders, async () => {
      const [c, p] = await Promise.all([
        sb
          .from("sales_orders")
          .select("id", { count: "exact", head: true })
          .neq("status", "cancelled")
          .gte("created_at", `${w.from}T00:00:00Z`)
          .lt("created_at", `${addDays(w.to, 1)}T00:00:00Z`),
        sb
          .from("sales_orders")
          .select("id", { count: "exact", head: true })
          .neq("status", "cancelled")
          .gte("created_at", `${w.prevFrom}T00:00:00Z`)
          .lt("created_at", `${addDays(w.prevTo, 1)}T00:00:00Z`),
      ]);
      const d = delta(c.count ?? 0, p.count ?? 0);
      return {
        key: "orders",
        label: "Orders booked",
        value: fmtCompactNumber(c.count ?? 0),
        delta: d?.text ?? null,
        up: d?.up ?? true,
        icon: "clipboard-list",
        href: "/orders",
      } satisfies MiniStatRow;
    }),

    cell(caps.stores, async () => {
      const { data } = await sb.from("stock_balances").select("quantity").gt("quantity", 0);
      const total = rows({ data }).reduce((sum, r) => sum + n(r.quantity), 0);
      return {
        key: "stock",
        label: "Stock on hand",
        value: fmtCompactNumber(total),
        delta: null,
        up: true,
        icon: "warehouse",
        href: "/stores",
      } satisfies MiniStatRow;
    }),

    cell(caps.materials, async () => {
      const { count } = await sb
        .from("purchase_indents")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");
      return {
        key: "indents",
        label: "Open indents",
        value: fmtCompactNumber(count ?? 0),
        delta: null,
        up: (count ?? 0) === 0,
        icon: "file-text",
        href: "/purchase/indents",
      } satisfies MiniStatRow;
    }),

    cell(caps.materials, async () => {
      const { count } = await sb
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_approval");
      return {
        key: "pos",
        label: "POs awaiting approval",
        value: fmtCompactNumber(count ?? 0),
        delta: null,
        up: (count ?? 0) === 0,
        icon: "package",
        href: "/purchase/orders",
      } satisfies MiniStatRow;
    }),

    cell(caps.finance, async () => {
      const { data } = await sb
        .from("receivables")
        .select("amount_inr, received_fc, exchange_rate")
        .in("status", ["open", "partially_received", "overdue"])
        .lt("due_date", t);
      const total = rows({ data }).reduce(
        (sum, r) => sum + Math.max(0, n(r.amount_inr) - n(r.received_fc) * n(r.exchange_rate)),
        0,
      );
      return {
        key: "overdue-ar",
        label: "Overdue receivables",
        value: fmtCompactInr(total),
        delta: null,
        up: total === 0,
        icon: "circle-alert",
        href: "/finance/receivables",
      } satisfies MiniStatRow;
    }),
  ]);

  return [
    orderCount,
    stock,
    indents,
    pos,
    overdueAr,
    // No reorder level exists on the item master, so there is nothing to be
    // "below". Kept in place so the gap is visible rather than quietly missing.
    { ...NOT_TRACKED.reorder },
  ];
}

/* ------------------------------------------------------------------ *
 * Section 02 — trends
 * ------------------------------------------------------------------ */

/**
 * Everything on a fixed trailing-12-month axis.
 *
 * These deliberately ignore the range selector. The RPCs bucket by
 * `date_trunc('month', …)`, so a "today" trend would render as a single bar —
 * indistinguishable from a broken chart. Each card states its own period in the
 * subtitle instead, which is honest and costs nothing.
 */
export async function getTrends(
  f: DashboardFilters,
  caps: DashboardCaps,
): Promise<TrendsData> {
  const bucket = (r: Row[], a: string, b: string): TrendPoint[] =>
    r.map((x) => ({ label: monthLabel(s(x.month)), a: n(x[a]), b: n(x[b]) }));

  const [bundle, coreData, lineOutput] = await Promise.all([
    trendBundle(f.location, caps.reports),
    caps.orders ? core() : Promise.resolve(null),
    getLineOutput(caps),
  ]);
  const { sales: salesR, revenue: revenueR, purchase: purchaseR } = bundle;
  const { inventory: inventoryR, production: productionR } = bundle;

  const rev = revenueR.ok ? revenueR.value : [];
  const invoiced = rev.map((r) => n(r.invoiced_inr) + n(r.domestic_inr));
  const received = rev.map((r) => n(r.received_inr));
  // Year-on-year from the two halves of the same series, so no extra round-trip.
  const half = Math.floor(invoiced.length / 2);
  const older = invoiced.slice(0, half).reduce((a, b) => a + b, 0);
  const newer = invoiced.slice(half).reduce((a, b) => a + b, 0);

  const slices: StatusSlice[] = [];
  let total = 0;
  if (coreData) {
    const tones: Record<string, StatusSlice["tone"]> = {
      confirmed: "accent",
      in_production: "primary",
      shipped: "info",
      closed: "success",
    };
    for (const row of coreData.statusCounts) {
      if (row.status === "cancelled" || row.count === 0) continue;
      slices.push({
        label: row.status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        count: row.count,
        tone: tones[row.status] ?? "muted",
      });
      total += row.count;
    }
  }

  return {
    monthlySales: salesR.ok ? bucket(salesR.value, "units", "order_count") : [],
    revenue: {
      labels: rev.map((r) => monthLabel(s(r.month))),
      invoiced,
      received,
      yoy: older > 0 ? ((newer - older) / older) * 100 : null,
    },
    purchase: purchaseR.ok ? bucket(purchaseR.value, "po_value", "po_count") : [],
    inventory: inventoryR.ok ? bucket(inventoryR.value, "qty_in", "qty_out") : [],
    productionOutput: productionR.ok
      ? bucket(productionR.value, "good_qty", "reject_qty")
      : [],
    orderStatus: {
      slices,
      total,
      pendingAmendments: coreData?.pendingAmendments ?? 0,
    },
    lineOutput,
  };
}

/**
 * Stands in for the mockup's "Machine Utilisation".
 *
 * There is no machine master, no run hours and no downtime capture anywhere in
 * the schema, so utilisation cannot be computed at all. Output per production
 * line for today is the same shape of answer — who is producing, and how much —
 * from data that genuinely exists. The card says so.
 */
async function getLineOutput(
  caps: DashboardCaps,
): Promise<Cell<{ name: string; qty: number; pct: number }[]>> {
  return cell(caps.production, async () => {
    const sb = await createClient();
    const { data } = await sb
      .from("production_entries")
      .select("good_qty, production_lines(name)")
      .eq("entry_date", today())
      .eq("status", "confirmed");

    const byLine = new Map<string, number>();
    for (const r of rows({ data })) {
      const name = s(embed(r, "production_lines")?.name) || "Unassigned";
      byLine.set(name, (byLine.get(name) ?? 0) + n(r.good_qty));
    }
    const list = [...byLine.entries()]
      .map(([name, qty]) => ({ name, qty, pct: 0 }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);
    const max = Math.max(1, ...list.map((l) => l.qty));
    return list.map((l) => ({ ...l, pct: Math.round((l.qty / max) * 100) }));
  });
}

/* ------------------------------------------------------------------ *
 * Section 03 — manufacturing stages
 * ------------------------------------------------------------------ */

/**
 * Nine cards, six of which are real.
 *
 * `production_entries.stage` carries a CHECK constraint limiting it to
 * cutting / sewing / packing, so knitting, dyeing and finishing quantities
 * cannot exist in this database — no query would find them. Rather than drop
 * those cards (which hides the gap) or invent numbers (which is worse), they
 * keep their slot and say what is missing.
 */
export async function getManufacturing(
  f: DashboardFilters,
  caps: DashboardCaps,
): Promise<StageRow[]> {
  const sb = await createClient();
  const w = rangeWindow(f.range);

  const [stageAgg, knitting, consumption, packing, shipping] = await Promise.all([
    cell(caps.production, async () => {
      // Three numeric columns over one date range. If the entry volume ever
      // makes this heavy, the fix is a per-stage RPC, not a narrower range.
      const { data } = await sb
        .from("production_entries")
        .select("stage, good_qty, reject_qty")
        .eq("status", "confirmed")
        .gte("entry_date", w.from)
        .lte("entry_date", w.to);
      const acc: Record<string, { good: number; reject: number }> = {};
      for (const r of rows({ data })) {
        const k = s(r.stage);
        acc[k] ??= { good: 0, reject: 0 };
        acc[k].good += n(r.good_qty);
        acc[k].reject += n(r.reject_qty);
      }
      return acc;
    }),

    cell(caps.production, async () => {
      const { data, count } = await sb
        .from("knitting_programs")
        .select("planned_qty", { count: "exact" })
        .eq("status", "running");
      return {
        count: count ?? 0,
        planned: rows({ data }).reduce((t, r) => t + n(r.planned_qty), 0),
      };
    }),

    cell(caps.stores, async () => {
      const { data } = await sb
        .from("stock_ledger")
        .select("quantity, items!inner(category)")
        .eq("movement_type", "issue")
        .gte("created_at", `${w.from}T00:00:00Z`)
        .lt("created_at", `${addDays(w.to, 1)}T00:00:00Z`);
      const acc: Record<string, number> = {};
      for (const r of rows({ data })) {
        // items.category is free text on the master, so compare loosely.
        const cat = s(embed(r, "items")?.category).toLowerCase();
        if (cat) acc[cat] = (acc[cat] ?? 0) + n(r.quantity);
      }
      return acc;
    }),

    cell(caps.production, async () => {
      const { count } = await sb
        .from("packing_lists")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft");
      return count ?? 0;
    }),

    cell(caps.logistics, async () => {
      const [inTransit, docs] = await Promise.all([
        sb.from("shipments").select("id", { count: "exact", head: true }).eq("status", "shipped"),
        sb
          .from("shipments")
          .select("id", { count: "exact", head: true })
          .eq("status", "docs_ready"),
      ]);
      return { inTransit: inTransit.count ?? 0, docsReady: docs.count ?? 0 };
    }),
  ]);

  const stageCard = (key: string, name: string, icon: string): StageRow => {
    if (!stageAgg.ok) return { key, name, icon, data: stageAgg };
    const v = stageAgg.value[key] ?? { good: 0, reject: 0 };
    const totalQty = v.good + v.reject;
    const yieldPct = totalQty > 0 ? (v.good / totalQty) * 100 : 100;
    return {
      key,
      name,
      icon,
      data: {
        ok: true,
        value: {
          headline: `${fmtCompactNumber(v.good)} pcs`,
          sub: v.reject > 0 ? `${fmtCompactNumber(v.reject)} rejected` : "no rejects recorded",
          state: fmtPct(yieldPct, 0),
          tone: yieldPct >= 97 ? "success" : yieldPct >= 92 ? "warning" : "danger",
          pct: Math.round(yieldPct),
        },
      },
    };
  };

  const consumptionCard = (key: string, name: string, icon: string): StageRow => {
    if (!consumption.ok) return { key, name, icon, data: consumption };
    const qty = consumption.value[key] ?? 0;
    return {
      key,
      name,
      icon,
      data: {
        ok: true,
        value: {
          headline: fmtCompactNumber(qty),
          sub: `issued from stores this ${f.range === "today" ? "day" : f.range}`,
          state: qty > 0 ? "Issued" : "None",
          tone: "info",
          pct: qty > 0 ? 100 : 0,
        },
      },
    };
  };

  return [
    stageCard("cutting", "Cutting", "scissors"),
    stageCard("sewing", "Sewing", "factory"),
    stageCard("packing", "Packing", "package-check"),
    consumptionCard("yarn", "Yarn issued", "spool"),
    consumptionCard("fabric", "Fabric issued", "layers"),
    {
      key: "knitting",
      name: "Knitting programs",
      icon: "circle-dot",
      data: knitting.ok
        ? {
            ok: true,
            value: {
              headline: `${knitting.value.count} running`,
              // Programs record a plan, never a produced quantity — say "planned".
              sub: `${fmtCompactNumber(knitting.value.planned)} planned`,
              state: knitting.value.count > 0 ? "Running" : "Idle",
              tone: knitting.value.count > 0 ? "success" : "muted",
              pct: knitting.value.count > 0 ? 100 : 0,
            },
          }
        : knitting,
    },
    {
      key: "packing-lists",
      name: "Packing lists",
      icon: "clipboard-list",
      data: packing.ok
        ? {
            ok: true,
            value: {
              headline: `${packing.value} open`,
              sub: "awaiting finalisation",
              state: packing.value > 0 ? "Open" : "Clear",
              tone: packing.value > 0 ? "warning" : "success",
              pct: packing.value > 0 ? 60 : 100,
            },
          }
        : packing,
    },
    {
      key: "shipment",
      name: "Shipment",
      icon: "ship",
      data: shipping.ok
        ? {
            ok: true,
            value: {
              headline: `${shipping.value.inTransit} in transit`,
              sub: `${shipping.value.docsReady} docs ready`,
              state: shipping.value.inTransit > 0 ? "Sailing" : "None",
              tone: "info",
              pct: shipping.value.inTransit > 0 ? 100 : 0,
            },
          }
        : shipping,
    },
    { key: "dyeing", name: "Dyeing", icon: "droplets", data: { ...NOT_TRACKED.stage } },
    { key: "finishing", name: "Finishing", icon: "sparkles", data: { ...NOT_TRACKED.stage } },
    { key: "oee", name: "Machine efficiency", icon: "gauge", data: { ...NOT_TRACKED.machines } },
  ];
}

/* ------------------------------------------------------------------ *
 * Section 04 — approvals, activity, alerts
 * ------------------------------------------------------------------ */

const APPROVAL_HREF: Record<string, (id: string) => string> = {
  purchase_orders: (id) => `/purchase/orders/${id}`,
  material_requisitions: (id) => `/stores/requisitions/${id}`,
  payables: (id) => `/finance/payables/${id}`,
  order_amendments: () => `/orders/approve-amendments`,
  over_budget_confirmations: () => `/purchase/over-budget`,
  po_rate_amendments: () => `/purchase/rate-amendments`,
};

/**
 * Priority is DERIVED, not stored — no table in this schema carries one. Age
 * dominates value because a cheap document blocking a line for four days costs
 * more than an expensive one raised this morning. The UI labels it as derived.
 */
function priorityOf(ageDays: number, value: number | null): ApprovalRow["priority"] {
  const v = value ?? 0;
  if (ageDays > 3 || v > 2_000_000) return "Critical";
  if (ageDays > 2 || v > 500_000) return "High";
  if (ageDays > 1) return "Medium";
  return "Low";
}

function ageInDays(iso: string, now: Date): number {
  const then = new Date(iso);
  if (isNaN(then.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

/**
 * What is waiting on somebody, across six queues.
 *
 * There is no approvals table and no approver column anywhere in the schema, so
 * this is a union of the six documents that have a genuine approval transition,
 * a counterparty and (mostly) a value. Read-only by design: each row links to
 * the document, where the real approve action already lives with its own
 * permission check and audit trail. Approving from a summary row would mean
 * acting on a document you have not opened.
 *
 * Counts are exact — PostgREST returns the full count alongside a limited
 * select — so the header total is right even though only a few rows are shown.
 */
export async function getApprovals(caps: DashboardCaps): Promise<ApprovalsResult> {
  const sb = await createClient();
  const now = new Date();
  const LIMIT = 10;

  const queues = [
    {
      table: "purchase_orders",
      enabled: caps.materials,
      type: "Purchase Order",
      select: "id, code, total_amount, currency_code, created_at, vendors!vendor_id(name)",
      status: "pending_approval",
      party: (r: Row) => s(embed(r, "vendors")?.name) || null,
      value: (r: Row) => n(r.total_amount),
    },
    {
      table: "order_amendments",
      enabled: caps.orders,
      type: "Order Amendment",
      select: "id, amendment_type, profit_impact, created_at, sales_orders(order_number)",
      status: "pending",
      party: (r: Row) => s(embed(r, "sales_orders")?.order_number) || null,
      value: (r: Row) => n(r.profit_impact),
      ref: (r: Row) => s(r.amendment_type).replace(/_/g, " ") || "Amendment",
    },
    {
      table: "material_requisitions",
      enabled: caps.stores,
      type: "Material Requisition",
      select: "id, code, department, created_at",
      status: "submitted",
      party: (r: Row) => s(r.department) || null,
      value: () => null,
    },
    {
      table: "payables",
      enabled: caps.finance,
      type: "Vendor Bill",
      select: "id, code, total_amount, currency_code, created_at, vendors(name)",
      status: "draft",
      party: (r: Row) => s(embed(r, "vendors")?.name) || null,
      value: (r: Row) => n(r.total_amount),
    },
    {
      table: "over_budget_confirmations",
      enabled: caps.materials,
      type: "Over-Budget Confirmation",
      select: "id, code, description, quoted_rate, created_at",
      status: "submitted",
      party: (r: Row) => s(r.description) || null,
      value: (r: Row) => n(r.quoted_rate),
    },
    {
      table: "po_rate_amendments",
      enabled: caps.materials,
      type: "PO Rate Amendment",
      select: "id, code, revised_rate, created_at, purchase_orders(code)",
      status: "submitted",
      party: (r: Row) => s(embed(r, "purchase_orders")?.code) || null,
      value: (r: Row) => n(r.revised_rate),
    },
  ] as const;

  const results = await Promise.all(
    queues.map((q) =>
      cell(q.enabled, async () => {
        const { data, count } = await sb
          .from(q.table)
          .select(q.select, { count: "exact" })
          .eq("status", q.status)
          .order("created_at", { ascending: true })
          .limit(LIMIT);
        return { rows: rows({ data }), count: count ?? 0, q };
      }),
    ),
  );

  const all: ApprovalRow[] = [];
  let total = 0;

  for (const res of results) {
    if (!res.ok) continue;
    const { rows: qr, count, q } = res.value;
    total += count;
    for (const r of qr) {
      const id = s(r.id);
      const value = q.value(r);
      const ageDays = ageInDays(s(r.created_at), now);
      all.push({
        key: `${q.table}:${id}`,
        ref: "ref" in q && q.ref ? q.ref(r) : s(r.code) || "—",
        type: q.type,
        party: q.party(r),
        value,
        currency: s(r.currency_code) || "INR",
        priority: priorityOf(ageDays, value),
        ageDays,
        href: APPROVAL_HREF[q.table]?.(id) ?? "/",
      });
    }
  }

  // Oldest first: the queue is a backlog, and the top of it is what's blocking.
  all.sort((a, b) => b.ageDays - a.ageDays);
  return { rows: all.slice(0, 8), total };
}

/**
 * Recent activity, built from business tables rather than the audit log.
 *
 * `record_audit` and `audit_log` are both RLS-gated to system_admin:view, and
 * `record_audit` holds full jsonb snapshots of 19 tables including payroll —
 * widening it to everyone with a dashboard would leak salaries. Reading the
 * business tables instead means each source is already gated to its own module,
 * so the feed degrades per-permission with no extra work.
 *
 * The mockup's "who" column is deliberately not reproduced: `profiles` RLS is
 * `id = auth.uid() OR system_admin:view`, so an actor name would come back null
 * for every other user. The source module goes in that slot instead.
 */
export async function getActivity(caps: DashboardCaps): Promise<ActivityItem[]> {
  const sb = await createClient();

  const [orders, grns, prod, recv] = await Promise.all([
    cell(caps.orders, async () =>
      rows(
        await sb
          .from("sales_orders")
          .select("id, order_number, order_qty, created_at, buyers(name)")
          .order("created_at", { ascending: false })
          .limit(5),
      ),
    ),
    cell(caps.materials, async () =>
      rows(
        await sb
          .from("grns")
          .select("id, code, created_at, vendors(name)")
          .eq("status", "posted")
          .order("created_at", { ascending: false })
          .limit(5),
      ),
    ),
    cell(caps.production, async () =>
      rows(
        await sb
          .from("production_entries")
          .select("id, stage, good_qty, created_at, sales_orders(order_number), production_lines(name)")
          .eq("status", "confirmed")
          .order("created_at", { ascending: false })
          .limit(5),
      ),
    ),
    cell(caps.finance, async () =>
      rows(
        await sb
          .from("receivables")
          .select("id, code, invoice_no, amount_inr, created_at, buyers(name)")
          .order("created_at", { ascending: false })
          .limit(5),
      ),
    ),
  ]);

  const items: ActivityItem[] = [];

  if (orders.ok)
    for (const r of orders.value)
      items.push({
        key: `so:${s(r.id)}`,
        title: "Sales order booked",
        ref: s(r.order_number) || null,
        href: `/orders/${s(r.id)}`,
        detail: `${s(embed(r, "buyers")?.name) || "Buyer"} · ${fmtCompactNumber(n(r.order_qty))} pcs`,
        source: "Orders",
        at: s(r.created_at),
        tone: "primary",
      });

  if (grns.ok)
    for (const r of grns.value)
      items.push({
        key: `grn:${s(r.id)}`,
        title: "Goods received",
        ref: s(r.code) || null,
        href: `/purchase/grn`,
        detail: s(embed(r, "vendors")?.name) || "Vendor receipt posted",
        source: "Stores",
        at: s(r.created_at),
        tone: "success",
      });

  if (prod.ok)
    for (const r of prod.value)
      items.push({
        key: `pe:${s(r.id)}`,
        title: `${s(r.stage).replace(/^\w/, (c) => c.toUpperCase())} confirmed`,
        ref: s(embed(r, "sales_orders")?.order_number) || null,
        href: `/production`,
        detail: `${fmtCompactNumber(n(r.good_qty))} pcs good`,
        source: s(embed(r, "production_lines")?.name)
          ? `Production — ${s(embed(r, "production_lines")?.name)}`
          : "Production",
        at: s(r.created_at),
        tone: "info",
      });

  if (recv.ok)
    for (const r of recv.value)
      items.push({
        key: `ar:${s(r.id)}`,
        title: "Invoice raised",
        ref: s(r.invoice_no) || s(r.code) || null,
        href: `/finance/receivables`,
        detail: `${fmtCompactInr(n(r.amount_inr))} · ${s(embed(r, "buyers")?.name) || "Buyer"}`,
        source: "Finance",
        at: s(r.created_at),
        tone: "accent",
      });

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 6);
}

/**
 * Things that need somebody to look at them.
 *
 * The mockup's machine-breakdown and shade-variation alerts have no capture
 * behind them and are simply not here — an alert panel that invents incidents
 * is worse than one with five entries. Every alert below is a real query, and
 * each is skipped rather than errored when the viewer lacks the module.
 */
export async function getAlerts(caps: DashboardCaps): Promise<AlertItem[]> {
  const sb = await createClient();
  const t = today();

  const [coreData, latePos, failedQc, lateShipments, overdueAr] = await Promise.all([
    caps.orders ? core() : Promise.resolve(null),
    cell(caps.materials, async () =>
      rows(
        await sb
          .from("purchase_orders")
          .select("id, code, expected_date, vendors!vendor_id(name)")
          .in("status", ["approved", "partially_received"])
          .lt("expected_date", t)
          .order("expected_date", { ascending: true })
          .limit(3),
      ),
    ),
    cell(caps.materials, async () =>
      rows(
        await sb
          .from("grn_line_items")
          .select("id, description, rejected_qty, qc_status, grns!inner(code, status)")
          .in("qc_status", ["failed", "partial"])
          .eq("grns.status", "posted")
          .limit(3),
      ),
    ),
    cell(caps.logistics, async () =>
      rows(
        await sb
          .from("shipments")
          .select("id, code, etd, buyers(name)")
          .in("status", ["planning", "docs_ready"])
          .lt("etd", t)
          .order("etd", { ascending: true })
          .limit(3),
      ),
    ),
    cell(caps.finance, async () =>
      rows(
        await sb
          .from("receivables")
          .select("id, code, invoice_no, due_date, amount_inr, buyers(name)")
          .in("status", ["open", "partially_received", "overdue"])
          .lt("due_date", t)
          .order("due_date", { ascending: true })
          .limit(3),
      ),
    ),
  ]);

  const out: AlertItem[] = [];

  if (coreData && coreData.overdueCount > 0) {
    out.push({
      key: "milestones",
      title: `${coreData.overdueCount} overdue milestone(s)`,
      body: "T&A milestones past their planned date and not marked done.",
      href: "/orders",
      tone: "danger",
      icon: "triangle-alert",
    });
  }

  if (latePos.ok)
    for (const r of latePos.value)
      out.push({
        key: `po:${s(r.id)}`,
        title: `Supplier delay — ${s(embed(r, "vendors")?.name) || "vendor"}`,
        body: `${s(r.code)} was expected ${s(r.expected_date)} and is not fully received.`,
        href: "/purchase/orders",
        tone: "warning",
        icon: "package-x",
      });

  if (failedQc.ok)
    for (const r of failedQc.value)
      out.push({
        key: `qc:${s(r.id)}`,
        title: `QC ${s(r.qc_status)} — ${s(embed(r, "grns")?.code)}`,
        body: `${s(r.description)} · ${fmtCompactNumber(n(r.rejected_qty))} rejected.`,
        href: "/purchase/grn",
        tone: "danger",
        icon: "badge-alert",
      });

  if (lateShipments.ok)
    for (const r of lateShipments.value)
      out.push({
        key: `shp:${s(r.id)}`,
        title: `Shipment past ETD — ${s(r.code)}`,
        body: `${s(embed(r, "buyers")?.name) || "Buyer"} · ETD ${s(r.etd)}, not yet sailed.`,
        href: "/logistics",
        tone: "warning",
        icon: "ship",
      });

  if (overdueAr.ok)
    for (const r of overdueAr.value)
      out.push({
        key: `ar:${s(r.id)}`,
        title: `Payment overdue — ${s(embed(r, "buyers")?.name) || "buyer"}`,
        body: `${s(r.invoice_no) || s(r.code)} · ${fmtCompactInr(n(r.amount_inr))} due ${s(r.due_date)}.`,
        href: "/finance/receivables",
        tone: "danger",
        icon: "circle-alert",
      });

  return out.slice(0, 6);
}

/* ------------------------------------------------------------------ *
 * Section 05 — leaderboards
 * ------------------------------------------------------------------ */

/**
 * Top customers, products and suppliers over the selected range.
 *
 * Suppliers has no RPC (0042 stopped at customers and products), so it is
 * aggregated in JS from purchase_orders — which also means its total is a
 * MIXED-CURRENCY sum, exactly as the existing /analytics page already warns.
 * The card note says so rather than leaving the reader to assume rupees.
 */
export async function getLeaderboards(
  f: DashboardFilters,
  caps: DashboardCaps,
): Promise<Leaderboard[]> {
  const sb = await createClient();
  const w = rangeWindow(f.range);
  const args = { p_from: w.from, p_to: w.to, p_location: f.location };

  const scale = (list: { name: string; raw: number; value: string }[]): LeaderRow[] => {
    const max = Math.max(1, ...list.map((l) => l.raw));
    return list.map((l) => ({
      name: l.name,
      value: l.value,
      pct: Math.round((l.raw / max) * 100),
    }));
  };

  const [customers, products, suppliers] = await Promise.all([
    cell(caps.reports, async () => {
      const r = await rpc(sb, "analytics_top_customers", args);
      return scale(
        r.slice(0, 4).map((x) => ({
          name: s(x.buyer_name) || "—",
          raw: n(x.revenue_inr),
          value: fmtCompactInr(n(x.revenue_inr)),
        })),
      );
    }),
    cell(caps.reports, async () => {
      const r = await rpc(sb, "analytics_top_products", args);
      return scale(
        r.slice(0, 4).map((x) => ({
          name: s(x.label) || "—",
          raw: n(x.units),
          value: `${fmtCompactNumber(n(x.units))} pcs`,
        })),
      );
    }),
    cell(caps.materials, async () => {
      const { data } = await sb
        .from("purchase_orders")
        .select("total_amount, vendors!vendor_id(name)")
        .neq("status", "cancelled")
        .gte("order_date", w.from)
        .lte("order_date", w.to);
      const byVendor = new Map<string, number>();
      for (const r of rows({ data })) {
        const name = s(embed(r, "vendors")?.name) || "—";
        byVendor.set(name, (byVendor.get(name) ?? 0) + n(r.total_amount));
      }
      return scale(
        [...byVendor.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([name, v]) => ({ name, raw: v, value: fmtCompactInr(v) })),
      );
    }),
  ]);

  return [
    { key: "customers", title: "Top Customers", note: "revenue invoiced", rows: customers },
    {
      key: "products",
      // NOT "best selling fabrics": analytics_top_products labels rows by
      // colour + size, which is not a fabric. Naming it accurately costs
      // nothing; naming it wrongly makes a merchandiser distrust the number.
      title: "Top Colour / Size",
      note: "units ordered",
      rows: products,
    },
    { key: "suppliers", title: "Top Suppliers", note: "PO value · mixed currency", rows: suppliers },
  ];
}
