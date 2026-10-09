"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, FileText, GitBranchPlus, Save, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Select } from "@/components/ui/select";
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

type Tab = "cost-sheet" | "quotation";

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
  /** A saved, unsubmitted draft the reader may submit for approval. */
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
}: {
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
  const [going, startGo] = useTransition();
  const go = (href: string) => startGo(() => router.push(href));
  const [saving, startSave] = useTransition();
  const [tab, setTab] = useState<Tab>(initial);

  /** The working copy while revising; null when just reading. */
  const [draft, setDraft] = useState<CostingDraft | null>(null);
  /** Quotes the merchandiser typed on the sheet — held; every other quote follows the costs. */
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  const revising = draft != null;
  const nextVersion = source.record.version + 1;
  // The draft as it will be SAVED — price following the costs, unless held.
  const effective = draft ? withCalculatedQuotes(draft, held) : null;
  const liveRecord: CostingRecord | null = effective
    ? { ...source.record, version: nextVersion, status: "draft", is_draft: false, decision_remark: null, draft: effective }
    : null;
  const costShown = liveRecord ? buildCostSheetModel(liveRecord, source.lookups, source.company, source.history, null) : cost;
  const quoteShown = liveRecord ? buildQuotationModel(liveRecord, source.lookups, source.company, source.history, null) : quote;

  const pick = (t: Tab) => {
    setTab(t);
    // Keep the address honest, so a refresh or a shared link reopens this tab.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };

  function startRevising() {
    setDraft(cloneDraft(source.record.draft));
    setHeld(new Set());
    setMessage(null);
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
        text: res.outcome === "approved" ? "Approved — every quote clears the margin floor." : "Sent to the MD for approval.",
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
    <ToggleGroup<Tab>
      role="tablist"
      label="Report"
      value={tab}
      onChange={pick}
      options={[
        { value: "cost-sheet", label: "Cost Sheet", icon: ClipboardList },
        { value: "quotation", label: "Quotation", icon: FileText },
      ]}
    />
  );
  const trail = revising ? null : (
    <>
      {/* PICK A REVISION, AND THE WHOLE SHEET FOLLOWS (client 2026-10-09: "the
          sheet will visually update — the chart, the cost, everything"). Each
          revision is its own saved costing, so choosing one opens THAT
          revision's report on the tab already open. */}
      {cost.history.length > 1 ? (
        <Select value={cost.id} disabled={going} onChange={(e) => go(`/sales/sample-costing/${e.target.value}/reports?tab=${tab}`)} aria-label="Revision shown" className="w-56">
          {cost.history.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
              {r.price != null ? ` · ${cost.currency ?? ""} ${r.price.toFixed(2)}` : ""}
              {r.current ? "  (shown)" : ""}
            </option>
          ))}
        </Select>
      ) : null}
      {revise ? (
        <Tooltip label={revise.reason ?? "Change fabric rate, CMT or margin right here and watch the report update"}>
          {/* A disabled button swallows the hover, so it lets the pointer through to
              the Tooltip's own wrapper — otherwise the reason it is greyed never shows. */}
          <Button variant="outline" size="md" className={revise.reason ? "pointer-events-none" : undefined} disabled={!!revise.reason || going} onClick={startRevising}>
            <GitBranchPlus className="h-4 w-4" />
            {revise.reason ? "Revise" : `Revise → ${revise.nextLabel}`}
          </Button>
        </Tooltip>
      ) : null}
      {source.canSubmit ? (
        <Button size="md" disabled={saving} onClick={submitIt}>
          <Send className="h-4 w-4" />
          {saving ? "Submitting…" : "Submit for approval"}
        </Button>
      ) : null}
    </>
  );
  const bar = {
    lead,
    trail,
    // Submit is the next step when it shows, so it is the one filled button.
    quietDownload: source.canSubmit && !revising,
    lockedHint: `Save as ${revisionShort(nextVersion)} to download or print`,
  };

  return (
    <div className="space-y-3">
      {message ? (
        <p
          className="rounded-lg border border-border px-3 py-2 text-sm"
          style={{ background: `color-mix(in oklab, var(${message.tone === "error" ? "--danger" : "--success"}) 10%, transparent)` }}
          role={message.tone === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}

      <div className={going ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={going}>
        {tab === "cost-sheet" ? <CostSheetDocument {...bar} model={costShown} locked={revising} edit={effective ? { draft: effective, onChange: setDraft, onQuote: (k) => setHeld((h) => new Set(h).add(k)), options: source.options } : undefined} /> : <QuotationDocument {...bar} model={quoteShown} locked={revising} />}
      </div>

      {/* THE SAVE BAR — one line along the bottom, like an editor's footer, so the sheet
          above is all report and the way out is always in reach. */}
      {revising && draft ? (
        <div
          className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-2.5 shadow-lg"
          style={{ borderColor: "color-mix(in oklab, var(--primary) 40%, var(--border))", background: "var(--background, #fff)" }}
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
