import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { budgetFiguresOf, getOrderBudget } from "@/lib/orders/budget/service";
import { compareToBaseline, kpisFromJson, type BaselineRow, type BudgetKpis } from "@/lib/orders/budget/amendment";
import type { BudgetBaseline } from "@/lib/orders/budget/amendment";
import { isRefusal, type Refusal } from "@/lib/orders/budget/totals";
import { listFabricBomTasks } from "@/lib/orders/fabric-bom/service";
import { recalculateFabricBomDerived } from "@/lib/orders/fabric-bom/actions";
import { recalculateMaterialBomDerived } from "@/lib/orders/material-bom-amendment/actions";
import { listMaterialBomTasks } from "@/lib/orders/material-bom-amendment/service";
import type { BomStatus } from "@/lib/orders/bom-status";
import { getRunForSubject, getTimeline } from "@/lib/approvals/service";
import type { ApprovalRun, TimelineRow } from "@/lib/approvals/types";
import { budgetLineKey } from "@/lib/orders/budget/amendment-scope";
import { orderChangesSince, type OrderFieldChange } from "./order-changes";
import { manualEntryMessage, moduleOfBudgetSource, type ManualEntryItem } from "@/lib/orders/amendments/manual-entry";
import {
  entryScopeLabel,
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
  /** What changes inside each other module (0630) — read with `entryScopeLabel(types, details)`. */
  details: string[];
  remarks: string;
  outcome: string;
  status: AmendmentEntryStatus;
  budget_id: string | null;
  budget_code: string | null;
  budget_status: string | null;
  margin: MarginDelta;
  /** The MD's reason, on a rejected entry (0619). */
  rejection_reason: string | null;
  /** Why a reject could not revert the order (0619) — the entry stays open. */
  revert_error: string | null;
  /** When the revised budget went to the MD. */
  submitted_at: string | null;
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
  module_details: string[] | null;
  reason: string;
  baseline: unknown;
  outcome: string;
  reopened_at: string;
  reopened_by: string | null;
  closed_at: string | null;
  scope: unknown;
  rejection_reason: string | null;
  revert_error: string | null;
  amended_kpis: unknown;
  submitted_at: string | null;
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
      "id, entry_no, garment_order_id, budget_id, source, amendment_type, amendment_types, module_details, reason, " +
        "baseline, outcome, reopened_at, reopened_by, closed_at, scope, " +
        "rejection_reason, revert_error, amended_kpis, submitted_at, " +
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
    details: r.module_details ?? [],
    remarks: r.reason,
    outcome: r.outcome,
    status: entryStatusOf({ outcome: r.outcome, budgetStatus: r.budget?.status }),
    budget_id: r.budget?.id ?? r.budget_id,
    budget_code: r.budget?.code ?? null,
    budget_status: r.budget?.status ?? null,
    /* THE ENTRY'S OWN SUBMITTED FIGURES FIRST (0619): a reject reverts the
       budget to V0, so its `submitted_summary` would then describe the
       approved version, not the one the MD refused. */
    margin: marginDelta({
      baselineKpis: baseline?.kpis,
      submittedKpis: r.amended_kpis ?? (r.outcome === "open" || r.outcome === "reapproved" ? r.budget?.submitted_summary : null),
    }),
    rejection_reason: r.rejection_reason,
    revert_error: r.revert_error,
    submitted_at: r.submitted_at,
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
  /** When it was last worked out — the "why" of a Recalculate. */
  computed_at: string | null;
  /** What the order needs NOW (the queue's production total). */
  order_qty_now: number | null;
  /**
   * WHAT WOULD STOP A RECALCULATION (2026-09-23, screenshot 3031): a dry run
   * of the derived-only recalculation, nothing written. Empty = pressing
   * Recalculate will finish the job; otherwise these are the order's own gaps
   * (a colourway with no size break-up …) to fill FIRST.
   */
  blockers: string[];
  href: string;
};

