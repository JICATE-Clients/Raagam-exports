import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { budgetFiguresOf, getOrderBudget } from "@/lib/orders/budget/service";
import { compareToBaseline, kpisFromJson, type BaselineRow, type BudgetKpis } from "@/lib/orders/budget/amendment";
import type { BudgetBaseline } from "@/lib/orders/budget/amendment";
import { isRefusal, type Refusal } from "@/lib/orders/budget/totals";
import { listFabricBomTasks } from "@/lib/orders/fabric-bom/service";
import { listMaterialBomTasks } from "@/lib/orders/material-bom-amendment/service";
import type { BomStatus } from "@/lib/orders/bom-status";
import { getRunForSubject, getTimeline } from "@/lib/approvals/service";
import type { ApprovalRun, TimelineRow } from "@/lib/approvals/types";
import {
  entryStatusOf,
  marginDelta,
  scopeFromJson,
  type AmendmentEntryStatus,
  type FrozenScope,
  type MarginDelta,
} from "@/lib/orders/amendments/amendment-entry";

/**
 * ORDERS ▸ ORDER AMENDMENTS — the register and the entry page's readers.
 *
 * The Amendment Entry is `order_budget_revisions` (0604 · 0616): the row Budget
 * ▸ Reopen has written since 0576, extended with the entry no, the order it is
 * against, the frozen scope and the V0 snapshot. There is no `status` column —
 * the register's Status is DERIVED from the entry's `outcome` and its budget's
 * `status` (`entryStatusOf`), so it cannot drift from the budget's own life:
 * a budget with the approver IS a pending amendment.
 *
 * The Margin Delta is two stored `budgetKpis` compared: the entry's `baseline`
 * (frozen when it opened) against the budget's `submitted_summary` (frozen at
 * submit). Nothing here computes a profit — `budgetFiguresOf` does, once, for
 * the live side-by-side on the entry page.
 */

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

export type AmendmentRegisterRow = {
  id: string;
  entry_no: string | null;
  /** The order document the entry is against; null for Budget ▸ Reopen entries. */
  garment_order_id: string | null;
  order_code: string | null;
  re_no: string | null;
  customer_name: string | null;
  /** Amend #n — this order's nth entry, oldest first. */
  amend_no: number;
  origin: string;
  types: string[];
  remarks: string;
  outcome: string;
  status: AmendmentEntryStatus;
  budget_id: string | null;
  budget_code: string | null;
  budget_status: string | null;
  margin: MarginDelta;
  /** When the entry was raised — `reopened_at`. */
  created_at: string;
  created_by: string | null;
  closed_at: string | null;
};

