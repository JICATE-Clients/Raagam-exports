"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, ClipboardList, FileText, GitBranchPlus, Save, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackLink } from "@/components/ui/back-link";
import { Tooltip } from "@/components/ui/tooltip";
import { ToggleGroup } from "@/components/ui/segmented";
import { CostSheetDocument } from "@/components/sales/cost-sheet-document";
import type { EditOptions } from "@/components/sales/cost-sheet-editors";
import { QuotationDocument } from "@/components/sales/quotation-document";
import { buildCostSheetModel, type CostSheetModel } from "@/lib/sales/sample-costing/cost-sheet";
import { buildQuotationModel, type QuotationModel } from "@/lib/sales/sample-costing/quotation";
import { cloneDraft, withCalculatedQuotes } from "@/lib/sales/sample-costing/revision-draft";
import { revisionShort, type CostingDraft, type CostingRecord } from "@/lib/sales/sample-costing/types";
import type { CostingEnquiryOption, CostingStyleOption } from "@/lib/sales/sample-costing/service";
import type { RevisionHistoryRow } from "@/lib/sales/sample-costing/revision-history";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import { saveSampleCosting, submitSampleCosting } from "@/lib/sales/sample-costing/actions";
import { fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";

/**
 * Costing ▸ Reports — one door, two documents, and now the place a price is
 * negotiated (client 2026-10-09).
 *
 * The internal Cost Sheet and the buyer's Quotation are tabs, each a document you
 * READ first and then download or print. **Revise** turns the report into a
 * working view: the workbench above the sheet edits fabric rate, CMT and margin,
 * and BOTH documents re-draw from that working copy on the very same render — the
 * price, the margin gauge, the waterfall, the donut, the quotation. Nothing is
 * saved until "Save as Rev N", which writes a child revision and lands on its own
 * report.
 *
 * Both documents are built by the same two pure functions the server uses
 * (`buildCostSheetModel`, `buildQuotationModel`), so the preview and the saved
 * report cannot disagree.
 */

// Charts is a tab of the report (user 2026-10-22), not a fold at the foot of the Cost Sheet.
type Tab = "cost-sheet" | "quotation" | "charts";

/** Where a costing is revised: the newest entry screen (user 2026-10-22, Costing 6). */
export const REVISE_SCREEN = "/sales/sample-costing/costing-6";

export type ReportSource = {
  /** The saved costing — what Revise copies. */
  record: CostingRecord;
  lookups: {
    enquiries: readonly CostingEnquiryOption[];
    styles: readonly CostingStyleOption[];
    components: readonly { id: string; name: string }[];
    trims: readonly { id: string; name: string }[];
  };
  company: DocLetterhead;
  /** The masters the sheet's row pickers list while revising. */
  options: EditOptions;
  history: RevisionHistoryRow[];
  /** The sample's other costed styles — the Quotation lists them beside this one. */
  siblings: CostingRecord[];
  /** A saved Draft the reader may send to the buyer (0725: → Under Progress). */
  canSubmit: boolean;
};

const priceOf = (m: CostSheetModel) => {
  const s = m.sizes[0];
  return s ? (s.quoted ?? s.calc) : null;
};

export function CostingReports({
  cost,
  quote,
  initial,
  revise,
  source,
  openRevising = false,
}: {
  /** Open already revising (`?revise=1`) — only when Revise is allowed here. */
  openRevising?: boolean;
  cost: CostSheetModel;
  quote: QuotationModel;
  initial: Tab;
  /** Null only when the reader may not edit. `reason` is why Revise is unavailable (greyed), or null when it works. */
  revise: { id: string; nextLabel: string; reason: string | null } | null;
  source: ReportSource;
}) {
  const router = useRouter();
  /* NAVIGATING IS SLOW IN DEV AND NEVER INSTANT, and a click that shows nothing for
     ten seconds reads as a dead button (client 2026-10-09: "I clicked it, it is not
     opening"). Every jump this page makes goes through one transition: the control
     says so and the page dims until the next screen is ready. */
  const [saving, startSave] = useTransition();
  const [tab, setTab] = useState<Tab>(initial);

  /** The working copy while revising; null when just reading. */
  const [draft, setDraft] = useState<CostingDraft | null>(() =>
    openRevising && revise && !revise.reason ? cloneDraft(source.record.draft) : null,
  );
  /** Quotes the merchandiser typed on the sheet — held; every other quote follows the costs. */
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  const revising = draft != null;
  // A revision is typed work: a silent deploy must not reload it away, nor land
  // mid-save and lose the outcome (AGENTS.md "Auto-reload guard").
  useUnsavedGuard(revising || saving);
  const nextVersion = source.record.version + 1;
  // The draft as it will be SAVED — price following the costs, unless held.
  const effective = draft ? withCalculatedQuotes(draft, held) : null;
  const liveRecord: CostingRecord | null = effective
    ? { ...source.record, version: nextVersion, status: "draft", is_draft: false, decision_remark: null, draft: effective }
    : null;
  const costShown = liveRecord ? buildCostSheetModel(liveRecord, source.lookups, source.company, source.history, null) : cost;
  const quoteShown = liveRecord ? buildQuotationModel(liveRecord, source.lookups, source.company, source.history, null, source.siblings) : quote;

  const pick = (t: Tab) => {
    setTab(t);
    // Keep the address honest, so a refresh or a shared link reopens this tab.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };

  /* REVISE OPENS THE COSTING ENTRY SCREEN (user 2026-10-22: "we need the costing entry
     screen for the revise also" — Costing 6). The next Rev is edited where costings are
     entered, not in this page's one-page sheet; Costing 6 loads it as "Rev N (new)" and
     its Save writes it. This page goes back to reading, printing and downloading. */
  function startRevising() {
    if (!revise) return;
    router.push(`${REVISE_SCREEN}?reviseFrom=${revise.id}`);
  }
  function stopRevising() {
    setDraft(null);
    setMessage(null);
  }
  function saveRevision() {
    if (!effective) return;
    setMessage(null);
    startSave(async () => {
      const res = await saveSampleCosting(null, effective, { isDraft: false, parentId: source.record.id });
      if (!res.ok) {
        setMessage({ tone: "error", text: res.error });
        return;
      }
      setDraft(null);
      router.push(`/sales/sample-costing/${res.id}/reports?tab=${tab}`);
    });
  }
  function submitIt() {
    setMessage(null);
    startSave(async () => {
      const res = await submitSampleCosting(source.record.id);
      if (!res.ok) {
        setMessage({ tone: "error", text: res.error });
        return;
      }
      setMessage({
        tone: "ok",
        text: "Sent to the buyer — Under Progress.",
      });
      router.refresh();
    });
  }

  const was = priceOf(cost);
  const now = priceOf(costShown);
  const delta = was != null && now != null && was !== 0 ? ((now - was) / was) * 100 : null;
  const ccy = costShown.currency ?? "";

  /* ONE TOOLBAR (client 2026-10-09, screenshot 3427: "make in single with better
     ui"). The tabs, the document's size switch and downloads, and Revise / Submit
     were two rows; the document now draws the only row and these go into it. */
  const lead = (
    <>
    {/* First in the bar: the way back to the costing this report belongs to. */}
    {/* To the LIST, where the Reports icon lives (user 2026-10-14: reports on the list only) — not into the editor (2026-10-15). */}
    <BackLink target={{ href: "/sales/sample-costing", label: "Costing" }} />
    <ToggleGroup<Tab>
      role="tablist"
      label="Report"
      value={tab}
      onChange={pick}
      options={[
        { value: "cost-sheet", label: "Cost Sheet", icon: ClipboardList },
        { value: "quotation", label: "Quotation", icon: FileText },
        { value: "charts", label: "Charts", icon: BarChart3 },
      ]}
    />
    </>
  );
  const trail = revising ? null : (
    <>
      {/* NO REVISION PICKER HERE (user 2026-10-17, screenshot 3606: "remove the top bar
          rev option … already we have separate tab for it"). The sheet's Revisions tab
          lists every revision and each row opens that revision's report. */}
      {revise ? (
        /* The button says "Revise" alone — "Revise → Rev 2" beside "Rev 1 · USD 4.50" read
           Rev twice (user 2026-10-17). The next number moves into the tooltip. */
        <Tooltip label={revise.reason ?? `Make ${revise.nextLabel} in the costing entry screen — every figure carried over, saved as the next Rev`}>
          {/* A disabled button swallows the hover, so it lets the pointer through to
              the Tooltip's own wrapper — otherwise the reason it is greyed never shows. */}
          <Button variant="outline" size="md" className={revise.reason ? "pointer-events-none" : undefined} disabled={!!revise.reason} onClick={startRevising}>
            <GitBranchPlus className="h-4 w-4" />
            Revise
          </Button>
        </Tooltip>
      ) : null}
      {/* Reached only by a Rev raised from a Rejected costing, which 0728 still
          starts as a Draft — every other save lands Under Progress itself. */}
      {source.canSubmit ? (
        <Button size="md" disabled={saving} onClick={submitIt}>
          <Send className="h-4 w-4" />
          {saving ? "Sending…" : "Send to Buyer"}
        </Button>
      ) : null}
    </>
  );
  const bar = {
    lead,
    trail,
    // Submit is the next step when it shows, so it is the one filled button.
    quietDownload: source.canSubmit && !revising,
  };

  return (
    /* THE SAVE BAR SITS AT THE BOTTOM OF THE SCREEN, LIKE AN EDITOR'S FOOTER (user
       2026-10-15, screenshot 3522: "the bottom bar went to screen — set as bottom bar
       how we use it in child"). On a short tab (Details) the bar rode up under the
       content: `sticky bottom-0` can only reach the bottom of its OWN container, and
       this root was only as tall as the sheet. It now fills the page (`flex-1`, the
       page root fills <main>) and the sheet takes the slack, so the bar is last
       and at the bottom on every tab — MasterFullScreen's "fills its scrollport". */
    <div className="flex flex-1 flex-col gap-3">
      {message ? (
        <p
          className="rounded-lg border border-border px-3 py-2 text-sm"
          style={{ background: `color-mix(in oklab, var(${message.tone === "error" ? "--danger" : "--success"}) 10%, transparent)` }}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex-1">
        {tab === "charts" ? <CostSheetDocument {...bar} onePage chartsOnly model={costShown} locked={revising} /> : tab === "cost-sheet" ? <CostSheetDocument {...bar} onePage model={costShown} locked={revising} edit={effective ? { draft: effective, onChange: setDraft, onQuote: (k) => setHeld((h) => new Set(h).add(k)), options: source.options } : undefined} /> : <QuotationDocument {...bar} model={quoteShown} locked={revising} />}
      </div>

      {/* THE SAVE BAR — ATTACHED TO THE BOTTOM, THE EDITOR FOOTER'S OWN BAND (user
          2026-10-14: "that floating bottom bar — move and attach with footer"). It
          was a rounded, shadowed card floating over the sheet; it is now the
          MasterFullScreen footer's shape: edge to edge across the pane (`-mx-4`
          cancels <main>'s p-4), a top rule, `bg-primary-soft`, no corners, no
          shadow, pinned to the bottom edge while the report scrolls under it. */}
      {/* FLUSH WITH THE WINDOW'S BOTTOM EDGE (user 2026-10-15, screenshot 3529: "still
          floating — attach with bottom"). <main> keeps md:pb-6 under every page, and a
          sticky box stops at that padding, so the bar hung 24px above the edge with a strip
          of page under it. md:-bottom-6 sticks it into the padding; md:-mb-6 lets it reach
          the edge at the end of a short tab too. Phones keep their gap: there it is the
          room the bottom tab bar needs. */}
      {revising && draft ? (
        <div
          className="sticky bottom-0 z-20 -mx-4 flex md:-bottom-6 md:-mb-6 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-primary-soft px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
          role="region"
          aria-label="Revision in progress"
        >
          <div className="min-w-0 text-sm">
            <b className="text-primary">{revisionShort(nextVersion)}</b> · not saved ·{" "}
            <b className="font-mono tabular-nums">
              {ccy} {now == null ? "—" : now.toFixed(2)}
            </b>
            {was != null ? (
              <span className="text-muted-foreground">
                {" "}(was {was.toFixed(2)}
                {delta != null && Math.abs(delta) >= 0.05 ? `, ${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%` : ""})
              </span>
            ) : null}
            {costShown.lowestMarginPct != null ? (
              <span className="text-muted-foreground"> · lowest margin <b className="text-foreground">{fmtNumber(Math.round(costShown.lowestMarginPct * 10) / 10)}%</b></span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="md" disabled={saving} onClick={stopRevising}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button size="md" disabled={saving} onClick={saveRevision}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : `Save as ${revisionShort(nextVersion)}`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