export type AmendmentEntryDetail = {
  row: AmendmentRegisterRow;
  scope: FrozenScope;
  /** Frozen at open (the money) — the LAST BUDGET, the version approved just before this entry. */
  baseline: BudgetBaseline | null;
  baselineKpis: BudgetKpis | null;
  /** The ORIGINAL BUDGET (V0): the baseline the order's first entry froze. Same as `baselineKpis` on Rev #1. */
  originalKpis: BudgetKpis | null;
  /** The budget's figures NOW — the LATEST BUDGET. Null when it cannot be read. */
  currentKpis: BudgetKpis | null;
  currentRefusal: string | null;
  /** Last → Latest, row by row. */
  variance: BaselineRow[];
  /** V0's figure per variance row key. */
  original: Partial<Record<BaselineRow["key"], number | Refusal>>;
  /** Order-level side-by-side: quantity and delivery from the two KPI sets. */
  changes: AmendmentChange[];
  downstream: DownstreamDoc[];
  /**
   * "⚠️ Manual Entry Needed" (spec §3.2, 0619): every input the revised budget
   * still lacks — a new trim, fabric process or colourway's line with no rate
   * — in the spec's sentence, each with a deep link to its exact cell.
   */
  manualEntries: ManualEntryItem[];
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

  /* THE ORIGINAL BUDGET (V0) — what the order was FIRST approved at. Every
     entry freezes the version approved just before it (`baseline` above, the
     "Last Budget"), so V0 is the baseline the order's FIRST entry froze. On
     Rev #1 the two are the same record; they part from Rev #2 on, once a
     revision has itself been approved. A superseding raise copies its
     predecessor's baseline, so the earliest entry is V0 whichever it is. */
  let original: BudgetBaseline | null = baseline;
  if (amendNo > 1 && r.garment_order_id) {
    const { data: first, error: firstErr } = await s
      .from("order_budget_revisions")
      .select("baseline")
      .eq("garment_order_id", r.garment_order_id)
      .not("baseline", "is", null)
      .order("reopened_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstErr) throw new Error(`Could not read the original budget: ${firstErr.message}`);
    original = ((first?.baseline as BudgetBaseline | null) ?? null) || baseline;
  }
  const originalKpis = kpisFromJson(original?.kpis);

  /* THE RIGHT COLUMN: the budget's figures now, from the SAME assembler the
     budget screen and submit use. A budget that cannot be read leaves the
     column saying why rather than blank. */
  let currentKpis: BudgetKpis | null = null;
  let currentRefusal: string | null = null;
  let variance: BaselineRow[] = [];
  let originalRows: BaselineRow[] = [];
  let manualEntries: ManualEntryItem[] = [];
  if (row.budget_id) {
    try {
      const budget = await getOrderBudget(row.budget_id);
      if (!budget) currentRefusal = "The budget no longer exists";
      else {
        const figures = await budgetFiguresOf(budget);
        currentKpis = figures.kpis;
        if (baseline) variance = compareToBaseline(baseline, figures.general);
        /* Same comparison against V0; only its `baseline` side is read — the
           variance the screen prints is Latest − Last. */
        if (original) originalRows = compareToBaseline(original, figures.general);
        /* THE GAPS, ONLY WHILE THE ENTRY IS OPEN — a closed entry's budget is
           the approved (or reverted) one, and a gap there is not this
           amendment's to fill. */
        if (r.outcome === "open") manualEntries = await manualEntriesOf(id, budget.lines, figures.totals.unpriced);
      }
    } catch (e) {
      currentRefusal = e instanceof Error ? e.message : "The budget's figures could not be worked out";
    }
  }

  /* THE BOMs' OWN GAPS (0619): a requirement or yarn row the recalculation
     had to REFUSE — a new colourway with no size break-up, a fabric with no
     weight — is an input someone must enter, said in the same sentence shape
     as the budget's, with the BOM to open. */
  if (r.outcome === "open" && r.garment_order_id) {
    manualEntries = [...(await bomGapsOf(id, r.garment_order_id)), ...manualEntries];
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
    originalKpis,
    currentKpis,
    currentRefusal,
    variance,
    original: Object.fromEntries(originalRows.map((x) => [x.key, x.baseline])),
    changes,
    downstream,
    manualEntries,
    run,
    timeline,
    names: { ...names, ...actorNames },
    perms: { canEdit },
  };
}

/**
 * THE MD'S VIEW OF A REVISION (client 2026-09-24): Original · Last · Latest by
 * cost head, for the approval sheet directly above Approve / Reject.
 *
 * The same three columns `getAmendmentEntry` builds, computed from a budget the
 * caller ALREADY HOLDS — the approval page loads every budget with its lines
 * and revisions — so the only read of its own is V0 (and only from Rev #2 on).
 * `getAmendmentEntry` would re-read the budget and add the downstream BOMs,
 * manual entries, run and timeline: ~10 round trips per budget, for figures
 * this sheet does not show. Null = no open revision: a first-time budget has
 * nothing to compare against.
 */
export type RevisionComparisonData = {
  entryNo: string | null;
  /** The revision's own facts, for the sheet's header (spec: RE · Rev · raised by · categories · reason). */
  raisedBy: string | null;
  raisedAt: string | null;
  categories: string;
  reason: string | null;
  /** "What changed in order details" — raise-time snapshot vs the order now. */
  changes: OrderFieldChange[];
  changesRefusal: string | null;
  baselineKpis: BudgetKpis | null;
  originalKpis: BudgetKpis | null;
  currentKpis: BudgetKpis | null;
  currentRefusal: string | null;
  variance: BaselineRow[];
  original: Partial<Record<BaselineRow["key"], number | Refusal>>;
};

export async function getRevisionComparison(
  budget: NonNullable<Awaited<ReturnType<typeof getOrderBudget>>>,
): Promise<RevisionComparisonData | null> {
  type Rev = {
    id: string; outcome?: string; baseline: unknown; entry_no?: string | null; garment_order_id?: string | null;
    reopened_at: string; reopened_by_name?: string | null; reason?: string | null;
    amendment_types?: string[] | null; amendment_type?: string | null; order_snapshot?: unknown;
    module_details?: string[] | null;
  };
  const open = ((budget.revisions ?? []) as unknown as Rev[]).find((r) => r.outcome === "open");
  if (!open) return null;
  const baseline = (open.baseline as BudgetBaseline | null) ?? null;

  /* V0 is the baseline the order's FIRST entry froze — same rule, and the same
     query, as `getAmendmentEntry`. Read alongside the figures, not before. */
  const s = await createClient();
  const [firstRes, figuresRes, changesRes] = await Promise.all([
    open.garment_order_id
      ? s
          .from("order_budget_revisions")
          .select("baseline")
          .eq("garment_order_id", open.garment_order_id)
          .not("baseline", "is", null)
          .order("reopened_at", { ascending: true })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    budgetFiguresOf(budget).then(
      (f) => ({ ok: true as const, f }),
      (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "The budget's figures could not be worked out" }),
    ),
    open.garment_order_id
      ? orderChangesSince(open.order_snapshot, open.garment_order_id).then(
          (c) => ({ ok: true as const, c }),
          (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "The order could not be compared" }),
        )
      : Promise.resolve({ ok: true as const, c: [] as OrderFieldChange[] }),
  ]);
  if (firstRes.error) throw new Error(`Could not read the original budget: ${firstRes.error.message}`);
  const original = ((firstRes.data?.baseline as BudgetBaseline | null) ?? null) || baseline;

  const figures = figuresRes.ok ? figuresRes.f : null;
  const originalRows = figures && original ? compareToBaseline(original, figures.general) : [];
  const types = open.amendment_types?.length ? open.amendment_types : open.amendment_type ? [open.amendment_type] : [];
  return {
    entryNo: open.entry_no ?? null,
    raisedBy: open.reopened_by_name ?? null,
    raisedAt: open.reopened_at ?? null,
    categories: types.length ? entryScopeLabel(types, open.module_details ?? []) : "",
    reason: open.reason?.trim() || null,
    changes: changesRes.ok ? changesRes.c : [],
    changesRefusal: changesRes.ok ? null : changesRes.error,
    baselineKpis: kpisFromJson(baseline?.kpis),
    originalKpis: kpisFromJson(original?.kpis),
    currentKpis: figures?.kpis ?? null,
    currentRefusal: figuresRes.ok ? null : figuresRes.error,
    variance: figures && baseline ? compareToBaseline(baseline, figures.general) : [],
    original: Object.fromEntries(originalRows.map((x) => [x.key, x.baseline])),
  };
}

