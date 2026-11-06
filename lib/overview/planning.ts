import type { Mood, NeedCell, StripCell } from "@/components/viz/kit";
import type { BomStatus } from "@/lib/orders/bom-status";
import { count, names, outOf, type SayLine } from "./words";

/**
 * PLANNING ▸ OVERVIEW — "Is each order ready to buy?" (plan
 * https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW, the readiness grid).
 *
 * WHERE PLANNING ACTUALLY HAPPENS. Every screen registered under the Planning module is
 * `unavailable` (0332 dropped its tables). The live planning work is under Orders — Fabric Plan,
 * Accessories Plan, Budgeting, Internal Work Orders and TA Plan — so this page reads THOSE and
 * links to them. It is the module's one working page, and it says where the work is.
 *
 * READY TO BUY = both plans done (`updated`) and the budget approved. A plan that reads
 * `recalculate` is NOT done: the order changed after it was computed, so its quantities are
 * for a different order (the whole point of `bom-status.ts`). `unresolved` is "can't tell",
 * never counted as done or as missing.
 */

export type StepKey = "fabric" | "accessories" | "budget" | "ta" | "iwo";
export type CellState = "done" | "started" | "stale" | "none" | "na";

export type Cell = { state: CellState; word: string; href?: string };

export type ReadyRow = {
  orderId: string;
  reNo: string;
  buyer: string;
  deliveryDate: string | null;
  cells: Record<StepKey, Cell>;
};

export const STEP_LABEL: Record<StepKey, string> = {
  fabric: "Fabric Plan",
  accessories: "Accessories Plan",
  budget: "Budget",
  ta: "T&A plan",
  iwo: "Work order",
};

export const CELL_MOOD: Record<CellState, Mood> = { done: "good", started: "look", stale: "problem", none: "quiet", na: "quiet" };

export function bomCell(s: BomStatus | undefined, href: string): Cell {
  switch (s) {
    case "updated":
      return { state: "done", word: "Done", href };
    case "draft":
      return { state: "started", word: "Draft", href };
    case "recalculate":
      return { state: "stale", word: "Recalculate", href };
    case "unresolved":
      return { state: "na", word: "Can't tell", href };
    default:
      return { state: "none", word: "Not started", href };
  }
}

export function budgetCell(status: string | null, href: string): Cell {
  if (status === "approved") return { state: "done", word: "Approved", href };
  if (status === "submitted") return { state: "started", word: "With the MD", href };
  if (status === "rejected") return { state: "started", word: "Rework", href };
  if (status === "draft") return { state: "started", word: "Draft", href };
  return { state: "none", word: "None", href: "/orders/budgets" };
}

export const isReady = (r: ReadyRow) => r.cells.fabric.state === "done" && r.cells.accessories.state === "done" && r.cells.budget.state === "done";

export type IwoRow = { id: string; code: string; note: string };

