"use client";

/**
 * Purchase ▸ Procurement ▸ PO Approval (user 2026-10-28) — ORDERS ▸ APPROVAL'S SHAPE,
 * as near as a PO allows (`orders/budget-approval/budget-approval-screen.tsx`):
 *
 *   the Pending · Under Progress · Approved · Draft box → search → Filters → a dense
 *   table, two lines a cell → the decision icons → a FULL-SCREEN view with the
 *   decision in its header and the approval trail beside the document.
 *
 * THE APPROVER READS, THEY DO NOT EDIT. The PO is shown in Orders ▸ Approval's own page
 * layout (`po-approval-overview.tsx`): profile card · tiles, the glass ring, the lines ·
 * the approval trail and summary, one page.
 *
 * THREE DECISIONS, NOT TWO (user 2026-10-28, asked): Orders ▸ Approval has Approve ·
 * Request Rework; a PO also has Reject — closed for good, the requirement back on Raise
 * PO. Request Rework is `rejectPo` (back to draft with the note), Reject is `declinePo`.
 * Both go through the PO's approval run (0764) when it has one, so the trail and My
 * Approvals stay right; both need a remark, asked before the action is taken.
 *
 * APPROVE IS ONE CLICK, AND SEVERAL AT ONCE (user 2026-10-31, screenshot 3950: "approve
 * also one click, no need to show that … no need to ask there also, and allow choose
 * multiple PO and approve"). The row's ✓ approves outright — it used to open the full
 * view first, where Approve was asked again. Pending rows carry a tick box; ticking some
 * shows a bar with "Approve N". Each PO still goes through `approvePo` on its own, so
 * every gate holds per PO (TBA, reopened budget, the approver's signature, the run's
 * item-class step) and one refusal never stops the rest — the toast names which failed
 * and why. The PO No still opens the full view for reading; Rework and Reject keep their
 * remark, which they cannot do without.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CalendarRange, Check, FileText, Layers, RotateCcw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdGroup, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { Tooltip } from "@/components/ui/tooltip";
import { RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { HUG, creatorName, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { QUICK_WORDS_4, useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { statusTone } from "@/lib/ui/status-tone";
import { cn } from "@/lib/utils";
import { fmtDate, fmtFixed } from "@/lib/format";
import { PO_STATUS_LABELS, type PoStatus } from "@/lib/purchase/types";
import type { RaisedPo } from "@/lib/purchase/re-po/types";
import type { PoApprovalCard } from "@/lib/approvals/po-approval-cards";
import { approvePo, declinePo, rejectPo } from "@/lib/purchase/po-actions";
import { loadPoApprovalSheet } from "@/lib/purchase/po-approval-sheet-actions";
import { PoApprovalOverview } from "./po-approval-overview";

const PO_STATUS_TONE_OVERRIDES = {
  // Approved is a step in this document's life, not its end — work still follows it (as on Purchase Orders).
  approved: "info",
} as const;
const poStatusTone = (s: string): StatusTone => statusTone(s, PO_STATUS_TONE_OVERRIDES);
const poStatusText = (s: string) => PO_STATUS_LABELS[s as PoStatus] ?? s;

/**
 * WHICH WORD A PO COUNTS AS — a map, as on Orders ▸ Approval, so a state belongs to one
 * word. A draft that came back from the approver is still a draft: it is with the
 * Purchase Manager either way. Cancelled (Rejected) is under no word — shown under "All".
 */
const APPROVAL_WORD: Partial<Record<PoStatus, QuickWord>> = {
  pending_approval: "pending",
  draft: "draft",
  approved: "approved",
  partially_received: "approved",
  received: "approved",
  closed: "approved",
};
const approvalWord = (r: RaisedPo): QuickWord | null => APPROVAL_WORD[r.status as PoStatus] ?? null;

