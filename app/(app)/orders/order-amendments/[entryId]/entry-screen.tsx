"use client";

/**
 * ONE AMENDMENT ENTRY — the audit page (doc/order/amedment.md §2–§5).
 *
 *  1. THE HEADER — entry no, RE No, customer, Amend #n, origin, categories,
 *     remarks, who raised it and when, its status.
 *  2. THE BUDGET VARIANCE AUDIT MATRIX (§4) — Original Approved (the money
 *     baseline frozen when the entry opened) beside Amended Proposed (the
 *     budget's figures NOW, from `budgetFiguresOf` — the same assembler the
 *     budget screen and submit use) with the delta and a direction. Row for
 *     row this is `compareToBaseline` — nothing here computes a figure — with
 *     the order's quantity and the margin on top, from the two KPI sets.
 *  3. WHAT CHANGED — the V0 order snapshot diffed against the order as it
 *     stands (`order_amendment_changes`): rows added / removed / changed per
 *     section, the header's changed columns by name.
 *  4. DOWNSTREAM DOCUMENTS (§3, as decided: stale-and-gate) — each BOM's
 *     freshness (`bomStatusOf`: "Recalculate" when the order moved under it)
 *     with a button that opens it; saving it is what re-stamps its basis. The
 *     budget's "Refresh from BOMs" then pulls the recomputed lines. Nothing is
 *     rewritten by itself, and `submitBudget` refuses while any of this is
 *     stale.
 *  5. THE APPROVAL (§5) — the revised budget's run and timeline; "Send for
 *     approval" is the budget's own Submit, opened from here.
 *
 * Abandon is on this page too (`abandon_order_amendment`): nothing changed →
 * the approved version stands and the order re-locks; something changed → the
 * order stays open and needs a fresh approval. Refused while with the approver.
 */

import { useState, useTransition } from "react";
import { useRegisterWorkspaceTab } from "@/lib/workspace-tabs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Check, ClipboardList, FileText, Minus, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@/lib/format";
import { bomStatusText } from "@/lib/orders/bom-status";
import { cn } from "@/lib/utils";
import { isRefusal, type Refusal } from "@/lib/orders/budget/totals";
import type { BaselineRow } from "@/lib/orders/budget/amendment";
import {
  entryScopeLabel,
  entryStatusLabel,
  modulesOf,
  entryStatusTone,
  originLabel,
} from "@/lib/orders/amendments/amendment-entry";
import { abandonOrderAmendment, recalculateAmendmentBoms } from "@/lib/orders/order-amendments/actions";
import { submitBudget } from "@/lib/orders/budget/actions";
import { AmendmentTabs, amendmentTabHref } from "@/components/orders/amendment-tabs";
import type { AmendmentEntryDetail } from "@/lib/orders/order-amendments/service";

type Kind = "amount" | "percent" | "qty";

function fmt(v: number | Refusal, kind: Kind, unit?: string): string {
  if (isRefusal(v)) return `— (${v.refused})`;
  if (kind === "percent") return `${fmtNumber(v)}%`;
  if (kind === "qty") return `${fmtNumber(v)}${unit ? ` ${unit}` : ""}`;
  return fmtMoney(v);
}

/** The matrix's direction column: an arrow and a word, toned by what it means
 *  for the business — more cost is `danger`, more revenue or profit `success`. */
function Direction({ v, kind, good }: { v: number | Refusal; kind: "cost" | "revenue" | "profit" | "qty" | "margin"; good?: "up" | "down" }) {
  if (isRefusal(v)) return <span className="text-xs text-muted-foreground">—</span>;
  if (v === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> No change
      </span>
    );
  }
  const up = v > 0;
  const word =
    kind === "cost" ? (up ? "Cost up" : "Cost down") :
    kind === "revenue" ? (up ? "Revenue up" : "Revenue down") :
    kind === "profit" ? (up ? "Profit up" : "Profit down") :
    kind === "margin" ? (up ? "Margin up" : "ALERT — margin down") :
    up ? "Increase" : "Reduced";
  const favourable = good ? (good === "up") === up : kind === "cost" ? !up : up;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        favourable ? "text-success" : "text-danger",
        kind === "margin" && !up && "uppercase",
      )}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {word}
    </span>
  );
}

