"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { MasterListShell } from "@/components/masters/master-list-shell";
import type { Column } from "@/components/ui/data-table";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import type { DcKind, DcRegisterRow } from "@/lib/purchase/dc-register";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";

/**
 * PURCHASE ▸ DELIVERY CHALLANS — every DC, one register (user 2026-10-31, screenshot 3949).
 * Process (job work), Production (unit → unit), Rejection and Replacement (raised by a GRN).
 * A row opens the screen that owns its kind. New DCs: Process and Production from here;
 * Rejection and Replacement only ever come from a GRN's QC Failed lines.
 */

type Word = "all" | DcKind;

const KIND_LABEL: Record<DcKind, string> = {
  process: "Process",
  production: "Production",
  rejection: "Rejection",
  replacement: "Replacement",
};
const KIND_TONE: Record<DcKind, StatusTone> = {
  process: "info",
  production: "neutral",
  rejection: "danger",
  replacement: "warning",
};
// Each kind's own words for its states; anything else prints as stored.
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "At vendor",
  partially_returned: "Part returned",
  closed: "Returned",
  dispatched: "In transit",
  received: "Received",
  returned: "Sent back",
  replaced: "Replaced",
  cancelled: "Cancelled",
};
const OVERRIDES = { issued: "warning", dispatched: "warning", returned: "warning", replaced: "success", closed: "success" } as const;

export function DcRegisterScreen({ rows, canCreate }: { rows: DcRegisterRow[]; canCreate: boolean }) {
  const router = useRouter();
  const [word, setWord] = useState<Word>("all");
  const counts = useMemo(() => {
    const c: Record<Word, number> = { all: rows.length, process: 0, production: 0, rejection: 0, replacement: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);
  const shown = useMemo(() => (word === "all" ? rows : rows.filter((r) => r.kind === word)), [rows, word]);
  const open = (r: DcRegisterRow) => router.push(r.href);

  const columns: Column<DcRegisterRow>[] = [
    {
      header: "DC No",
      cell: (r) => (
        <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
          {r.code ?? "—"}
        </button>
      ),
    },
    { header: "Type", cell: (r) => <StatusPill tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</StatusPill> },
    { header: "Date", cell: (r) => <span className="text-sm">{fmtDate(r.date)}</span> },
    { header: "Vendor / Units", cell: (r) => <Truncated>{r.party}</Truncated> },
    { header: "Against", cell: (r) => <Truncated className="text-sm">{r.against ?? "—"}</Truncated> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span> },
    {
      header: "Still Out",
      align: "right",
      cell: (r) =>
        r.outstanding > 0 ? <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.outstanding)}</span> : <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status, OVERRIDES)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
    },
  ];

  // New: Production when that word is lit, otherwise Process. Rejection / Replacement come from a GRN.
  const newKind = word === "production" ? "production" : word === "process" || word === "all" ? "process" : null;

  return (
    <MasterListShell<DcRegisterRow>
      rows={shown}
      filterLeading={
        <ToggleGroup<Word>
          label="DC type"
          value={word}
          onChange={setWord}
          options={[
            { value: "all", label: `All (${counts.all})` },
            { value: "process", label: `Process (${counts.process})` },
            { value: "production", label: `Production (${counts.production})` },
            { value: "rejection", label: `Rejection (${counts.rejection})` },
            { value: "replacement", label: `Replacement (${counts.replacement})` },
          ]}
        />
      }
      getKey={(r) => r.key}
      perms={{ canCreate: canCreate && !!newKind, canEdit: true, canDelete: false }}
      addLabel={newKind === "production" ? "New Production DC" : "New Process DC"}
      onAdd={() => router.push(newKind === "production" ? "/stores/production-dc?send=new" : "/stores/process-dc?send=new")}
      searchText={(r) => [r.code, KIND_LABEL[r.kind], r.party, r.against].filter(Boolean).join(" ")}
      searchPlaceholder="Search DC No, vendor, unit, GRN or order…"
      columns={columns}
      actions={{
        onEdit: open,
        menuAs: "icons",
        menu: (r) => (r.print ? [{ label: "Print DC", icon: FileText, onClick: () => router.push(r.print!) }] : []),
      }}
      rowLabel={(r) => r.code ?? "DC"}
      empty={
        word === "rejection" || word === "replacement"
          ? `No ${KIND_LABEL[word].toLowerCase()} DC yet — they are raised when a GRN with QC-failed goods is posted.`
          : word === "all"
            ? "No delivery challan yet."
            : `No ${KIND_LABEL[word].toLowerCase()} DC yet.`
      }
      mobile={{
        title: (r) => r.code ?? "—",
        subtitle: (r) => `${KIND_LABEL[r.kind]} · ${r.party}`,
        meta: (r) => `${fmtDate(r.date)} · ${fmtNumber(r.qty)}${r.outstanding > 0 ? ` · ${fmtNumber(r.outstanding)} still out` : ""}`,
        pill: (r) => <StatusPill tone={statusTone(r.status, OVERRIDES)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
        onEdit: open,
      }}
    />
  );
}