type BudgetState = "within" | "above" | "none" | "unknown";
const budgetStateOf = (c: PoApprovalCard | undefined): BudgetState =>
  !c || c.overCount == null ? "unknown" : c.overCount > 0 ? "above" : (c.unbudgetedCount ?? 0) > 0 ? "none" : "within";

function approvalFacets(rows: RaisedPo[], cards: Record<string, PoApprovalCard>): FacetGroup<RaisedPo>[] {
  const vendors = [...new Set(rows.map((r) => r.vendor).filter((v): v is string => !!v))].sort();
  return [
    {
      title: "Status & dates",
      icon: <CalendarRange />,
      facets: [
        {
          key: "status",
          label: "Status",
          all: "All",
          wide: true,
          counted: true,
          options: [...new Set(rows.map((r) => r.status))].map((s) => ({ value: s, label: poStatusText(s) })),
          match: (r, v) => r.status === v,
        },
        { key: "poDate", label: "PO Date", all: "Any date", date: (r) => r.order_date },
      ],
    },
    {
      title: "PO",
      icon: <Layers />,
      facets: [
        {
          key: "vendor",
          label: "Vendor",
          all: "Any vendor",
          wide: true,
          options: vendors.map((v) => ({ value: v, label: v })),
          match: (r, v) => r.vendor === v,
        },
        {
          key: "budget",
          label: "Budget",
          all: "Any",
          options: [
            { value: "within", label: "Within budget" },
            { value: "above", label: "Above budget" },
            { value: "none", label: "No budget" },
          ],
          match: (r, v) => budgetStateOf(cards[r.id]) === v,
        },
      ],
    },
    ...createdGroup(rows, <Users />),
  ];
}

type Loaded = Awaited<ReturnType<typeof loadPoApprovalSheet>> & { forId: string };

