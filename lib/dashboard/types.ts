/**
 * Shapes for the executive dashboard (app/(app)/(dashboard)).
 *
 * The organising idea is `Cell<T>`: a tile's data is either present, or it is
 * absent *for a stated reason*. The dashboard covers modules a given user may
 * not hold, over tables that in some cases do not exist yet, so "no number" is
 * the normal case rather than the error case — and the three reasons it happens
 * need to look different on screen. A `0` where the answer is "you don't have
 * finance access" is a lie the operator cannot detect.
 */

export type DashboardRange = "today" | "week" | "month";

export const DASHBOARD_RANGES: DashboardRange[] = ["today", "week", "month"];

export const RANGE_LABELS: Record<DashboardRange, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
};

export interface DashboardFilters {
  range: DashboardRange;
  /** null = all locations. */
  location: string | null;
}

/** Calendar window for a range, plus the equal-length preceding window for deltas. */
export interface RangeWindow {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

export type CellReason =
  /** The viewer lacks the module permission, or an RPC raised 42501. */
  | "denied"
  /** No schema exists to answer this — an honest product gap, not a fault. */
  | "not_tracked"
  /** The query failed. Isolated so one bad tile cannot blank the page. */
  | "error";

export type Cell<T> =
  | { ok: true; value: T }
  | { ok: false; reason: CellReason; note?: string };

/** Tones map to the CSS custom properties in app/globals.css. */
export type DashboardTone =
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "pos"
  | "muted";

/** Which modules the viewer can see. Resolved once per request. */
export interface DashboardCaps {
  orders: boolean;
  sales: boolean;
  reports: boolean;
  finance: boolean;
  production: boolean;
  materials: boolean;
  stores: boolean;
  logistics: boolean;
  systemAdmin: boolean;
}

// ---------- section 00: hero ----------

export interface PulseRing {
  label: string;
  note: string;
  pct: number;
  tone: DashboardTone;
}

// ---------- section 01: performance ----------

export interface HeroKpi {
  key: string;
  label: string;
  value: string;
  /** Signed percentage vs the previous equal-length window, already formatted. */
  delta: string | null;
  up: boolean;
  hint: string;
  icon: string;
  /** Monthly tail of the 12-month trend — never range-scoped, see service notes. */
  spark: number[];
}

export interface MiniStatRow {
  key: string;
  label: string;
  value: string;
  delta: string | null;
  up: boolean;
  icon: string;
  href?: string;
}

// ---------- section 02: analytics ----------

export interface TrendPoint {
  label: string;
  a: number;
  b: number;
}

export interface StatusSlice {
  label: string;
  count: number;
  tone: DashboardTone;
}

export interface TrendsData {
  monthlySales: TrendPoint[];
  revenue: { labels: string[]; invoiced: number[]; received: number[]; yoy: number | null };
  purchase: TrendPoint[];
  inventory: TrendPoint[];
  productionOutput: TrendPoint[];
  orderStatus: { slices: StatusSlice[]; total: number; pendingAmendments: number };
  /** Today's confirmed output per production line — stands in for machine utilisation. */
  lineOutput: Cell<{ name: string; qty: number; pct: number }[]>;
}

// ---------- section 03: manufacturing ----------

export interface StageData {
  /** The big number on the card. Named `headline`, not `value`, so it doesn't
   *  read as `cell.value.value` at every call site. */
  headline: string;
  sub: string;
  state: string;
  tone: DashboardTone;
  pct: number;
}

export interface StageRow {
  key: string;
  name: string;
  icon: string;
  /** Not-ok when the stage isn't tracked — the card renders <NotTracked> instead. */
  data: Cell<StageData>;
}

// ---------- section 04: approvals & activity ----------

export interface ApprovalRow {
  key: string;
  ref: string;
  type: string;
  party: string | null;
  value: number | null;
  currency: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  ageDays: number;
  href: string;
}

export interface ApprovalsResult {
  rows: ApprovalRow[];
  /** Exact total across every permitted queue, not just the rows shown. */
  total: number;
}

export interface ActivityItem {
  key: string;
  title: string;
  ref: string | null;
  href: string | null;
  detail: string;
  /** Module or line, not a person — see the profiles-RLS note in the service. */
  source: string;
  at: string;
  tone: DashboardTone;
}

export interface AlertItem {
  key: string;
  title: string;
  body: string;
  href: string | null;
  tone: DashboardTone;
  icon: string;
}

// ---------- section 05: quick actions & leaderboards ----------

export interface LeaderRow {
  name: string;
  value: string;
  pct: number;
}

export interface Leaderboard {
  key: string;
  title: string;
  note: string;
  rows: Cell<LeaderRow[]>;
}
