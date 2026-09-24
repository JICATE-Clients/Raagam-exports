import "server-only";
import { createClient } from "@/lib/supabase/server";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { money } from "@/lib/finance/calc";
import { budgetFiguresOf, getOrderBudget } from "./service";
import { groupCutQtyOf, lineInputOf, orderInputsOf } from "./figures";
import { compareToBaseline, type BaselineRow, type BudgetBaseline } from "./amendment";
import { marginDelta, type MarginDelta } from "@/lib/orders/amendments/amendment-entry";
import {
  BUDGET_SOURCE_LABELS,
  CMT_OPERATIONS,
  isRefusal,
  lineAmount,
  lineReqd,
  salesBaseOf,
  type BudgetSource,
  type GeneralSummary,
} from "./totals";
import { budgetStatusText, type BudgetLine, type BudgetStatus } from "./types";

/**
 * THE BUDGET STATEMENT (client 2026-09-23, legacy RP "BUDGET STATEMENT"
 * printout, `Budget Statement.pdf`), at `/orders/<sales order id>/budget`.
 *
 * ## THE LEGACY'S SHAPE
 *
 * One table, `Group Head · Cost Head · Particulars · Qty · UOM · Rate · Value`:
 * Purchase (Yarn / Fabric / Trims Purchase), the process groups (one Cost Head
 * per PROCESS — Knitting, Dyeing, Compacting …), CMT (one Cost Head per
 * operation), Garment Process and Other Expense. After every Cost Head and
 * every Group Head, a CONTRIBUTION line: its value, its share of the TOTAL
 * EXPENSES and its cost PER GARMENT (on the Cut Qty — legacy's "SQ" qty,
 * retired 2026-09-23). Legacy's own figures prove both bases: Trims 2,04,785 /
 * total expenses 19,09,374.41 = 10.73 %, and / 3,207 pcs = Rs 63.86.
 *
 * ## IT COMPUTES NO BUDGET FIGURE
 *
 * Every line's Qty and Value is `lineReqd` / `lineAmount` over `lineInputOf`
 * — the budget screen's own cell functions — and every total is
 * `budgetFiguresOf`'s, the assembly the screen, `submitBudget` and the
 * amendment baseline read. What this file adds is only DISPLAY arithmetic over
 * those: a Cost Head's sum of its lines, a share of the total, a per-garment
 * division. The one split it makes — a CMT line broken into its operations —
 * gives the last operation the remainder, so the operations always add up to
 * the line the engine costed.
 *
 * ## SUPPRESSION TRAVELS WITH IT (client 2026-09-21)
 *
 * While a line is unrated the engine refuses the profit and the margin. The
 * statement prints that refusal in the Net Profit box and the sentence naming
 * the lines above the table — never a margin over a cost missing a dye charge.
 * An unrated line itself prints with a blank Value, as the legacy prints its
 * unrated DISCLAIMER TAG.
 *
 * ## A BUDGET COVERS A GROUP OF ORDERS
 *
 * Printed WHOLE, never pro-rated; the Quantity table lists every order and
 * style it covers, this RE first.
 *
 * ## PLAIN DATA
 *
 * V_final freezes this object into jsonb (`order_amendment_report_snapshots`),
 * so it holds only strings, numbers, booleans, nulls, arrays and plain objects.
 */

export type Fig = number | { refused: string };

export type BudgetStatementLine = {
  particulars: string;
  /** Null where the line has no quantity of its own (a flat or percent charge). */
  qty: Fig | null;
  uom: string | null;
  rate: string;
  /** Null = unrated: excluded from every total, exactly as the engine does. */
  value: Fig | null;
  foc: boolean;
};

export type BudgetContribution = {
  value: Fig;
  /** Share of the TOTAL EXPENSES, %. */
  pct: Fig;
  /** Rs per garment, on the Cut Qty. */
  perGarment: Fig;
};

