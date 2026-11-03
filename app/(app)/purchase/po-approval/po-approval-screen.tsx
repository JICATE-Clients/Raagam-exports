"use client";

/**
 * Purchase ▸ Procurement ▸ PO Approval — ONE SCREEN FOR EVERY PO, OVER BUDGET OR NOT
 * (user 2026-11-03: "merge PO Approval and More than Budget Approval in one single
 * screen … better UI, uncomplicated, clean"; plan artifact "PO Approval and More than
 * Budget Plan", recommendations accepted: remark required to approve over budget, bulk
 * approve only within / no budget, the detail beside the list).
 *
 *   status box + Any budget / Over budget + search + Filters
 *   ┌ the list ───────────┐ ┌ the selected PO ─────────────────────────────┐
 *   │ ☐ PO No · pill      │ │ facts · budget banner · reason · lines        │
 *   │   vendor · RE · ₹   │ │ remark · Reject · Request Rework · Approve    │
 *   └─────────────────────┘ └ approval trail ──────────────────────────────┘
 *
 * More than Budget Approval (`/purchase/over-budget`) is this screen with "Over budget"
 * selected — its route redirects here and its sidebar row is gone. An over-budget PO is
 * the same detail with a budget block, never a different screen.
 *
 * THREE DECISIONS (2026-10-28): Approve · Request Rework (`rejectPo`, back to draft with
 * the note) · Reject (`declinePo`, closed, the requirement back on Raise PO). All go
 * through the PO's approval run (0764) when it has one, so the trail and My Approvals
 * stay right, and the run decides WHO may act (the MD on an above-budget PO).
 *
 * BULK APPROVE (2026-10-31) is kept for within-budget and no-budget POs only: an
 * over-budget row has no tick box, because its excess has to be read — and a remark
 * written — before it is approved. Each PO still goes through `approvePo` on its own, so
 * every gate holds per PO and one refusal never stops the rest.
 *
 * PHONE: the list, then a tapped PO full width with "← PO list" back. Desktop: both,
 * the first PO selected on arrival.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, CalendarRange, Check, FileText, Layers, RotateCcw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdGroup, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { creatorName, HUG, withCreatedColumns } from "@/components/ui/created-columns";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowIconAction } from "@/components/ui/row-actions";
import { QUICK_WORDS_4, useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { statusTone } from "@/lib/ui/status-tone";
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
 * word. A draft that came back from the approver is still a draft. Cancelled (Rejected)
 * is under no word — shown under "All".
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

/**
 * A PO's budget state. `over` also covers a reader who may not see figures (a Purchase
 * Manager): the save refuses an above-budget send without a reason, so a reason on the
 * PO means it was sent above budget. `unknown` = no figures and no reason.
 */
type BudgetState = "over" | "within" | "none" | "unknown";
function budgetStateOf(c: PoApprovalCard | undefined): BudgetState {
  if (!c) return "unknown";
  if (c.overCount == null) return c.reason ? "over" : "unknown";
  if (c.overCount > 0) return "over";
  return c.unbudgetedCount && c.unbudgetedCount >= c.lineCount ? "none" : "within";
}
/* WITHIN / OVER, NO "ANY" (user 2026-11-03: "Any Budget instead of Within budget, rename the
   label and filter only within budget orders only"). The two words split the queue by the
   PO's budget state; "within" is strictly `within` — a PO whose lines carry no approved
   budget ("none") or whose figures this reader may not see ("unknown") is in neither. */
type BudgetView = "within" | "over";