type RevisionRow = {
  id: string;
  entry_no: string | null;
  garment_order_id: string | null;
  budget_id: string | null;
  source: string;
  amendment_type: string;
  amendment_types: string[] | null;
  reason: string;
  baseline: unknown;
  outcome: string;
  reopened_at: string;
  reopened_by: string | null;
  closed_at: string | null;
  scope: unknown;
  order:
    | {
        id: string;
        code: string | null;
        customer: { name: string | null } | { name: string | null }[] | null;
        sales_order: { order_number: string | null } | { order_number: string | null }[] | null;
      }
    | null;
  budget: { id: string; code: string | null; status: string; submitted_summary: unknown } | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The entry's select — A LITERAL AT THE CALL SITE, not a shared const, so
 * `check:embeds` can read it (it looks at the lines after `.from(...)`).
 *
 * `!garment_order_id` NAMES THE FK: `order_budget_revisions` and
 * `garment_order_amendments` point at each other (the entry's garment_order_id,
 * the document's re_amendment_id), so a bare embed is the PGRST201 ambiguity
 * AGENTS.md records — in both directions. The budget has one FK and stays bare.
 */
function revisionQuery(s: Awaited<ReturnType<typeof createClient>>) {
  return s
    .from("order_budget_revisions")
    .select(
      "id, entry_no, garment_order_id, budget_id, source, amendment_type, amendment_types, reason, " +
        "baseline, outcome, reopened_at, reopened_by, closed_at, scope, " +
        "order:garment_order_amendments!garment_order_id(id, code, customer:customers(name), sales_order:sales_orders(order_number)), " +
        "budget:order_budgets(id, code, status, submitted_summary)",
    );
}

function shapeRow(r: RevisionRow, amendNo: number): AmendmentRegisterRow {
  const types = r.amendment_types?.length ? r.amendment_types : [r.amendment_type];
  const baseline = (r.baseline as Partial<BudgetBaseline> | null) ?? null;
  return {
    id: r.id,
    entry_no: r.entry_no,
    garment_order_id: r.garment_order_id,
    order_code: r.order?.code ?? null,
    re_no: one(r.order?.sales_order)?.order_number ?? null,
    customer_name: one(r.order?.customer)?.name ?? null,
    amend_no: amendNo,
    origin: r.source,
    types,
    remarks: r.reason,
    outcome: r.outcome,
    status: entryStatusOf({ outcome: r.outcome, budgetStatus: r.budget?.status }),
    budget_id: r.budget?.id ?? r.budget_id,
    budget_code: r.budget?.code ?? null,
    budget_status: r.budget?.status ?? null,
    margin: marginDelta({ baselineKpis: baseline?.kpis, submittedKpis: r.budget?.submitted_summary }),
    /* `reopened_at` is the entry's date; named `created_at` so
       `withCreatedColumns` finds it, with `reopened_by` as `created_by`. */
    created_at: r.reopened_at,
    created_by: r.reopened_by,
    closed_at: r.closed_at,
  };
}

/**
 * Every Amendment Entry, in ENTRY order (1, 2, 3 — the app-wide listing rule),
 * each numbered as its order's nth. Budget ▸ Reopen entries (no order) are
 * listed too: they are amendments of the same budget, and hiding them would
 * hide who undid an approval.
 */
export async function listAmendmentEntries(): Promise<AmendmentRegisterRow[]> {
  const s = await createClient();
  const { data, error } = await revisionQuery(s).order("reopened_at", { ascending: true });
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
  if (error) throw new Error(`Could not read the amendments: ${error.message}`);
  const rows = (data ?? []) as unknown as RevisionRow[];
  const seen = new Map<string, number>();
  const shaped = rows.map((r) => {
    const key = r.garment_order_id ?? `budget:${r.budget_id}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return shapeRow(r, n);
  });
  return withCreators(shaped);
}

// ---------------------------------------------------------------------------
// The approved orders an amendment can be raised on
// ---------------------------------------------------------------------------

export type AmendableOrder = {
  id: string;
  code: string | null;
  re_no: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  /** The approved budget locking it — what the entry will reopen. */
  budget_code: string | null;
  approved_at: string | null;
  /**
   * Already AMENDING (0618): the open entry a new raise would SUPERSEDE, its
   * categories carried into the new entry's union. Null on an approved order.
   */
  amending: { entry_id: string; entry_no: string | null; types: string[] } | null;
};

/**
 * APPROVED orders, and orders already AMENDING (0618: a second raise supersedes
 * the open entry and adds categories). An OPEN order is never offered — it
 * needs no amendment, it is edited directly — and offering it would be the
 * "blank supply type → every vendor" leak; the empty state says why instead.
 */
export async function listAmendableOrders(): Promise<AmendableOrder[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("garment_order_amendments")
    .select(
      "id, code, delivery_date, re_status, re_status_at, customer:customers(name), sales_order:sales_orders(order_number), " +
        "budgets:order_budget_orders(budget:order_budgets(code, status, decided_at)), " +
        /* `!re_amendment_id`: the two tables point at each other — see revisionQuery. */
        "entry:order_budget_revisions!re_amendment_id(id, entry_no, amendment_type, amendment_types, outcome, baseline_approved_at, budget:order_budgets(code))",
    )
    .in("re_status", ["approved", "amending"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the approved orders: ${error.message}`);
  type Entry = {
    id: string;
    entry_no: string | null;
    amendment_type: string;
    amendment_types: string[] | null;
    outcome: string;
    baseline_approved_at: string | null;
    budget: { code: string | null } | { code: string | null }[] | null;
  };
  type Row = {
    id: string;
    code: string | null;
    delivery_date: string | null;
    re_status: string;
    customer: { name: string | null } | { name: string | null }[] | null;
    sales_order: { order_number: string | null } | { order_number: string | null }[] | null;
    budgets: { budget: { code: string | null; status: string; decided_at: string | null } | null }[] | null;
    entry: Entry | Entry[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const approved = (r.budgets ?? []).map((b) => b.budget).find((b) => b?.status === "approved") ?? null;
    const e = r.re_status === "amending" ? one(r.entry) : null;
    return {
      id: r.id,
      code: r.code,
      re_no: one(r.sales_order)?.order_number ?? null,
      customer_name: one(r.customer)?.name ?? null,
      delivery_date: r.delivery_date,
      budget_code: approved?.code ?? one(e?.budget)?.code ?? null,
      approved_at: approved?.decided_at ?? e?.baseline_approved_at ?? null,
      amending: e
        ? {
            entry_id: e.id,
            entry_no: e.entry_no,
            types: e.amendment_types?.length ? e.amendment_types : [e.amendment_type],
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// One entry, whole — the entry page
// ---------------------------------------------------------------------------

export type AmendmentChange = {
  table_name: string;
  area: string;
  rows_added: number;
  rows_removed: number;
  rows_changed: number;
  changed_columns: string[] | null;
};

export type DownstreamDoc = {
  key: "fabric_bom" | "material_bom";
  label: string;
  status: BomStatus;
  bom_id: string | null;
  /** The quantity the document was computed for, when it says. */
  computed_for_qty: number | null;
  href: string;
};

export type AmendmentEntryDetail = {
  row: AmendmentRegisterRow;
  scope: FrozenScope;
  /** Frozen at open (the money) — the left column of the variance matrix. */
  baseline: BudgetBaseline | null;
  baselineKpis: BudgetKpis | null;
  /** The budget's figures NOW — the right column. Null when it cannot be read. */
  currentKpis: BudgetKpis | null;
  currentRefusal: string | null;
  variance: BaselineRow[];
  /** Order-level side-by-side: quantity and delivery from the two KPI sets. */
  changes: AmendmentChange[];
  downstream: DownstreamDoc[];
  run: ApprovalRun | null;
  timeline: TimelineRow[];
  names: Record<string, string>;
  /** Whether the current operator may act. */
  perms: { canEdit: boolean };
};

async function namesOf(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = [...new Set(ids.filter((v): v is string => !!v))];
  if (list.length === 0) return {};
  const s = await createClient();
  const { data } = await s.rpc("creator_names", { ids: list });
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) out[p.id] = p.full_name;
  }
  return out;
}

export async function getAmendmentEntry(id: string, canEdit: boolean): Promise<AmendmentEntryDetail | null> {
  const s = await createClient();
  const { data, error } = await revisionQuery(s).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the amendment: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as RevisionRow;

  /* Amend #n — its order's entries before it, counted. */
  let amendNo = 1;
  if (r.garment_order_id) {
    const { count } = await s
      .from("order_budget_revisions")
      .select("id", { count: "exact", head: true })
      .eq("garment_order_id", r.garment_order_id)
      .lte("reopened_at", r.reopened_at);
    amendNo = Math.max(1, count ?? 1);
  }
  const row = (await withCreators([shapeRow(r, amendNo)]))[0];

  const baseline = (r.baseline as BudgetBaseline | null) ?? null;
  const baselineKpis = kpisFromJson(baseline?.kpis);

  /* THE RIGHT COLUMN: the budget's figures now, from the SAME assembler the
     budget screen and submit use. A budget that cannot be read leaves the
     column saying why rather than blank. */
  let currentKpis: BudgetKpis | null = null;
  let currentRefusal: string | null = null;
  let variance: BaselineRow[] = [];
  if (row.budget_id) {
    try {
      const budget = await getOrderBudget(row.budget_id);
      if (!budget) currentRefusal = "The budget no longer exists";
      else {
        const figures = await budgetFiguresOf(budget);
        currentKpis = figures.kpis;
        if (baseline) variance = compareToBaseline(baseline, figures.general);
      }
    } catch (e) {
      currentRefusal = e instanceof Error ? e.message : "The budget's figures could not be worked out";
    }
  }

  const [changes, downstream, run, names] = await Promise.all([
    readChanges(id),
    r.garment_order_id ? readDownstream(r.garment_order_id) : Promise.resolve([]),
    row.budget_id ? getRunForSubject("order_budgets", row.budget_id).catch(() => null) : Promise.resolve(null),
    namesOf([r.reopened_by]),
  ]);
  const timeline = run ? await getTimeline(run.id).catch(() => []) : [];
  const actorNames = await namesOf(timeline.map((t) => t.actor_id));

  return {
    row,
    scope: scopeFromJson(r.scope),
    baseline,
    baselineKpis,
    currentKpis,
    currentRefusal,
    variance,
    changes,
    downstream,
    run,
    timeline,
    names: { ...names, ...actorNames },
    perms: { canEdit },
  };
}

async function readChanges(entryId: string): Promise<AmendmentChange[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("order_amendment_changes", { p_entry: entryId });
  if (error) throw new Error(`Could not compare the order to its approved version: ${error.message}`);
  return (data ?? []) as AmendmentChange[];
}

/**
 * THE PROPAGATION PANEL's facts (spec §3, as decided: stale-and-gate, never a
 * silent recompute). Each BOM's status is `bomStatusOf` — `recalculate` when
 * the order moved under it — read from the same queue readers the BOM screens
 * use, so the panel and the screens cannot disagree about what is stale.
 */
async function readDownstream(orderId: string): Promise<DownstreamDoc[]> {
  const [fabric, material] = await Promise.all([listFabricBomTasks(), listMaterialBomTasks()]);
  const f = fabric.find((t) => t.id === orderId);
  const m = material.find((t) => t.id === orderId);
  return [
    {
      key: "fabric_bom",
      label: "Fabric BOM",
      status: f?.status ?? "unresolved",
      bom_id: f?.bom_id ?? null,
      computed_for_qty: null,
      href: f?.bom_id ? `/orders/fabric-bom?open=${f.bom_id}` : "/orders/fabric-bom",
    },
    {
      key: "material_bom",
      label: "Material BOM",
      status: m?.status ?? "unresolved",
      bom_id: m?.bom_id ?? null,
      computed_for_qty: null,
      href: m?.bom_id ? `/orders/material-bom?open=${m.bom_id}` : "/orders/material-bom",
    },
  ];
}

/** The margin figure for a notification line, never a blank. */
export function marginText(v: number | Refusal): string {
  return isRefusal(v) ? `unknown (${v.refused})` : `${v.toFixed(2)}%`;
}