function VarianceTable({ detail, onlyChanged = false }: { detail: AmendmentEntryDetail; onlyChanged?: boolean }) {
  const b = detail.baselineKpis;
  const c = detail.currentKpis;
  const unit = b && !isRefusal(b.order_unit) ? b.order_unit : c && !isRefusal(c.order_unit) ? c.order_unit : undefined;

  const delta = (x: number | Refusal | undefined, y: number | Refusal | undefined): number | Refusal => {
    if (x === undefined) return { refused: "No approved baseline recorded" };
    if (y === undefined) return { refused: detail.currentRefusal ?? "The budget's figures could not be read" };
    if (isRefusal(x)) return { refused: `Approved figure unknown — ${x.refused}` };
    if (isRefusal(y)) return { refused: `Current figure unknown — ${y.refused}` };
    return Math.round((y - x) * 100) / 100;
  };

  type Row = { label: string; kind: Kind; dir: "cost" | "revenue" | "profit" | "qty" | "margin"; was: number | Refusal | undefined; now: number | Refusal | undefined; strong?: boolean };
  const top: Row[] = [
    { label: "Total order quantity", kind: "qty", dir: "qty", was: b?.order_qty, now: c?.order_qty },
  ];

  const byKey = new Map(detail.variance.map((r) => [r.key, r] as const));
  const costRows: BaselineRow[] = detail.variance.filter(
    (r) => !["total", "sales", "income", "profit", "margin", "cost_per_piece"].includes(r.key),
  );
  const pick = (k: string) => byKey.get(k as BaselineRow["key"]);

  const money = (r: BaselineRow | undefined, label: string, dir: Row["dir"], strong = false): Row => ({
    label,
    kind: r?.kind === "percent" ? "percent" : "amount",
    dir,
    was: r?.baseline,
    now: r?.current,
    strong,
  });

  const rows: (Row | "rule")[] = [
    ...top,
    "rule",
    money(pick("sales"), "Gross sales value (revenue)", "revenue", true),
    money(pick("income"), "Other incomes", "revenue"),
    "rule",
    ...costRows.map((r) => money(r, r.label, "cost")),
    "rule",
    money(pick("total"), "Total estimated expenses", "cost", true),
    "rule",
    money(pick("profit"), "Net profit amount", "profit", true),
    money(pick("margin"), "Net profit margin %", "margin", true),
    money(pick("cost_per_piece"), "Cost per piece", "cost"),
  ];
  /* ONLY WHAT MOVED (2026-09-23, screenshot 3028: a table of rows all reading
     "No change" buries the one that did). The profit and the margin always
     stay — they are the answer the MD is asked about. */
  const keep = (r: Row) =>
    r.label === "Net profit amount" ||
    r.label === "Net profit margin %" ||
    (() => {
      const d = delta(r.was, r.now);
      return !isRefusal(d) && d !== 0;
    })();
  const shown: (Row | "rule")[] = onlyChanged
    ? rows.filter((r): r is Row => r !== "rule").filter(keep)
    : rows;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-semibold">Financial cost head</th>
            <th className="py-2 px-3 text-right font-semibold">Original approved</th>
            <th className="py-2 px-3 text-right font-semibold">Revised proposed</th>
            <th className="py-2 px-3 text-right font-semibold">Variance (delta)</th>
            <th className="py-2 pl-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) =>
            r === "rule" ? (
              <tr key={`rule-${i}`}>
                <td colSpan={5} className="border-t border-border" />
              </tr>
            ) : (
              <tr key={r.label} className={cn("border-b border-border/60", r.strong && "font-medium")}>
                <td className="py-1.5 pr-3">{r.label}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{r.was === undefined ? "—" : fmt(r.was, r.kind, unit)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">
                  {r.now === undefined ? (
                    <span className="text-xs text-muted-foreground" title={detail.currentRefusal ?? undefined}>—</span>
                  ) : (
                    fmt(r.now, r.kind, unit)
                  )}
                </td>
                <td className="py-1.5 px-3 text-right tabular-nums">
                  {(() => {
                    const d = delta(r.was, r.now);
                    if (isRefusal(d)) return <span className="text-xs text-muted-foreground" title={d.refused}>—</span>;
                    const sign = d > 0 ? "+" : "";
                    return `${sign}${fmt(d, r.kind, unit)}`;
                  })()}
                </td>
                <td className="py-1.5 pl-3"><Direction v={delta(r.was, r.now)} kind={r.dir} /></td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AmendmentEntryScreen({ detail }: { detail: AmendmentEntryDetail }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showAllHeads, setShowAllHeads] = useState(false);
  const { row } = detail;
  /* THE TAB SAYS WHICH AMENDMENT (screenshot 3028 read "6ce01cf1 C39d" — the
     route's uuid). Above the early return, like every hook. */
  useRegisterWorkspaceTab({
    href: `/orders/order-amendments/${row.id}`,
    title: `Revision ${row.entry_no ?? `#${row.amend_no}`}`,
  });
  const isOpen = row.outcome === "open";
  const withApprover = row.status === "pending_md_approval";

  function abandon() {
    if (
      !window.confirm(
        `Abandon revision ${row.entry_no ?? ""}? Every change made under it is discarded — the order, both BOMs and the budget go back to the approved version and the order locks again.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await abandonOrderAmendment(row.id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(
        res.outcome === "restored"
          ? "Abandoned — the approved version stands and the order is locked again"
          : "Abandoned — the order stays open and needs a fresh budget approval",
      );
      router.refresh();
    });
  }

  /* RECALCULATE (spec §3.1): both BOMs' derived figures from the order as it
     stands — what Order Entry's save does by itself, on demand. */
  function recalc() {
    startTransition(async () => {
      const res = await recalculateAmendmentBoms(row.id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(res.done.length ? res.done.join(" · ") : "No BOM to recalculate yet");
      if (res.manualEntries.length) toastError(res.manualEntries.join(" · "));
      router.refresh();
    });
  }

  const gid = row.garment_order_id;
  /* THE REAL ORDER ENTRY (user 2026-09-23): an amendment is made in Order
     Entry, which unlocks only what the entry opened — not in the legacy
     `/orders/amendments` copy of the editor, which is in no sidebar row. */
  const orderHref = gid ? amendmentTabHref(row.id, "order") : null;
  const budgetHref = row.budget_id ? amendmentTabHref(row.id, "budget") : null;
  /* THE WORKSPACE'S TABS (2026-09-23): every edit is made inside the
     amendment — the tabs host each module's own editor on this order. */
  const head = {
    id: row.id,
    entry_no: row.entry_no,
    garment_order_id: row.garment_order_id,
    budget_id: row.budget_id,
    types: row.types,
    outcome: row.outcome,
    re_no: row.re_no,
    customer_name: row.customer_name,
  };

  /* SEND TO THE MD, FROM HERE (2026-09-23) — the budget's own Submit, so every
     gate it applies (freshness, the module rules, the Order Budget rule) is
     the same one; nothing needs the Budgeting screen. */
  function sendToMd() {
    if (!row.budget_id) return;
    startTransition(async () => {
      const res = await submitBudget(row.budget_id!);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success("Sent to the MD for approval");
      router.refresh();
    });
  }

  /* WHAT HAS CHANGED SO FAR, per module — the V0 diff (`order_amendment_changes`)
     grouped by the table's module, and the budget's own moved cost heads. */
  const changedIn = (prefix: string) =>
    detail.changes
      .filter((c) => c.table_name.startsWith(prefix))
      .reduce((n, c) => n + c.rows_added + c.rows_removed + c.rows_changed, 0);
  const budgetMoved = detail.variance.filter((v) => !isRefusal(v.variance) && v.variance !== 0).length;
  const moved = {
    order_entry: changedIn("garment_order_amendment"),
    fabric_bom: changedIn("order_fabric_bom"),
    material_bom: changedIn("material_bom_amendment"),
    order_budget: budgetMoved,
  };
  const anythingChanged = detail.changes.length > 0 || budgetMoved > 0;

  const picked = modulesOf(row.types);
  const bomOf = (k: "fabric_bom" | "material_bom") => detail.downstream.find((d) => d.key === k);
  const bomsStale = detail.downstream.some((d) => d.status === "recalculate" || d.status === "draft");

  /* THE FOUR STEPS, and which one the operator is on — the first not done. */
  const done = [
    anythingChanged,
    anythingChanged && !bomsStale && detail.manualEntries.length === 0,
    row.status !== "draft" && row.status !== "returned",
    !isOpen,
  ];
  const current = done.findIndex((d) => !d);

  const moduleCards: {
    key: string;
    label: string;
    hint: string;
    open: boolean;
    count: number;
    href: string | null;
    note?: string;
  }[] = [
    {
      key: "order_entry",
      label: "Order Entry",
      hint: "PO Qty, Delivery Date, FOB Price, Color Combos",
      open: picked.includes("order_entry"),
      count: moved.order_entry,
      href: orderHref,
    },
    {
      key: "fabric_bom",
      label: "Fabric BOM",
      hint: "Yarn structure, process loss, fabric allocations",
      open: picked.includes("fabric_bom"),
      count: moved.fabric_bom,
      href: gid ? amendmentTabHref(row.id, "fabric-bom") : null,
      note: bomOf("fabric_bom") ? bomStatusText(bomOf("fabric_bom")!.status) : undefined,
    },
    {
      key: "material_bom",
      label: "Material BOM",
      hint: "Trims, accessories, packaging items",
      open: picked.includes("material_bom"),
      count: moved.material_bom,
      href: gid ? amendmentTabHref(row.id, "material-bom") : null,
      note: bomOf("material_bom") ? bomStatusText(bomOf("material_bom")!.status) : undefined,
    },
    {
      key: "order_budget",
      label: "Order Budget",
      hint: "Overheads, freight, operational rates",
      open: picked.includes("order_budget"),
      count: moved.order_budget,
      href: budgetHref,
    },
  ];

  const header = (
    <PageHeader
      title={`Revision ${row.entry_no ?? `#${row.amend_no}`}`}
      description={[
        row.re_no ?? row.order_code ?? "—",
        row.customer_name ?? "—",
        `Rev #${row.amend_no}`,
        entryScopeLabel(row.types),
        originLabel(row.origin),
      ].join(" · ")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={entryStatusTone(row.status)}>{entryStatusLabel(row.status)}</StatusPill>
          <Button variant="outline" size="md" onClick={() => router.push("/orders/order-amendments")}>
            ← Back
          </Button>
          {isOpen && gid && detail.perms.canEdit && !withApprover && (
            /* ADD A MODULE (was "Amend again", 0618): supersedes this entry
               with the union, from inside the amendment. */
            <Button variant="outline" size="md" onClick={() => router.push(`/orders/order-amendments/new?order=${gid}`)}>
              + Add module
            </Button>
          )}
          {!isOpen && orderHref && (
            <Button variant="outline" size="md" onClick={() => router.push(orderHref)}>
              <ClipboardList className="h-4 w-4" /> Open order
            </Button>
          )}
          {!isOpen && budgetHref && (
            <Button size="md" onClick={() => router.push(budgetHref)}>
              <FileText className="h-4 w-4" /> Open budget
            </Button>
          )}
        </div>
      }
    />
  );

  const rejectedNote = row.status === "rejected" && (
    <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger" role="status">
      Rejected by the MD{row.rejection_reason ? ` — “${row.rejection_reason}”` : ""}. The order, both BOMs and the
      budget were reverted to the approved version, and the order is locked again.
    </p>
  );

  const variance = (
    <>
      {!detail.baseline ? (
        <p className="text-sm text-muted-foreground">No approved baseline was recorded for this entry.</p>
      ) : (
        <>
          {detail.currentRefusal && (
            <p className="mb-2 text-xs text-warning">Revised figures could not be read: {detail.currentRefusal}</p>
          )}
          <VarianceTable detail={detail} />
        </>
      )}
    </>
  );

  /* A CLOSED AMENDMENT IS A RECORD: the comparison only (user 2026-09-22, "the
     eye icon … we need the comparison only"). */
  if (!isOpen) {
    return (
      <div className="space-y-4">
        {header}
        <AmendmentTabs head={head} current="overview" />
        {rejectedNote}
        <Card>
          <CardHeader>
            <CardTitle>{`Budget variance audit${row.re_no ? ` — ${row.re_no}` : ""}`}</CardTitle>
            <span className="text-xs text-muted-foreground">Original approved vs revised proposed</span>
          </CardHeader>
          <CardBody>{variance}</CardBody>
        </Card>
      </div>
    );
  }

  /* AN OPEN AMENDMENT IS WORK — and the page answers ONE question: what do I
     do next? (user 2026-09-23, screenshot 3028: four equal cards, two notes
     that contradicted each other and a full table of "No change" read as
     "too confusing".) A slim step bar says where the job stands; one Next-step
     box names the single thing to do, with the single button that does it;
     below it, only the modules this amendment can edit, and the comparison of
     only the heads that moved. */
  const canAct = !!gid && detail.perms.canEdit;
  const openCards = moduleCards.filter((m) => m.open);
  const lockedCards = moduleCards.filter((m) => !m.open);
  const steps = ["Make the changes", "Recalculate", "Review & send", "MD approval"];

  type Next = { tone: "info" | "warning" | "success" | "danger"; title: string; body?: string; action?: React.ReactNode };
  const next: Next = (() => {
    if (row.status === "returned") {
      return {
        tone: "danger",
        title: "The MD sent this back",
        body: `${row.rejection_reason ? `“${row.rejection_reason}” — ` : ""}revise the order, then send the budget again — or abandon the revision.`,
      };
    }
    if (withApprover) {
      return {
        tone: "info",
        title: "Waiting for the MD",
        body: `Sent ${row.submitted_at ? fmtDateTime(row.submitted_at) : ""}. Nothing to do until they decide — approving makes this the new approved version, rejecting puts the order back as it was.`,
      };
    }
    if (!anythingChanged) {
      return {
        tone: "info",
        title: `Make the change${openCards.length > 1 ? "s" : ""} in ${openCards.map((m) => m.label).join(" and ") || "the order"}`,
        body: "Open its tab above (or the button below), change what the customer asked for, and save — you come straight back here.",
      };
    }
    if (bomsStale) {
      /* SAY WHY (2026-09-23, screenshot 3031: "why the recalculating BOM is
         showing, I don't know"): when each BOM was last worked out and for
         what, against what the order says now. And if a dry run shows the
         recalculation could not finish, the order's own gap is the next step,
         not the button. */
      const stale = detail.downstream.filter((d) => d.status === "recalculate" || d.status === "draft");
      const why = stale
        .map((d) => {
          const when = d.computed_at ? ` on ${fmtDate(d.computed_at)}` : "";
          const was = d.computed_for_qty != null ? ` for ${fmtNumber(d.computed_for_qty)} pcs` : "";
          const now =
            d.order_qty_now != null && d.computed_for_qty != null && d.order_qty_now !== d.computed_for_qty
              ? `; the order now needs ${fmtNumber(d.order_qty_now)} pcs`
              : "; the order's colours or sizes have changed since";
          return `${d.label} was last worked out${when}${was}${now}.`;
        })
        .join(" ");
      const blockers = [...new Set(stale.flatMap((d) => d.blockers))];
      if (blockers.length > 0) {
        return {
          tone: "warning",
          title: "Complete the order, then recalculate the BOMs",
          body: `${why} They can't be recalculated yet: ${blockers.join(" · ")}`,
          action: orderHref ? (
            <Button size="md" onClick={() => router.push(orderHref)}>
              <ClipboardList className="h-4 w-4" /> Open the Order tab
            </Button>
          ) : undefined,
        };
      }
      return {
        tone: "warning",
        title: "Recalculate the BOMs",
        body: `${why} Recalculate so their weights — and the budget — match the order.`,
        action:
          canAct ? (
            <Button size="md" onClick={recalc} disabled={isPending}>
              <RefreshCw className="h-4 w-4" /> {isPending ? "Recalculating…" : "Recalculate BOMs"}
            </Button>
          ) : undefined,
      };
    }
    if (detail.manualEntries.length > 0) {
      const n = detail.manualEntries.length;
      return {
        tone: "warning",
        title: `${n} thing${n === 1 ? "" : "s"} to fill in before sending`,
        body: "Each one opens the exact field.",
      };
    }
    return {
      tone: "success",
      title: "Ready to send to the MD",
      body: "Check the comparison below — it is what the MD will see — then send it.",
      action:
        canAct && row.budget_id ? (
          <Button size="md" onClick={sendToMd} disabled={isPending}>
            <FileText className="h-4 w-4" /> {isPending ? "Sending…" : "Send to MD"}
          </Button>
        ) : undefined,
    };
  })();
  const toneBox: Record<Next["tone"], string> = {
    info: "border-info bg-info-soft text-info",
    warning: "border-warning bg-warning-soft text-warning",
    success: "border-success bg-success-soft text-success",
    danger: "border-danger bg-danger-soft text-danger",
  };

  return (
    <div className="space-y-4">
      {header}
      <AmendmentTabs head={head} current="overview" />

      <div className="max-w-[64rem] space-y-4">
        {/* THE STEP BAR — where the job stands, one line. */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Revision progress">
          {steps.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full font-semibold",
                  done[i] ? "bg-success text-white" : i === current ? "bg-primary text-white" : "bg-surface-muted text-muted-foreground",
                )}
                aria-hidden
              >
                {done[i] ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={cn(i === current ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</span>
              {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>

        {/* THE NEXT STEP — one sentence, one button. */}
        <div className={cn("rounded-md border px-4 py-3", toneBox[next.tone])} role="status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Next: {next.title}</p>
              {next.body && <p className="mt-0.5 text-xs opacity-90">{next.body}</p>}
            </div>
            {next.action}
          </div>
          {!withApprover && detail.manualEntries.length > 0 && !bomsStale && anythingChanged && (
            <ul className="mt-2 space-y-1 border-t border-current/20 pt-2 text-xs">
              {detail.manualEntries.map((m) => (
                <li key={m.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{m.message.replace(/^Manual Entry Needed:\s*/, "")}</span>
                  {m.href && (
                    <Link href={m.href} className="font-semibold underline hover:no-underline">
                      Go to field →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* WHAT THIS AMENDMENT CAN EDIT — buttons for the opened modules only;
            the rest on one quiet line. */}
        <Card>
          <CardHeader>
            <CardTitle>You can edit</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {openCards.map((m) =>
                m.href ? (
                  <Button
                    key={m.key}
                    variant="outline"
                    size="md"
                    onClick={() => router.push(m.href!)}
                    disabled={withApprover}
                  >
                    {m.count > 0 && <Check className="h-4 w-4 text-success" aria-label="edited" />}
                    {m.label} →
                  </Button>
                ) : null,
              )}
            </div>
            {lockedCards.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Stays as approved: {lockedCards.map((m) => m.label).join(", ")}.{" "}
                {lockedCards.some((m) => m.key === "fabric_bom" || m.key === "material_bom") &&
                  "A BOM's weights still recalculate when the order changes. "}
                {lockedCards.some((m) => m.key === "order_budget") &&
                  "In the budget, only lines without a rate can be filled in."}
              </p>
            )}
          </CardBody>
        </Card>

        {/* THE COMPARISON IS THE CLOSING CHECK (user 2026-09-23, screenshot
            3030): it appears at Review & send — once the changes are made, the
            BOMs recalculated and nothing is missing — and while the MD holds
            it. Before that its figures are not final, and "No change" beside
            un-recalculated BOMs reads as a real answer. */}
        {(done[1] || withApprover) && (
          <Card>
            <CardHeader>
              <CardTitle>Before you send: approved vs revised budget</CardTitle>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => setShowAllHeads((v) => !v)}
              >
                {showAllHeads ? "Show only what changed" : "Show all heads"}
              </button>
            </CardHeader>
            <CardBody>
              {!detail.baseline ? (
                <p className="text-sm text-muted-foreground">No approved baseline was recorded for this entry.</p>
              ) : (
                <>
                  {detail.currentRefusal && (
                    <p className="mb-2 text-xs text-warning">Revised figures could not be read: {detail.currentRefusal}</p>
                  )}
                  <VarianceTable detail={detail} onlyChanged={!showAllHeads} />
                </>
              )}
            </CardBody>
          </Card>
        )}

        {canAct && (
          <div className="flex justify-end">
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-danger disabled:opacity-50"
              onClick={abandon}
              disabled={isPending || withApprover}
              title={withApprover ? "The revised budget is with the MD" : undefined}
            >
              <Undo2 className="mr-1 inline h-3.5 w-3.5" />
              {isPending ? "Abandoning…" : "Abandon this revision and go back to the approved version"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