export type BudgetCostHead = { label: string; lines: BudgetStatementLine[] } & BudgetContribution;
export type BudgetGroupHead = { key: string; label: string; heads: BudgetCostHead[] } & BudgetContribution;

export type BudgetQtyRow = {
  reNo: string | null;
  orderNo: string | null;
  styleRefNo: string | null;
  style: string | null;
  unit: string | null;
  order: number | null;
  excess: number | null;
  approval: number | null;
  rejection: number | null;
  cut: Fig;
};

export type OrderBudgetReport = {
  company: { name: string | null; address: string | null; gstin: string | null; logo: string | null };
  budget: {
    code: string | null;
    date: string | null;
    status: BudgetStatus;
    statusText: string;
    decidedAt: string | null;
    preparedBy: string | null;
    /** Only once the budget is APPROVED — a rejecter did not approve it. */
    approvedBy: string | null;
  };
  header: {
    reNo: string | null;
    /** The other REs this budget covers, when it covers several. */
    otherReNos: string[];
    customer: string | null;
    deliveryFrom: string | null;
    deliveryTo: string | null;
    avgPrice: Fig;
    currency: string | { refused: string };
    exRate: Fig;
    /** INR — the budget's own gross sales. */
    salesValue: Fig;
  };
  quantities: BudgetQtyRow[];
  groups: BudgetGroupHead[];
  /** Other Incomes, kept apart: income is not an expense. */
  income: BudgetGroupHead | null;
  summary: {
    totalIncome: Fig;
    totalExpenses: Fig;
    netProfit: Fig;
    profitPct: Fig;
    costPerGarment: Fig;
    profitPerGarment: Fig;
  };
  cutQty: Fig;
  unratedNotice: string | null;
  /** While the RE is AMENDING: approved baseline vs the budget now. */
  amendment: { entryNo: string | null; margin: MarginDelta; rows: BaselineRow[] } | null;
};

/** The legacy's Group Heads, in its order. Every non-income source sits in
 *  exactly one — a source in none would be cost the statement cannot show. */
const GROUPS: readonly { key: string; label: string; sources: readonly BudgetSource[] }[] = [
  { key: "purchase", label: "Purchase", sources: ["yarn", "fabric", "material"] },
  { key: "yarn_process", label: "Yarn Process", sources: ["yarn_process"] },
  { key: "fabric_process", label: "Fabric Process", sources: ["fabric_process"] },
  { key: "material_process", label: "Accessory Process", sources: ["material_process"] },
  { key: "cmt", label: "CMT", sources: ["cmt"] },
  { key: "garment_process", label: "Garment Process", sources: ["garment_process"] },
  { key: "expense", label: "Other Expense", sources: ["expense"] },
];

/** Purchase's Cost Heads, in the legacy's words ("TRIMS PURCHASE" is the Material BOM). */
const PURCHASE_HEAD: Partial<Record<BudgetSource, string>> = {
  yarn: "YARN PURCHASE",
  fabric: "FABRIC PURCHASE",
  material: "TRIMS PURCHASE",
};

/** Add figures; the first refusal wins — never a part-sum. */
function sum(figs: readonly Fig[]): Fig {
  let t: Fig = 0;
  for (const f of figs) {
    if (isRefusal(f)) return f;
    t = money((t as number) + f);
  }
  return t;
}

/** `part / whole`, scaled — or why not. A share of nothing is not 0. */
function ratio(part: Fig, whole: Fig, scale: number, why: string): Fig {
  if (isRefusal(part)) return part;
  if (isRefusal(whole)) return whole;
  if (!(whole > 0)) return { refused: why };
  return money((part / whole) * scale);
}

/** A stored description, tidied for the Particulars column: the screen's " · "
 *  joins read as the legacy's " / ", and a dangling separator goes. */
function tidy(v: string | null | undefined): string {
  return (v ?? "")
    .trim()
    .replace(/[\s·/]+$/u, "")
    .replace(/\s+·\s+/gu, " / ")
    .trim();
}