export function PoApprovalScreen({
  rows,
  cards = {},
  canApprove,
  initialOpenId = null,
}: {
  rows: RaisedPo[];
  /** Each PO's My Approvals card — value, lines, budget figures (null for a non-approver). */
  cards?: Record<string, PoApprovalCard>;
  /** `materials_purchase:approve`. */
  canApprove: boolean;
  /** The PO a notice link asked for (`?open=`), opened on arrival. */
  initialOpenId?: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  // ONE WAY IN, AND IT IS THE FULL VIEW — the PO No, the decision icons and `?open=`.
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  /** Rework / Reject asked for, waiting on its remark. */
  const [ask, setAsk] = useState<"rework" | "reject" | null>(null);
  const [remark, setRemark] = useState("");
  useUnsavedGuard(!!remark.trim() || isPending);

  // Loaded on open; keyed to its PO so a slow answer never paints under another PO.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!openId) return;
    void loadPoApprovalSheet(openId).then((d) => setLoaded({ forId: openId, ...d }));
  }, [openId]);
  const sheet = loaded && loaded.forId === openId ? loaded : null;

  const groups = useMemo(() => approvalFacets(rows, cards), [rows, cards]);
  const facets = useFacetFilter(rows, groups);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  const [search, setSearch] = useState("");
  /** The ticked POs — only ever pending ones this user may approve (pruned below). */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatch(r)) return false;
      if (!q) return true;
      return [r.code, r.vendor, ...r.source_nos, ...r.customers].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, facetMatch, search]);
  const quick = useQuickStatus(approvalWord, {
    words: QUICK_WORDS_4,
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
    countRows: base,
  });
  const quickMatches = quick.matches;
  const filtered = useMemo(() => base.filter(quickMatches), [base, quickMatches]);
  const decidable = (r: RaisedPo) => canApprove && r.status === "pending_approval";
  // A tick survives only while its row is on screen and still approvable.
  const pickable = filtered.filter(decidable).map((r) => r.id);
  const selected = new Set(pickable.filter((id) => picked.has(id)));

  function open(r: RaisedPo, intent: "rework" | null = null) {
    setRemark("");
    setAsk(intent);
    setOpenId(r.id);
  }
  function close() {
    setOpenId(null);
    setAsk(null);
    setRemark("");
  }
  /** Approve each PO in turn through `approvePo` — its gates per PO; refusals reported, never fatal. */
  function approveMany(ids: string[]) {
    if (!ids.length) return;
    start(async () => {
      let done = 0;
      const failed: string[] = [];
      for (const id of ids) {
        const code = rows.find((r) => r.id === id)?.code ?? "PO";
        try {
          const res = await approvePo(id);
          if (res.ok) done += 1;
          else failed.push(`${code}: ${res.error}`);
        } catch (e) {
          failed.push(`${code}: ${e instanceof Error ? e.message : "could not be approved"}`);
        }
      }
      if (done) success(done === 1 ? "Purchase order approved" : `${done} purchase orders approved`);
      if (failed.length) toastError(failed.join(" · "));
      setPicked(new Set());
      router.refresh();
    });
  }

  function run(act: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    start(async () => {
      const res = await act();
      if (!res.ok) return toastError(res.error);
      success(done);
      close();
      router.refresh();
    });
  }

  const cardOf = (r: RaisedPo) => cards[r.id];
  const columns: Column<RaisedPo>[] = [
    {
      header: "PO No",
      className: HUG,
      cell: (r) => (
        <button type="button" className="text-left" onClick={() => open(r)}>
          <span className="block font-mono text-xs font-semibold text-primary hover:underline">{r.code ?? "Draft PO"}</span>
          <span className="block text-[11px] text-muted-foreground">{r.order_date ? fmtDate(r.order_date) : "—"}</span>
        </button>
      ),
    },
    {
      // VENDOR OVER ORDERS, one column — the Customer / Style pattern.
      header: "Vendor / Orders",
      cell: (r) => (
        <span className="block max-w-[14rem]">
          <Truncated className="block">{r.vendor ?? "—"}</Truncated>
          <Truncated className="block font-mono text-[11px] text-muted-foreground">{r.source_nos.join(", ") || "—"}</Truncated>
        </span>
      ),
    },
    {
      header: "Value",
      align: "right",
      className: HUG,
      cell: (r) => {
        const c = cardOf(r);
        return (
          <span className="block whitespace-nowrap text-right tabular-nums">
            <span className="block font-semibold">{c?.total ?? `₹ ${fmtFixed(r.total_amount, 2)}`}</span>
            <span className="block text-[11px] text-muted-foreground">
              {c ? `${c.lineCount} line${c.lineCount === 1 ? "" : "s"} · incl. GST` : "incl. GST"}
            </span>
          </span>
        );
      },
    },
    {
      // THE ABOVE-BUDGET FIGURE, the margin column's place — the word, and below it what it costs.
      header: "Budget",
      className: HUG,
      cell: (r) => {
        const c = cardOf(r);
        const st = budgetStateOf(c);
        if (st === "unknown") return <span className="text-muted-foreground">—</span>;
        if (st === "within") return <span className="text-xs font-semibold text-success">Within</span>;
        if (st === "none")
          return <span className="whitespace-nowrap text-xs font-semibold text-warning">{c!.unbudgetedCount} no budget</span>;
        return (
          <span className="block whitespace-nowrap">
            <span className="block text-xs font-semibold text-danger">▲ {c!.overCount} above</span>
            <span className="block text-[11px] tabular-nums text-muted-foreground">
              −₹ {fmtFixed(c!.profitHit ?? 0, 2)} ({fmtFixed(c!.overPct ?? 0, 1)}%)
            </span>
          </span>
        );
      },
    },
    {
      header: "Status",
      className: HUG,
      cell: (r) => <StatusPill tone={poStatusTone(r.status)}>{poStatusText(r.status)}</StatusPill>,
    },
    /* THE DECISIONS, as on Orders ▸ Approval: the report first (the eye's slot), then
       Request Rework (opens the full view for its remark) and Approve — ONE CLICK, no
       second ask (2026-10-31). Drawn on every row so the column never jitters; one that
       cannot apply is greyed and says why. */
    rowActionsColumn<RaisedPo>(
      (r) => {
        const canDecide = decidable(r);
        const why = !canApprove ? "Needs the Purchase ▸ Approve permission" : "Only a PO pending approval";
        const printable = !["draft", "pending_approval", "cancelled"].includes(r.status);
        return (
          <div className="flex items-center justify-end gap-1">
            <RowIconAction
              label="PO print"
              name={r.code}
              icon={FileText}
              className="text-primary"
              onClick={printable ? () => router.push(`/purchase/orders/${r.id}/print`) : undefined}
              disabledReason={printable ? null : "Print opens once the PO is approved"}
            />
            <Tooltip label={canDecide ? "Request Rework" : `Request Rework — ${why}`}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Request Rework ${r.code ?? ""}`}
                className="text-warning"
                disabled={!canDecide || isPending}
                onClick={() => open(r, "rework")}
              >
                <RotateCcw aria-hidden className="size-4" />
              </Button>
            </Tooltip>
            <Tooltip label={canDecide ? "Approve" : `Approve — ${why}`}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Approve ${r.code ?? ""}`}
                className="text-success"
                disabled={!canDecide || isPending}
                onClick={() => approveMany([r.id])}
              >
                <Check aria-hidden className="size-4" />
              </Button>
            </Tooltip>
          </div>
        );
      },
      "w-28",
    ),
  ];

  const openRow = rows.find((r) => r.id === openId) ?? null;
  const po = sheet?.po ?? null;
  const verdict = sheet?.panel.verdict ?? null;
  // Through the run when there is one (who may act at THIS step, by item class); a PO
  // sent before 0764 has no run, and the permission decides.
  const mayDecide = !!po && po.status === "pending_approval" && (sheet?.panel.run ? !!verdict?.can_act : canApprove);
  const names: Record<string, string> = sheet?.panel.names ?? {};

  return (
    <>
      <div className="space-y-4">
        <PageHeader title="PO Approval" description="Approve, send back or reject a PO raised on Raise PO." />

        {!canApprove && (
          // SAID, NOT HIDDEN — a queue with no buttons and no reason reads as broken.
          <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            You can see POs here but not decide on them — that needs the approve permission for Purchase, granted on the
            Roles screen.
          </p>
        )}

        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search PO No, vendor, RE No or customer…"
          leading={quick.segment}
          activeCount={facets.activeCount}
          onReset={facets.activeCount ? facets.reset : undefined}
          panel={facets.panel}
          right={`${filtered.length} of ${rows.length}`}
        />

        <div className="space-y-2">
          {/* THE BULK BAR — only while something is ticked. */}
          {selected.size > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm">
              <span className="font-semibold">
                {selected.size} PO{selected.size === 1 ? "" : "s"} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm" // toolbar-size: exempt -- the bulk-selection bar, a dense bar by AGENTS.md
                disabled={isPending}
                onClick={() => setPicked(new Set())}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm" // toolbar-size: exempt -- the bulk-selection bar, a dense bar by AGENTS.md
                className="ml-auto"
                disabled={isPending}
                onClick={() => approveMany([...selected])}
              >
                <Check aria-hidden className="size-4" />
                {isPending ? "Approving…" : `Approve ${selected.size}`}
              </Button>
            </div>
          ) : null}
          <DataTable
            columns={hugCreated(withCreatedColumns(columns, filtered))}
            rows={filtered}
            getKey={(r) => r.id}
            // Tick boxes only where Approve can act; the others ignore a tick.
            selectable={canApprove && pickable.length > 0}
            selectedKeys={selected}
            onToggle={(id) =>
              pickable.includes(id) &&
              setPicked((cur) => {
                const next = new Set(cur);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onToggleAll={() => setPicked(selected.size === pickable.length ? new Set() : new Set(pickable))}
            dense
            empty={quick.value === "pending" && facets.activeCount === 0 ? "No PO is waiting for approval." : "No PO matches these filters."}
          />
        </div>
      </div>

      <Sheet
        open={!!openId}
        onClose={close}
        title={
          <span className="flex flex-col">
            <span>PO Approval</span>
            <span className="text-xs font-normal text-muted-foreground">
              Purchase / PO Approval / <span className="font-mono text-foreground">{openRow?.code ?? po?.code ?? "PO"}</span>
            </span>
          </span>
        }
        headerActions={
          mayDecide ? (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="text-warning" disabled={isPending} onClick={() => setAsk("rework")}>
                <RotateCcw aria-hidden className="size-4" />
                Request Rework
              </Button>
              <Button type="button" variant="outline" className="text-danger" disabled={isPending} onClick={() => setAsk("reject")}>
                <Ban aria-hidden className="size-4" />
                Reject
              </Button>
              <Button type="button" disabled={isPending} onClick={() => run(() => approvePo(po!.id), "Purchase order approved")}>
                <Check aria-hidden className="size-4" />
                Approve
              </Button>
            </div>
          ) : undefined
        }
        size="lg"
        fullBleed
      >
        {!po ? (
          <p className="p-4 text-sm text-muted-foreground">{openId && !sheet ? "Loading the PO…" : "This PO could not be read."}</p>
        ) : (
          <div className="space-y-3">
            {/* THE REMARK, ASKED BEFORE THE DECISION — Rework and Reject both need one
                (the engine refuses a reject without it; the requester must read why). */}
            {mayDecide && ask ? (
              <div
                className={cn(
                  "flex flex-wrap items-end gap-3 rounded-xl border px-4 py-3",
                  ask === "reject" ? "border-[#f5b8b0] bg-[#fdecea]" : "border-[#f1d48a] bg-[#fff7e0]",
                )}
              >
                <Field
                  label={ask === "reject" ? "Why reject — the PO closes for good" : "What to change — the PO goes back to the Purchase Manager"}
                  htmlFor="po-approval-remark"
                  className="min-w-64 flex-1"
                >
                  <Textarea id="po-approval-remark" rows={2} autoFocus value={remark} onChange={(e) => setRemark(e.target.value)} />
                </Field>
                <Button type="button" variant="ghost" disabled={isPending} onClick={() => setAsk(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={ask === "reject" ? "text-danger" : "text-warning"}
                  disabled={isPending || !remark.trim()}
                  title={remark.trim() ? undefined : "Write the remark first"}
                  onClick={() =>
                    ask === "reject"
                      ? run(() => declinePo(po.id, remark.trim()), "Purchase order rejected")
                      : run(() => rejectPo(po.id, remark.trim()), "Sent back for rework")
                  }
                >
                  {ask === "reject" ? "Reject PO" : "Send back for rework"}
                </Button>
              </div>
            ) : null}

            {/* THE PO IN ORDERS ▸ APPROVAL'S PAGE (canvas "PO Approval — single page",
                approved 2026-10-28) — profile card · tiles, glass ring, lines · trail,
                summary. See `po-approval-overview.tsx`. */}
            <PoApprovalOverview
              po={po}
              uoms={sheet!.uoms}
              sourceNos={sheet!.sourceNos}
              variance={sheet!.variance}
              statusPill={<StatusPill tone={poStatusTone(po.status)}>{poStatusText(po.status)}</StatusPill>}
              timeline={sheet!.panel.run ? sheet!.panel.timeline : null}
              names={names}
              raisedBy={openRow ? creatorName(openRow) : null}
              override={!!verdict?.can_act && !!verdict.is_override}
            />
          </div>
        )}
      </Sheet>
    </>
  );
}
