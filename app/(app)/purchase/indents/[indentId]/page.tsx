import Link from "next/link";
import { DocBackLink, DocFacts, DocPrintIcon } from "@/components/purchase/doc-facts";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import {
  getPurchaseIndent,
  getIndentLines,
  getItems,
  getUoms,
} from "@/lib/purchase/extras-service";
import { INDENT_STATUS_LABELS, type IndentStatus } from "@/lib/purchase/extras-types";
import { IndentDetail } from "./indent-detail";
import { listVendorsForPicker } from "@/lib/masters/vendor-service";
import { statusTone } from "@/lib/ui/status-tone";

const TONE_OVERRIDES = {
  // Open is a live document here, already in motion, not an untouched one (was warning before the shared table, kept).
  open: "warning",
  acknowledged: "info", // this module's own word — not in the shared table
  converted: "success", // this module's own word — not in the shared table
} as const;

function tone(s: IndentStatus): StatusTone {
  return statusTone(s, TONE_OVERRIDES);
}

export default async function IndentDetailPage({
  params,
}: {
  params: Promise<{ indentId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { indentId } = await params;
  const [indent, lines, items, uoms, canEdit, canDelete, vendors] = await Promise.all([
    getPurchaseIndent(indentId),
    getIndentLines(indentId),
    getItems(),
    getUoms(),
    can("materials_purchase", "edit"),
    can("materials_purchase", "delete"),
    listVendorsForPicker(),
  ]);
  if (!indent) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={indent.code ?? "Indent"}
        description={`${indent.department} department indent`}
      />
      {/* ONE STRIP, NOT A TITLED CARD (user 2026-11-03, screenshot 4000) — components/purchase/doc-facts.tsx. */}
      <DocFacts
        trailing={
          <>
            <StatusPill tone={tone(indent.status)}>{INDENT_STATUS_LABELS[indent.status]}</StatusPill>
            {/* The printed indent (compact document shape, 2026-10-31). */}
            <DocPrintIcon href={`/purchase/indents/${indentId}/print`} label="Print indent" />
            <DocBackLink href="/purchase/indents" />
          </>
        }
        facts={[
          { label: "Department", value: indent.department },
          { label: "Required date", value: fmtDate(indent.required_date), mono: true },
          indent.garment_ppm_id
            ? {
                label: "Source PPM",
                value: (
                  <Link href={`/planning/garment-ppm/${indent.garment_ppm_id}`} className="text-primary hover:underline">
                    View PPM
                  </Link>
                ),
              }
            : null,
          indent.notes ? { label: "Notes", value: <span className="font-normal text-muted-foreground">{indent.notes}</span> } : null,
        ]}
      />
      <IndentDetail
        indentId={indentId}
        status={indent.status}
        lines={lines}
        items={items}
        uoms={uoms}
        canEdit={canEdit}
        canDelete={canDelete}
        vendors={vendors}
      />
    </div>
  );
}
