"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Check, Layers, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdByFacet, createdDateFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { RowIconAction } from "@/components/ui/row-actions";
import { Tooltip } from "@/components/ui/tooltip";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import { useQuickStatus } from "@/components/orders/bom-queue";
import { SampleCards } from "@/components/sales/sample-queue";
import { PdRequestSheet, pdRequestNo } from "@/components/sales/pd-request-sheet";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { PdRequestRow } from "@/lib/sales/pd-requests/types";
import { pdState, pdWord } from "@/lib/sales/pd-requests/words";
import { PD_STATUS_LABEL } from "@/lib/sales/sample-entry/types";

const PATH = "/sales/pd-acknowledge";

/**
 * THE QUEUE'S FILTERS PANEL — Plan Approval's, for a request. The queue still
 * OPENS on the work: that is the Pending box on the search row, not this panel.
 * A request's Created Date IS its Sent date, so the Created pair reads
 * "Sent" / "Sent By" here rather than offering the same date twice.
 */
function pdFacets(rows: PdRequestRow[]): FacetGroup<PdRequestRow>[] {
  return [
    {
      title: "Status",
      icon: <Layers />,
      facets: [
        {
          key: "status",
          label: "Status",
          all: "All",
          wide: true,
          counted: true,
          options: (["requested", "acknowledged", "not_acknowledged", "cancelled"] as const).map((s) => ({ value: s, label: PD_STATUS_LABEL[s] })),
          match: (r, v) => r.status === v,
        },
      ],
    },
    {
      title: "Dates",
      icon: <CalendarRange />,
      facets: [
        { ...createdDateFacet<PdRequestRow>(), label: "Sent" },
        { key: "answered", label: "Answered", all: "Any date", date: (r) => r.decided_at },
      ],
    },
    ...(hasCreatedInfo(rows) ? [{ title: "Sent By", icon: <Users />, facets: [{ ...createdByFacet<PdRequestRow>(), label: "Sent By" }] }] : []),
  ];
}

/**
 * Sample ▸ PD Acknowledge — the Sample Department's queue. See page.tsx.
 *
 * Opens on Pending: the requests still waiting on the department, as cards,
 * one per SMP (0724). A card opens the request with Acknowledge / Not
 * Acknowledged in its header; the card's ✓ and ✕ open the same sheet.
 */
export function PdAcknowledgeScreen({
  rows,
  canApprove,
  initialOpen,
}: {
  rows: PdRequestRow[];
  /** `approvals:approve` — whether to say up front that this user cannot
   *  decide. The ENGINE still decides who may act (`approval_can_act`). */
  canApprove: boolean;
  initialOpen: string | null;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpen);

  const groups = useMemo(() => pdFacets(rows), [rows]);
  const facets = useFacetFilter(rows, groups);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  /* THE SET THE BOX COUNTS OVER — search and panel applied, the box's own word
     left off, so a count is exactly what clicking it would show. */
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatch(r)) return false;
      if (!needle) return true;
      return [r.swo_no, r.customer, r.season, r.note, r.created_by_name, ...r.smp_nos, ...r.style_names].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [rows, query, facetMatch]);
  // The box stands down while the panel's Status is set — two status filters
  // at once would only ever disagree (Plan Approval's rule).
  const quick = useQuickStatus(pdWord, {
    draft: false,
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
    countRows: searched,
  });
  const shown = searched.filter(quick.matches);
  const openRow = openId ? (rows.find((r) => r.id === openId) ?? null) : null;

  /* THE TWO DECISIONS IN THEIR OWN COLOURS — Plan Approval's row icons, drawn
     on every card so the footer never jitters; each opens the full sheet,
     where the decision is made with the request in front of it. */
  const asTable = quick.value === "updated";
  const decisions = (r: PdRequestRow) => {
    const decidable = canApprove && r.status === "requested";
    const why = canApprove ? "only a request still with the department" : "needs the approval permission";
    const label = pdRequestNo(r);
    const open = () => setOpenId(r.id);
    /* THE TABLE draws the decisions as row icons (RowIconAction, greyed with
       the reason); THE CARD as its footer's own buttons — ghost `sm`, a word
       beside the icon, as Send and Delete are drawn there. */
    if (asTable)
      return (
        <>
          <RowIconAction
            label="Not Acknowledged"
            name={label}
            icon={X}
            className="text-danger"
            onClick={open}
            disabledReason={decidable ? null : `Not Acknowledged — ${why}`}
          />
          <RowIconAction
            label="Acknowledge"
            name={label}
            icon={Check}
            className="text-success"
            onClick={open}
            disabledReason={decidable ? null : `Acknowledge — ${why}`}
          />
        </>
      );
    return (
      <>
        <Tooltip label={decidable ? `Not Acknowledged ${label}` : `Not Acknowledged — ${why}`} touch={!decidable}>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger/10 hover:text-danger disabled:text-muted-foreground"
            disabled={!decidable}
            onClick={open}
          >
            <X className="h-4 w-4" />
            Not Acknowledged
          </Button>
        </Tooltip>
        <Tooltip label={decidable ? `Acknowledge ${label}` : `Acknowledge — ${why}`} touch={!decidable}>
          <Button
            variant="ghost"
            size="sm"
            className="text-success hover:bg-success/10 hover:text-success disabled:text-muted-foreground"
            disabled={!decidable}
            onClick={open}
          >
            <Check className="h-4 w-4" />
            Acknowledge
          </Button>
        </Tooltip>
      </>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="PD Acknowledge"
        description="Review each sample (SMP) the merchandisers send — its styles, quantities and tech pack — then acknowledge the job or say why not."
      />
      {!canApprove && (
        <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          You can see the requests here but not answer them — that needs the approval permission, granted on the Roles screen.
        </p>
      )}
      <FilterBar
        leading={quick.segment}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search SMP No, customer, style, merchandiser…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        right={`${shown.length} of ${rows.length}`}
      />
      <SampleCards<PdRequestRow>
        rows={shown}
        getKey={(r) => r.id}
        title={(r) => <span className="font-mono">{pdRequestNo(r)}</span>}
        subtitle={(r) =>
          [r.swo_no ? `SWO ${r.swo_no}` : null, r.customer, r.created_by_name ? `from ${r.created_by_name}` : null].filter(Boolean).join(" · ")
        }
        state={pdState}
        pillText={(r) => PD_STATUS_LABEL[r.status]}
        stats={(r) => [
          { label: "Qty", value: `${fmtNumber(r.pieces)} pcs`, lead: true },
          { label: "Type", value: r.sample_types.join(", ") || "—" },
          { label: "Target", value: r.target_date ? fmtDate(r.target_date) : "—" },
        ]}
        onOpen={(r) => setOpenId(r.id)}
        actions={decisions}
        // The answered pile only ever opens read-only — no pencil; the SMP No opens it.
        rowEdit={false}
        footerNote={hasCreatedInfo(rows) ? (r) => `Sent ${createdMeta(r)}` : undefined}
        table={asTable ? { title: "SMP No", subtitle: "Customer · From" } : undefined}
        empty={
          !rows.length
            ? "No PD Request has been sent yet — merchandisers send them from Sample ▸ PD Request."
            : quick.value === "pending" && !query.trim() && facets.activeCount === 0
              ? "Nothing is waiting for the Sample Department."
              : "No PD Requests match the search or the filters."
        }
      />
      <PdRequestSheet row={openRow} onClose={() => setOpenId(null)} decide subjectPath={PATH} />
    </div>
  );
}