export function planningOverview(rows: readonly ReadyRow[], draftIwos: readonly IwoRow[]) {
  const n = rows.length;
  const ready = rows.filter(isReady);
  const of = (k: StepKey, st: CellState) => rows.filter((r) => r.cells[k].state === st);
  const stale = rows.flatMap((r) =>
    (["fabric", "accessories"] as const).filter((k) => r.cells[k].state === "stale").map((k) => ({ row: r, step: k })),
  );
  const noFabric = of("fabric", "none");
  const noAcc = of("accessories", "none");
  const noBudget = rows.filter((r) => r.cells.budget.state !== "done");
  const noTa = of("ta", "none");
  const label = (r: ReadyRow) => `${r.buyer} (${r.reNo})`;

  const say: SayLine[] = [];
  if (!n) say.push({ text: "No order is waiting to be planned.", mood: "quiet" });
  else
    say.push({
      text: `${outOf(ready.length, n)} orders are ready to buy: both plans done and the budget approved.`,
      mood: ready.length === n ? "good" : "normal",
    });
  if (stale.length)
    say.push({
      text: `${count(stale.length, "plan")} ${stale.length === 1 ? "needs" : "need"} recalculating, because the order changed after ${stale.length === 1 ? "it was" : "they were"} made: ${names(stale.map((s) => `${STEP_LABEL[s.step]} of ${label(s.row)}`))}.`,
      mood: "problem",
      href: stale[0].row.cells[stale[0].step].href,
      linkText: "Open it",
    });
  const missing = [...new Set([...noFabric, ...noAcc])];
  if (missing.length)
    say.push({
      text: `${count(missing.length, "order")} ${missing.length === 1 ? "has" : "have"} a plan not started yet: ${names(missing.map(label))}.`,
      mood: "look",
      href: (noFabric[0] ?? noAcc[0]).cells[noFabric[0] ? "fabric" : "accessories"].href,
      linkText: "Start it",
    });
  const budgetWait = noBudget.filter((r) => !missing.includes(r) && !stale.some((s) => s.row === r));
  if (budgetWait.length)
    say.push({
      text: `${count(budgetWait.length, "order")} ${budgetWait.length === 1 ? "has" : "have"} both plans but no approved budget yet: ${names(budgetWait.map(label))}.`,
      mood: "look",
      href: budgetWait[0].cells.budget.href,
      linkText: "Open the budget",
    });
  if (draftIwos.length)
    say.push({
      text: `${count(draftIwos.length, "internal work order")} ${draftIwos.length === 1 ? "is" : "are"} still a draft, not issued.`,
      mood: "look",
      href: `/orders/internal-work-orders/${draftIwos[0].id}`,
      linkText: "Open the oldest",
    });
  if (noTa.length && n)
    say.push({ text: `${outOf(noTa.length, n)} orders have no T&A plan.`, mood: "quiet", href: "/orders/ta-plan", linkText: "TA Plan" });

  const strip: StripCell[] = [
    { label: "Ready to buy", value: outOf(ready.length, n), hint: ready.length === n && n ? "every order" : "plans + approved budget", mood: n && ready.length === n ? "good" : "normal" },
    { label: "Fabric Plan done", value: outOf(of("fabric", "done").length, n), hint: noFabric.length ? `${noFabric.length} not started` : "none missing", mood: noFabric.length ? "look" : "good", href: "/orders/fabric-bom" },
    { label: "Accessories Plan done", value: outOf(of("accessories", "done").length, n), hint: noAcc.length ? `${noAcc.length} not started` : "none missing", mood: noAcc.length ? "look" : "good", href: "/orders/material-bom" },
    { label: "Need recalculating", value: count(stale.length, "plan"), hint: stale.length ? "the order changed under them" : "every plan is current", mood: stale.length ? "problem" : "good" },
    { label: "Budget approved", value: outOf(of("budget", "done").length, n), hint: noBudget.length ? `${noBudget.length} waiting` : "all approved", mood: noBudget.length ? "look" : "good", href: "/orders/budgets" },
  ];

  const needs: NeedCell[] = [
    {
      title: "Recalculate plans",
      mood: stale.length ? "problem" : "good",
      count: stale.length ? count(stale.length, "plan") : "None",
      text: stale.length ? stale.map((s) => `${STEP_LABEL[s.step]} · ${s.row.reNo}`).join(" · ") : "Every plan matches its order",
      href: stale[0]?.row.cells[stale[0].step].href,
      linkText: "Open the first",
    },
    {
      title: "Start missing plans",
      mood: missing.length ? "look" : "good",
      count: missing.length ? count(missing.length, "order") : "None",
      text: missing.length ? missing.map(label).join(" · ") : "Every order has both plans started",
      href: missing.length ? (noFabric.length ? "/orders/fabric-bom" : "/orders/material-bom") : undefined,
      linkText: noFabric.length ? "Fabric Plan" : "Accessories Plan",
    },
    {
      title: "Issue work orders",
      mood: draftIwos.length ? "look" : "good",
      count: draftIwos.length ? count(draftIwos.length, "draft") : "None",
      text: draftIwos.length ? draftIwos.map((w) => `${w.code}${w.note ? ` · ${w.note}` : ""}`).join(" · ") : "No internal work order is waiting",
      href: draftIwos.length ? "/orders/internal-work-orders" : undefined,
      linkText: "Internal Work Orders",
    },
  ];

  const holdBack = (["fabric", "accessories", "budget", "ta"] as const).map((k) => ({ step: k, count: rows.filter((r) => r.cells[k].state !== "done").length }));

  return { say, strip, needs, ready, stale, holdBack };
}