/** Distinct refusals on the order's BOMs — each an input the BOM needs. */
async function bomGapsOf(entryId: string, garmentOrderId: string): Promise<ManualEntryItem[]> {
  const s = await createClient();
  const [{ data: fab }, { data: mat }] = await Promise.all([
    s.from("order_fabric_boms").select("id").eq("garment_order_id", garmentOrderId).maybeSingle(),
    s
      .from("material_bom_amendments")
      .select("id")
      .eq("garment_order_id", garmentOrderId)
      .eq("is_draft", false)
      .order("amendment_no", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const fabId = (fab as { id: string } | null)?.id;
  const matId = (mat as { id: string } | null)?.id;
  const [fr, fy, mr] = await Promise.all([
    fabId
      ? s.from("order_fabric_bom_requirements").select("refusal_reason").eq("bom_id", fabId).not("refusal_reason", "is", null)
      : Promise.resolve({ data: [] }),
    fabId
      ? s.from("order_fabric_bom_yarns").select("refusal_reason").eq("bom_id", fabId).not("refusal_reason", "is", null)
      : Promise.resolve({ data: [] }),
    matId
      ? s.from("material_bom_amendment_requirements").select("refusal_reason").eq("amendment_id", matId).not("refusal_reason", "is", null)
      : Promise.resolve({ data: [] }),
  ]);
  const out: ManualEntryItem[] = [];
  const add = (module: string, rows: unknown, href: string) => {
    const seen = new Set<string>();
    for (const x of (rows ?? []) as { refusal_reason: string | null }[]) {
      const why = (x.refusal_reason ?? "").trim();
      if (!why || seen.has(why)) continue;
      seen.add(why);
      out.push({ key: `${module}:${why}`, module, message: `Manual Entry Needed: [${module}] -> ${why}`, href });
    }
  };
  add("Fabric BOM", [...((fr.data ?? []) as unknown[]), ...((fy.data ?? []) as unknown[])], `/orders/order-amendments/${entryId}/fabric-bom`);
  add("Material BOM", mr.data, `/orders/order-amendments/${entryId}/material-bom`);
  return out;
}

/** The unpriced lines, named the way the operator knows them. */
async function manualEntriesOf(
  entryId: string,
  lines: readonly { source: string; description: string | null; item_id: string | null }[],
  unpriced: readonly { index: number; field?: string }[],
): Promise<ManualEntryItem[]> {
  const wanted = [...new Set(unpriced.map((u) => lines[u.index]?.item_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (wanted.length) {
    const s = await createClient();
    const { data } = await s.from("items").select("id, name").in("id", wanted);
    for (const it of (data ?? []) as { id: string; name: string | null }[]) if (it.name) names.set(it.id, it.name);
  }
  return unpriced.flatMap((u, i) => {
    const l = lines[u.index];
    if (!l) return [];
    const name = l.description?.trim() || (l.item_id ? names.get(l.item_id) : undefined) || `Line ${u.index + 1}`;
    const field = u.field ?? "rate";
    return [
      {
        key: `${u.index}:${field}:${i}`,
        message: manualEntryMessage({ source: l.source, name, field }),
        module: moduleOfBudgetSource(l.source),
        /* INTO THE AMENDMENT'S OWN BUDGET TAB, on the exact cell (2026-09-23). */
        href: `/orders/order-amendments/${entryId}/budget?line=${encodeURIComponent(budgetLineKey(l as Parameters<typeof budgetLineKey>[0]))}&field=${encodeURIComponent(field)}`,
      },
    ];
  });
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
  const s = await createClient();
  const [fabric, material] = await Promise.all([listFabricBomTasks(), listMaterialBomTasks()]);
  const f = fabric.find((t) => t.id === orderId);
  const m = material.find((t) => t.id === orderId);
  const stamp = async (table: "order_fabric_boms" | "material_bom_amendments", id: string | null | undefined) => {
    if (!id) return { computed_at: null, computed_for_qty: null };
    const { data } = await s.from(table).select("computed_at, computed_for_qty").eq("id", id).maybeSingle();
    const r = data as { computed_at: string | null; computed_for_qty: number | string | null } | null;
    return { computed_at: r?.computed_at ?? null, computed_for_qty: r?.computed_for_qty == null ? null : Number(r.computed_for_qty) };
  };
  /* A DRY RUN, only for a BOM that needs it: the refusals the recalculation
     would write are the order's gaps, said before anyone presses the button. */
  const blockersOf = async (res: { ok: true; manualEntries: { message: string }[]; dryRun?: { requirementsAfter: unknown[] } } | { ok: false; error: string }) => {
    /* Only a real gap is a blocker — "Forbidden" or a lock sentence is about
       who is looking, not about the order. */
    if (!res.ok) return res.error.startsWith("Manual Entry Needed") ? [res.error.replace(/^Manual Entry Needed:\s*(\[[^\]]*\]\s*->\s*)?/, "")] : [];
    const refusals = new Set<string>();
    for (const r of (res.dryRun?.requirementsAfter ?? []) as { refusal_reason?: string | null }[]) {
      if (r.refusal_reason) refusals.add(r.refusal_reason.trim());
    }
    for (const x of res.manualEntries) refusals.add(x.message.replace(/^Manual Entry Needed:\s*(\[[^\]]*\]\s*->\s*)?/, ""));
    return [...refusals];
  };
  const needs = (st: BomStatus | undefined) => st === "recalculate";
  const [fStamp, mStamp, fBlock, mBlock] = await Promise.all([
    stamp("order_fabric_boms", f?.bom_id),
    stamp("material_bom_amendments", m?.bom_id),
    needs(f?.status) && f?.bom_id
      ? recalculateFabricBomDerived(f.bom_id, { dryRun: true }).then(blockersOf).catch(() => [])
      : Promise.resolve([] as string[]),
    needs(m?.status) && m?.bom_id
      ? recalculateMaterialBomDerived(m.bom_id, { dryRun: true }).then(blockersOf).catch(() => [])
      : Promise.resolve([] as string[]),
  ]);
  return [
    {
      key: "fabric_bom",
      label: "Fabric BOM",
      status: f?.status ?? "unresolved",
      bom_id: f?.bom_id ?? null,
      ...fStamp,
      order_qty_now: f?.production_qty ?? null,
      blockers: fBlock,
      /* `?open=` takes the ORDER (the queue's task id), not the BOM. */
      href: `/orders/fabric-bom?open=${orderId}`,
    },
    {
      key: "material_bom",
      label: "Material BOM",
      status: m?.status ?? "unresolved",
      bom_id: m?.bom_id ?? null,
      ...mStamp,
      order_qty_now: m?.production_qty ?? null,
      blockers: mBlock,
      href: `/orders/material-bom?open=${orderId}`,
    },
  ];
}

/** The margin figure for a notification line, never a blank. */
export function marginText(v: number | Refusal): string {
  return isRefusal(v) ? `unknown (${v.refused})` : `${v.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// The workspace's head — what the tabs need, and nothing heavier
// ---------------------------------------------------------------------------

/** The Amendment workspace's tab strip reads this (2026-09-23). */
export type AmendmentHead = {
  id: string;
  entry_no: string | null;
  garment_order_id: string | null;
  budget_id: string | null;
  types: string[];
  outcome: string;
  re_no: string | null;
  customer_name: string | null;
};

export async function getAmendmentHead(id: string): Promise<AmendmentHead | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("order_budget_revisions")
    .select(
      "id, entry_no, garment_order_id, budget_id, amendment_type, amendment_types, outcome, " +
        "order:garment_order_amendments!garment_order_id(customer:customers(name), sales_order:sales_orders(order_number))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the amendment: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as {
    id: string;
    entry_no: string | null;
    garment_order_id: string | null;
    budget_id: string | null;
    amendment_type: string;
    amendment_types: string[] | null;
    outcome: string;
    order: {
      customer: { name: string | null } | { name: string | null }[] | null;
      sales_order: { order_number: string | null } | { order_number: string | null }[] | null;
    } | null;
  };
  return {
    id: r.id,
    entry_no: r.entry_no,
    garment_order_id: r.garment_order_id,
    budget_id: r.budget_id,
    types: r.amendment_types?.length ? r.amendment_types : [r.amendment_type],
    outcome: r.outcome,
    re_no: one(r.order?.sales_order)?.order_number ?? null,
    customer_name: one(r.order?.customer)?.name ?? null,
  };
}
