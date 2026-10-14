"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import { useQuickStatus } from "@/components/orders/bom-queue";
import { SampleCards } from "@/components/sales/sample-queue";
import { PdRequestSheet } from "@/components/sales/pd-request-sheet";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { PdRequestRow } from "@/lib/sales/pd-requests/types";
import { pdState, pdWord } from "@/lib/sales/pd-requests/words";
import { PD_STATUS_LABEL } from "@/lib/sales/sample-entry/types";

const PATH = "/sales/pd-acknowledge";

/**
 * Sample ▸ Acknowledge PD Request — the Sample Department's queue. See page.tsx.
 *
 * Opens on Pending: the requests still waiting on the department, as cards.
 * A card opens the request with Acknowledge / Not Acknowledged in its header.
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
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.swo_no, r.customer, r.season, r.note, r.created_by_name, ...r.smp_nos, ...r.style_names].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, query]);
  const quick = useQuickStatus(pdWord, { draft: false, countRows: searched });
  const shown = searched.filter(quick.matches);
  const openRow = openId ? (rows.find((r) => r.id === openId) ?? null) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Acknowledge PD Request"
        description="Review each SWO the merchandisers send — every sample in it — then acknowledge the job or say why not."
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
        searchPlaceholder="Search SWO No, SMP No, customer, style, merchandiser…"
        right={`${shown.length} of ${rows.length}`}
      />
      <SampleCards<PdRequestRow>
        rows={shown}
        getKey={(r) => r.id}
        title={(r) => <span className="font-mono">{r.swo_no ?? r.smp_nos[0] ?? "—"}</span>}
        subtitle={(r) => [r.smp_nos.join(", "), r.created_by_name ? `from ${r.created_by_name}` : null].filter(Boolean).join(" · ")}
        state={pdState}
        pillText={(r) => PD_STATUS_LABEL[r.status]}
        stats={(r) => [
          { label: "Qty", value: `${fmtNumber(r.pieces)} pcs`, lead: true },
          { label: "Samples", value: `${r.smp_nos.length} SMP · ${r.style_names.length} styles` },
          { label: "Target", value: r.target_date ? fmtDate(r.target_date) : "—" },
        ]}
        onOpen={(r) => setOpenId(r.id)}
        footerNote={hasCreatedInfo(rows) ? (r) => `Sent ${createdMeta(r)}` : undefined}
        table={quick.value === "updated" ? { title: "SWO No", subtitle: "SMP Nos · From" } : undefined}
        empty={
          !rows.length
            ? "No PD Request has been sent yet — merchandisers send them from Sample ▸ PD Request."
            : quick.value === "pending" && !query.trim()
              ? "Nothing is waiting for the Sample Department."
              : "No PD Requests match the search or the status box."
        }
      />
      <PdRequestSheet row={openRow} onClose={() => setOpenId(null)} decide subjectPath={PATH} />
    </div>
  );
}