function approvalFacets(rows: RaisedPo[]): FacetGroup<RaisedPo>[] {
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
  initialBudget = "within",
}: {
  rows: RaisedPo[];
  /** Each PO's My Approvals card — value, lines, budget figures (null for a non-approver). */
  cards?: Record<string, PoApprovalCard>;
  /** `materials_purchase:approve`. */
  canApprove: boolean;
  /** The PO a notice link asked for (`?open=`), selected on arrival. */
  initialOpenId?: string | null;
  /** `?budget=over` — More than Budget Approval's old address lands here. */
  initialBudget?: BudgetView;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  /** The PO the operator picked. null on a phone = the list; on a desktop the first row shows. */
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [remark, setRemark] = useState("");
  useUnsavedGuard(!!remark.trim() || isPending);

  const [budget, setBudget] = useState<BudgetView>(initialBudget);
  const groups = useMemo(() => approvalFacets(rows), [rows]);
  const facets = useFacetFilter(rows, groups);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  const [search, setSearch] = useState("");
  /** The ticked POs — only ever pending, within / no budget, approvable (pruned below). */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  const stateOf = (r: RaisedPo) => budgetStateOf(cards[r.id]);
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatch(r)) return false;
      if (budgetStateOf(cards[r.id]) !== budget) return false;
      if (!q) return true;
      return [r.code, r.vendor, ...r.source_nos, ...r.customers].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, cards, facetMatch, search, budget]);
  const quick = useQuickStatus(approvalWord, {
    words: QUICK_WORDS_4,
    standDown: !!facets.values.status,
    // A word picked while a PO is open goes back to that word's list (the table views
    // show an opened PO in place of the table).
    onPick: () => {
      setFacet("status", "");
      setOpenId(null);
    },
    countRows: base,
  });
  const quickMatches = quick.matches;
  const filtered = useMemo(() => base.filter(quickMatches), [base, quickMatches]);
  const overCount = rows.filter((r) => budgetStateOf(cards[r.id]) === "over" && quickMatches(r)).length;
  const withinCount = rows.filter((r) => budgetStateOf(cards[r.id]) === "within" && quickMatches(r)).length;

  const decidable = (r: RaisedPo) => canApprove && r.status === "pending_approval";
  const printable = (r: RaisedPo) => !["draft", "pending_approval", "cancelled"].includes(r.status);
  // Bulk only where the excess needs no reading: never an over-budget PO.
  const tickable = (r: RaisedPo) => decidable(r) && stateOf(r) !== "over";
  const pickable = filtered.filter(tickable).map((r) => r.id);
  const selected = new Set(pickable.filter((id) => picked.has(id)));

  // The PO in the detail: the one picked, else (desktop) the first on the page.
  /* APPROVED IS A TABLE (user 2026-11-03, screenshot 4005: "for approved screen can use our
     table layout is enough"). Nothing is decided there, so the card list + detail pane — built
     for reading a PO before approving it — is only a long way to see a register. The other
     words keep the split view, where the decisions are. */
  // NOT under "Over budget" (user 2026-11-03: "update approved only … restore the over budget
  // screen") — the over-budget view keeps the list + detail, where the excess is read.
  // PENDING AND UNDER PROGRESS TOO (user 2026-11-03: "the pending and under progress also as
  // table … same compact, fit screen without scrolling"). A Pending row's PO No opens its detail
  // IN PLACE of the table — remark, Reject, Request Rework, Approve — with "← PO list" back.
  // EVERY WORD, AND OVER BUDGET TOO (user 2026-11-03: "the same screen is applicable for the
  // full Under Progress · Approved · Draft · Over budget … apply it based on criteria"). One
  // shape — the table, and a PO No opening the 3-column view in place — and what a row OFFERS
  // follows the PO's state, not the word: decisions only on a pending PO, print once approved.
  // The list + side-pane split (and `po-approval-detail.tsx`) is gone.
  const isApprovedView = quick.value === "approved";
  const openValid = !!openId && rows.some((r) => r.id === openId);
  const detailId = openValid ? openId : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!detailId) return;
    void loadPoApprovalSheet(detailId).then((d) => setLoaded({ forId: detailId, ...d }));
  }, [detailId]);
  const sheet = loaded && loaded.forId === detailId ? loaded : null;

  function pick(id: string) {
    if (id !== detailId) setRemark("");
    setOpenId(id);
  }
  /** After a decision, move to the next PO in the list — the approver works down it. */
  function advance(fromId: string) {
    const i = filtered.findIndex((r) => r.id === fromId);
    const next = filtered[i + 1] ?? filtered[i - 1] ?? null;
    setRemark("");
    setOpenId(next?.id ?? null);
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

  function decide(id: string, act: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    start(async () => {
      const res = await act();
      if (!res.ok) return toastError(res.error);
      success(done);
      advance(id);
      router.refresh();
    });
  }

  const detailRow = rows.find((r) => r.id === detailId) ?? null;
  const po = sheet?.po ?? null;
  const verdict = sheet?.panel.verdict ?? null;
  // Through the run when there is one (who may act at THIS step); a PO sent before 0764
  // has no run, and the permission decides.
  const mayDecide = !!po && po.status === "pending_approval" && (sheet?.panel.run ? !!verdict?.can_act : canApprove);
  const detailOver = detailRow ? stateOf(detailRow) === "over" : false;
  const note = remark.trim();

  const decision =
    po && mayDecide ? (
      <div className="space-y-2 rounded-lg border border-border bg-surface-muted/50 p-3">
        <Field
          label={detailOver ? "Remark — needed to approve over budget, and to send back or reject" : "Remark — needed to send back or reject"}
          htmlFor="po-approval-remark"
        >
          <Textarea id="po-approval-remark" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="text-danger"
            disabled={isPending || !note}
            title={note ? "The PO closes for good; its requirement goes back to Raise PO" : "Write the remark first"}
            onClick={() => decide(po.id, () => declinePo(po.id, note), "Purchase order rejected")}
          >
            <Ban aria-hidden className="size-4" />
            Reject
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-warning"
            disabled={isPending || !note}
            title={note ? "Back to the Purchase Manager with the remark" : "Write the remark first"}
            onClick={() => decide(po.id, () => rejectPo(po.id, note), "Sent back for rework")}
          >
            <RotateCcw aria-hidden className="size-4" />
            Request Rework
          </Button>
          <Button
            type="button"
            disabled={isPending || (detailOver && !note)}
            title={detailOver && !note ? "Write why the excess is accepted first" : undefined}
            onClick={() => decide(po.id, () => approvePo(po.id, note || undefined), "Purchase order approved")}
          >
            <Check aria-hidden className="size-4" />
            {detailOver ? "Approve over budget" : "Approve"}
          </Button>
        </div>
      </div>
    ) : null;

  const togglePick = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const showTicks = !isApprovedView && filtered.some(decidable);

  const tableColumns: Column<RaisedPo>[] = withCreatedColumns<RaisedPo>(
    [
      // Bulk approve — a plain column, not DataTable's `selectable`, because an over-budget row
      // keeps its box GREYED (read the excess, approve with a remark) and `selectable` cannot.
      ...(showTicks
        ? [
            {
              header: "",
              className: HUG,
              cell: (r: RaisedPo) =>
                decidable(r) ? (
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)] disabled:opacity-40"
                    aria-label={`Select ${r.code ?? "PO"}`}
                    title={tickable(r) ? undefined : "Over budget — open it, read the excess and approve with a remark"}
                    disabled={!tickable(r) || isPending}
                    checked={selected.has(r.id)}
                    onChange={() => togglePick(r.id)}
                  />
                ) : null,
            },
          ]
        : []),
      {
        header: "PO No",
        className: HUG,
        cell: (r) => (
          <button type="button" onClick={() => pick(r.id)} className="font-mono text-xs font-semibold text-primary hover:underline">
            {r.code ?? "Draft PO"}
          </button>
        ),
      },
      { header: "PO Date", className: HUG, cell: (r) => (r.order_date ? fmtDate(r.order_date) : "—") },
      // Vendor takes the spare width and WRAPS a long name — never pushes the row past the pane.
      { header: "Vendor", className: "w-full", cell: (r) => r.vendor ?? "—" },
      /* ITEM (user 2026-11-03, screenshot 4019: "item name is missing in table listing").
         Every line's item, in line order, joined with " · " and cut at 22rem with its reveal —
         so a PO of several items shows the first in full and the hover lists them all. */
      {
        header: "Item",
        cell: (r) => {
          const items = cards[r.id]?.items ?? [];
          return items.length ? <Truncated text={items.join(" · ")} className="block max-w-[22rem]" /> : "—";
        },
      },
      { header: "RE No", className: HUG, cell: (r) => r.source_nos.join(", ") || "—" },
      // NO LINES OR BUDGET COLUMN (user 2026-11-03, screenshot 4017: "this no need remove it"):
      // the Over budget switch finds an over-budget PO, and its detail says by how much.
      {
        header: "Value",
        align: "right",
        className: HUG,
        cell: (r) => <span className="tabular-nums">{cards[r.id]?.total ?? `₹ ${fmtFixed(r.total_amount, 2)}`}</span>,
      },
      // FITS WITHOUT A SIDEWAYS SCROLL (user 2026-11-03, screenshot 4006): the box above already
      // says Approved, so Status is a column only while a row has moved on from it (Partly
      // received, Received, Closed — all counted as Approved there).
      ...(isApprovedView && filtered.some((r) => r.status !== "approved")
        ? [{ header: "Status", className: HUG, cell: (r: RaisedPo) => <StatusPill tone={poStatusTone(r.status)}>{poStatusText(r.status)}</StatusPill> }]
        : []),
      // The report icon (the PO list's shape): an approved PO prints; a draft, pending or
      // rejected one cannot yet — a column only while some row on screen can print.
      ...(filtered.some(printable)
        ? [
            {
              header: "",
              className: HUG,
              cell: (r: RaisedPo) =>
                printable(r) ? <RowIconAction label="PO print" name={r.code} icon={FileText} onClick={() => router.push(`/purchase/orders/${r.id}/print`)} /> : null,
            },
          ]
        : []),
      /* THE DECISIONS ON THE ROW (user 2026-11-03, screenshot 4014: "there is no option for
         approving in this listing screen but previously we had it"). The table layout of the
         same day dropped 5810df18's row icons, leaving only the tick box. Drawn on every
         undecided row so the column never jitters; one that cannot apply is greyed and says
         why. Approve is ONE CLICK within / no budget; an over-budget PO opens its detail
         instead, because approving it needs the remark. Rework always needs a remark, so it
         opens the detail too. */
      // A column only while a PENDING PO is on screen (Draft, Under Progress and Approved have
      // nothing to decide); greyed with the reason for a reader without the permission.
      ...(filtered.some((r) => r.status === "pending_approval")
        ? [
            {
              header: "",
              className: HUG,
              cell: (r: RaisedPo) => {
                if (r.status !== "pending_approval") return null;
                const canDecide = decidable(r);
                const why = !canApprove ? "Needs the Purchase ▸ Approve permission" : "Only a PO pending approval";
                const over = stateOf(r) === "over";
                return (
                  <div className="flex items-center justify-end gap-0.5">
                    <RowIconAction
                      label="Request Rework"
                      name={r.code}
                      icon={RotateCcw}
                      className="text-warning"
                      disabledReason={canDecide ? (isPending ? "Working…" : null) : why}
                      onClick={() => pick(r.id)}
                    />
                    <RowIconAction
                      label={over ? "Approve over budget — open it and write the remark" : "Approve"}
                      name={r.code}
                      icon={Check}
                      className="text-success"
                      disabledReason={canDecide ? (isPending ? "Working…" : null) : why}
                      onClick={() => (over ? pick(r.id) : approveMany([r.id]))}
                    />
                  </div>
                );
              },
            },
          ]
        : []),
    ],
    filtered,
  );

  const bulkBar =
    selected.size > 0 ? (

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm">
              <span className="font-semibold">{selected.size} selected</span>
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
    ) : null;

  const detailBody = (
    !detailId ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Pick a PO from the list.</p>
          ) : !sheet ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading the PO…</p>
          ) : !po ? (
            <p className="py-8 text-center text-sm text-muted-foreground">This PO could not be read.</p>
          ) : null
  );

  return (
    <div className="space-y-4">
      <PageHeader title="PO Approval" description="Every PO waits here for approval before it can print. Over-budget POs go to the MD." />

      {!canApprove && (
        // SAID, NOT HIDDEN — a queue with no buttons and no reason reads as broken.
        <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          You can see POs here but not decide on them — that needs the approve permission for Purchase, granted on the Roles screen.
        </p>
      )}

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search PO No, vendor, RE No or customer…"
        leading={
          <div className="flex flex-wrap items-center gap-2">
            {quick.segment}
            <ToggleGroup<BudgetView>
              label="Budget"
              value={budget}
              onChange={setBudget}
              options={[
                { value: "within", label: `Within budget (${withinCount})` },
                { value: "over", label: `Over budget (${overCount})` },
              ]}
            />
          </div>
        }
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
      />

      {detailId ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-4" />
            PO list
          </button>
          {/* THE FULL-WIDTH VIEW IS THE 3-COLUMN PAGE (user 2026-11-03, screenshot 4015: "this
              screen also previously was … now look collapsed"). Opened in place of the table
              it has the whole pane, so it draws Orders ▸ Approval's layout it had until this
              morning — profile card · tiles, ring, lines · trail — not the narrow side-pane
              detail stretched into one long column. The decisions sit under it. */}
          {po && sheet ? (
            <div className="space-y-4">
              <PoApprovalOverview
                po={po}
                uoms={sheet.uoms}
                sourceNos={sheet.sourceNos}
                variance={sheet.variance}
                statusPill={<StatusPill tone={poStatusTone(po.status)}>{poStatusText(po.status)}</StatusPill>}
                timeline={sheet.panel.run ? sheet.panel.timeline : null}
                names={sheet.panel.names ?? {}}
                raisedBy={detailRow ? creatorName(detailRow) : null}
                override={!!verdict?.can_act && !!verdict.is_override}
              />
              {decision}
            </div>
          ) : (
            detailBody
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {bulkBar}
          <DataTable
            columns={tableColumns}
            dense="spacing"
            rows={filtered}
            getKey={(r) => r.id}
            empty={
              budget === "over"
                ? "No PO over budget here."
                : budget === "within" && !search.trim() && facets.activeCount === 0
                  ? "No PO within budget here."
                : quick.value === "pending" && facets.activeCount === 0 && !search.trim()
                  ? "No PO is waiting for approval."
                  : "No PO matches these filters."
            }
          />
        </div>
      )}
    </div>
  );
}