export async function getOrderBudgetReport(salesOrderId: string): Promise<OrderBudgetReport | { refused: string }> {
  const s = await createClient();

  // THE RE'S ORDER DOCUMENT(S) → THE BUDGET(S) COVERING THEM.
  const { data: docs, error: dErr } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("sales_order_id", salesOrderId);
  if (dErr) return { refused: `Could not read the order: ${dErr.message}` };
  const docIds = ((docs ?? []) as { id: string }[]).map((d) => d.id);
  if (docIds.length === 0) return { refused: "No budget for this order yet" };

  const { data: links, error: lErr } = await s
    .from("order_budget_orders")
    .select("budget_id, budget:order_budgets(id, status, created_at, created_by, submitted_by)")
    .in("garment_order_id", docIds);
  if (lErr) return { refused: `Could not read which budget covers this order: ${lErr.message}` };
  type Head = { id: string; status: BudgetStatus; created_at: string; created_by: string | null; submitted_by: string | null };
  type Link = { budget_id: string; budget: Head | null };
  const candidates = ((links ?? []) as unknown as Link[]).map((l) => l.budget).filter((b): b is Head => !!b);
  if (candidates.length === 0) return { refused: "No budget for this order yet" };

  /* THE CURRENT BUDGET: an approved one first (it is what purchase acts on and
     what locks the RE, 0576), then awaiting approval, then a draft — a
     rejected one only when nothing else exists. Latest within a rank. */
  const rank: Record<BudgetStatus, number> = { approved: 0, submitted: 1, draft: 2, rejected: 3 };
  candidates.sort((a, b) => rank[a.status] - rank[b.status] || b.created_at.localeCompare(a.created_at));
  const head = candidates[0];

  let budget;
  let figs;
  try {
    budget = await getOrderBudget(head.id);
    if (!budget) return { refused: "No budget for this order yet" };
    figs = await budgetFiguresOf(budget);
  } catch (e) {
    return { refused: e instanceof Error ? e.message : "The budget could not be read" };
  }
  const { totals, sales, general, facts } = figs;

  // NAMES — uom, expense/income head + stage (both config_lookups), process, item, people.
  const ids = (k: "uom_id" | "cost_head_id" | "stage_id" | "process_id" | "item_id") => [
    ...new Set(budget.lines.map((l) => l[k]).filter((v): v is string => !!v)),
  ];
  const lookupIds = [...new Set([...ids("cost_head_id"), ...ids("stage_id")])];
  const [uomIds, processIds, itemIds] = [ids("uom_id"), ids("process_id"), ids("item_id")];
  const people = [...new Set([head.created_by ?? head.submitted_by, budget.decided_by].filter((v): v is string => !!v))];
  const none = Promise.resolve({ data: [], error: null });
  const [uomRes, lookupRes, procRes, itemRes, coRes, nameRes] = await Promise.all([
    uomIds.length ? s.from("uoms").select("id, code").in("id", uomIds) : none,
    lookupIds.length ? s.from("config_lookups").select("id, name").in("id", lookupIds) : none,
    processIds.length ? s.from("processes").select("id, name").in("id", processIds) : none,
    itemIds.length ? s.from("items").select("id, name").in("id", itemIds) : none,
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    people.length ? s.rpc("creator_names", { ids: people }) : none,
  ]);
  /* A FAILED NAME READ REFUSES — a UOM column of blanks prints "12.5" with no
     unit on a document the MD signs. */
  for (const [what, r] of [
    ["units", uomRes],
    ["expense heads and stages", lookupRes],
    ["processes", procRes],
    ["items", itemRes],
  ] as const) {
    if (r.error) return { refused: `Could not read the budget's ${what}: ${r.error.message}` };
  }
  const nameMap = (rows: unknown, key: "code" | "name") =>
    new Map(((rows ?? []) as Record<string, string>[]).map((r) => [r.id, r[key]]));
  const uoms = nameMap(uomRes.data, "code");
  const lookups = nameMap(lookupRes.data, "name");
  const procs = nameMap(procRes.data, "name");
  const items = nameMap(itemRes.data, "name");
  const personName = (id: string | null) =>
    (id && ((nameRes.data ?? []) as { id: string; full_name: string | null }[]).find((p) => p.id === id)?.full_name) ||
    null;

  const reNoOf = new Map(facts.map((o) => [o.id, o.re_no ?? o.sc_no]));
  const base = salesBaseOf(orderInputsOf(facts));
  const cutQty = groupCutQtyOf(facts);
  const expenses = totals.cost;
  const contribution = (value: Fig): BudgetContribution => ({
    value,
    pct: ratio(value, expenses, 100, "No total expense to measure against"),
    perGarment: ratio(value, cutQty, 1, "No Cut Qty to spread the cost over"),
  });

  /** The Rate column — the rate AS TYPED, in its own currency. */
  const rateOf = (l: BudgetLine, rate: number | null = l.rate): string => {
    if (rate == null) return "";
    const ccy = l.currency_code && l.currency_code !== "INR" ? l.currency_code : null;
    if (l.rate_type === "percent") return `${rate} %`;
    if (l.rate_type === "flat") return "Flat";
    return ccy ? `${rate} ${ccy}${l.ex_rate ? ` @ ${l.ex_rate}` : ""}` : money(rate).toFixed(2);
  };

  /** An engine amount as the statement's Value: an unrated line is BLANK (null)
   *  — excluded, as the engine excludes it — and a pending one says why. */
  const valueOf = (a: ReturnType<typeof lineAmount>): Fig | null =>
    isRefusal(a) ? (a.field === "base" ? { refused: a.refused } : null) : a;

  /** Every row one budget line prints as, under the Cost Head it belongs to. */
  const rowsOf = (l: BudgetLine): { head: string; line: BudgetStatementLine }[] => {
    const input = lineInputOf(l);
    const src = l.source as BudgetSource;
    const perUnit = l.rate_type === "per_unit";
    const reqd = lineReqd(input);
    const qty: Fig | null = perUnit ? reqd : null;
    /* A unit only where there is a quantity to be in it — a Flat or % charge
       has none, whatever `uom_id` a line happens to carry. */
    const uom = perUnit && l.uom_id ? (uoms.get(l.uom_id) ?? null) : null;
    const amount = valueOf(lineAmount(input, base));
    const spec = tidy(l.specification);
    const withSpec = (p: string) => [p, spec].filter(Boolean).join(" / ");
    const processName = l.process_id ? procs.get(l.process_id) : null;

    if (src in PURCHASE_HEAD) {
      const stage = l.stage_id ? lookups.get(l.stage_id) : null;
      const what = tidy(l.description) || (l.item_id ? (items.get(l.item_id) ?? "") : "");
      return [
        {
          head: PURCHASE_HEAD[src]!,
          line: { particulars: withSpec([what, stage].filter(Boolean).join(" / ")), qty, uom, rate: rateOf(l), value: amount, foc: l.is_foc },
        },
      ];
    }

    if (src === "cmt") {
      /* "RE / style / PIECES" — legacy's CMT particulars. */
      const particulars =
        [
          l.garment_order_id ? reNoOf.get(l.garment_order_id) : null,
          l.style_ref_no,
          l.item_id ? items.get(l.item_id) : null,
        ]
          .filter(Boolean)
          .join(" / ") || tidy(l.description);
      /* ONE COST HEAD PER OPERATION, as the legacy lists Cutting, Singer,
         Checking … — when the line carries its breakup (0574: `rate` is their
         sum). Only a plain INR per-piece line splits: a foreign-currency or flat
         CMT line is shown whole rather than divided by a rule it was not
         priced on. The LAST operation takes the remainder, so the operations
         add up to the amount the engine costed, to the paisa. */
      const ops = CMT_OPERATIONS.map((op) => ({ label: op.label.toUpperCase(), rate: l[op.key] })).filter(
        (op): op is { label: string; rate: number } => op.rate != null && Number(op.rate) > 0,
      );
      const splittable =
        ops.length > 0 && perUnit && !isRefusal(reqd) && typeof amount === "number" && (!l.currency_code || l.currency_code === "INR");
      if (splittable) {
        let rest = amount as number;
        return ops.map((op, i) => {
          const v = i === ops.length - 1 ? money(rest) : money((reqd as number) * Number(op.rate));
          rest = money(rest - v);
          return { head: op.label, line: { particulars, qty, uom, rate: rateOf(l, Number(op.rate)), value: v, foc: l.is_foc } };
        });
      }
      return [{ head: "CMT", line: { particulars, qty, uom, rate: rateOf(l), value: amount, foc: l.is_foc } }];
    }

    if (src === "expense" || src === "income") {
      const headName =
        (l.cost_head_id ? lookups.get(l.cost_head_id) : null) || tidy(l.description) || BUDGET_SOURCE_LABELS[src];
      /* Legacy: "(3207.00 PCS @ 18.00)" — the charge's own basis, since the
         Cost Head already names it. */
      const basis =
        l.rate == null
          ? ""
          : l.rate_type === "percent"
            ? `(${l.rate} % of Sales Value)`
            : l.rate_type === "flat"
              ? "(Flat)"
              : `(${isRefusal(reqd) ? "?" : money(reqd).toFixed(2)} ${uom ?? ""} @ ${rateOf(l)})`.replace(/\s+@/, " @");
      const own = tidy(l.description);
      return [
        {
          head: headName.toUpperCase(),
          line: {
            particulars: withSpec(own && own.toUpperCase() !== headName.toUpperCase() ? own : basis),
            qty,
            uom,
            rate: rateOf(l),
            value: amount,
            foc: l.is_foc,
          },
        },
      ];
    }

    /* A PROCESS — one Cost Head per process (Knitting, Dyeing …). The pulled
       description often LEADS with the process ("EMBROIDERY · 1000139805 ·
       BACK BODY"); the Cost Head already says it, so it is not said twice. */
    const headName = (processName || BUDGET_SOURCE_LABELS[src] || l.source).toUpperCase();
    let what = tidy(l.description);
    if (what.toUpperCase().startsWith(`${headName} / `)) what = what.slice(headName.length + 3);
    else if (what.toUpperCase() === headName) what = "";
    return [{ head: headName, line: { particulars: withSpec(what), qty, uom, rate: rateOf(l), value: amount, foc: l.is_foc } }];
  };

  const lines = [...budget.lines].sort((a, b) => a.sno - b.sno);
  const groupOf = (key: string, label: string, sources: readonly BudgetSource[]): BudgetGroupHead | null => {
    const heads: { label: string; lines: BudgetStatementLine[] }[] = [];
    // Sources in the group's order (Yarn, Fabric, Trims); heads in first-seen order within.
    for (const src of sources) {
      for (const l of lines.filter((x) => x.source === src)) {
        for (const r of rowsOf(l)) {
          const at = heads.find((h) => h.label === r.head);
          if (at) at.lines.push(r.line);
          else heads.push({ label: r.head, lines: [r.line] });
        }
      }
    }
    if (heads.length === 0) return null;
    const costed = heads.map((h) => ({
      ...h,
      ...contribution(sum(h.lines.map((x) => x.value).filter((v): v is Fig => v != null))),
    }));
    /* THE GROUP'S VALUE IS THE ENGINE'S, never the heads re-added — the two
       agree by construction, and if they ever did not, the engine's is the
       figure the budget screen shows. */
    return { key, label, heads: costed, ...contribution(sum(sources.map((src) => totals.costBySource[src]))) };
  };
  const groups = GROUPS.map((g) => groupOf(g.key, g.label, g.sources)).filter((g): g is BudgetGroupHead => !!g);
  const income = groupOf("income", "Other Income", ["income"]);

  /* WHILE AMENDING — the open entry's frozen baseline beside the budget as it
     stands. `compareToBaseline` and `marginDelta` are the register's own. No
     baseline → no block, never an invented "approved" column. */
  type Rev = { entry_no?: string | null; outcome?: string | null; baseline?: unknown; amended_kpis?: unknown; garment_order_id?: string | null };
  const open = (budget.revisions as unknown as Rev[]).find(
    (r) => r.outcome === "open" && (!r.garment_order_id || docIds.includes(r.garment_order_id)),
  );
  const baseline = open?.baseline as Partial<BudgetBaseline> | null | undefined;
  const amendment =
    open && baseline?.general
      ? {
          entryNo: open.entry_no ?? null,
          margin: marginDelta({
            baselineKpis: baseline.kpis,
            submittedKpis: open.amended_kpis ?? budget.submitted_summary,
          }),
          rows: compareToBaseline({ general: baseline.general as GeneralSummary, lines: baseline.lines }, general),
        }
      : null;

  const thisFirst = [...facts].sort((a, b) => Number(docIds.includes(b.id)) - Number(docIds.includes(a.id)));
  const mine = thisFirst.filter((o) => docIds.includes(o.id));
  const dates = facts.map((o) => o.delivery_date).filter((d): d is string => !!d).sort();
  const reNo = mine[0] ? (mine[0].re_no ?? mine[0].sc_no) : null;

  const co = coRes.data as Record<string, unknown> | null;
  const str = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);
  const salesValue = totals.sales;
  const netProfit = general.profit;

  const report: OrderBudgetReport = {
    company: {
      name: str("name") ?? str("company_name"),
      address: registeredAddressOf(co),
      gstin: str("gstin"),
      logo: letterheadLogoOf(co),
    },
    budget: {
      code: budget.code,
      date: budget.budget_date,
      status: budget.status,
      statusText: budgetStatusText(budget.status),
      decidedAt: budget.decided_at,
      preparedBy: personName(head.created_by ?? head.submitted_by),
      approvedBy: budget.status === "approved" ? personName(budget.decided_by) : null,
    },
    header: {
      reNo,
      otherReNos: [
        ...new Set(thisFirst.filter((o) => !docIds.includes(o.id)).map((o) => o.re_no ?? o.sc_no).filter((v): v is string => !!v)),
      ],
      customer: [...new Set(thisFirst.map((o) => o.customer_name).filter((v): v is string => !!v))].join(", ") || null,
      deliveryFrom: dates[0] ?? null,
      deliveryTo: dates[dates.length - 1] ?? null,
      avgPrice: sales.avgPrice,
      currency: sales.currency,
      exRate: sales.conv,
      salesValue,
    },
    quantities: thisFirst.flatMap((o) =>
      o.styles.map((st) => ({
        reNo: o.re_no ?? o.sc_no,
        orderNo: o.po_no,
        styleRefNo: st.style_ref_no || null,
        style: st.style_description ?? st.article_no ?? null,
        unit: o.unit ?? "PCS",
        order: st.cut_breakup?.order ?? null,
        excess: st.cut_breakup?.excess ?? null,
        approval: st.cut_breakup?.approval ?? null,
        rejection: st.cut_breakup?.rejection ?? null,
        cut: st.cut_qty != null ? st.cut_qty : { refused: st.cut_refusal ?? "No Cut Qty yet" },
      })),
    ),
    groups,
    income,
    summary: {
      totalIncome: sum([salesValue, totals.income]),
      totalExpenses: expenses,
      netProfit,
      profitPct: general.marginPct,
      costPerGarment: general.costPerPiece,
      profitPerGarment: ratio(netProfit, cutQty, 1, "No Cut Qty to spread the profit over"),
    },
    cutQty,
    unratedNotice: totals.unratedNotice,
    amendment,
  };
  // A plain copy — what V_final stores is exactly what the page prints.
  return JSON.parse(JSON.stringify(report)) as OrderBudgetReport;
}
