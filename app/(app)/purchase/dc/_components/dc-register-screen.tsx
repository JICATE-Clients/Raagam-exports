"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, PackageCheck, Send, Undo2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { postVendorReturn } from "@/lib/stores/extras-actions";
import { MasterListShell } from "@/components/masters/master-list-shell";
import type { Column } from "@/components/ui/data-table";
import { HUG } from "@/components/ui/created-columns";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
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
  process: "Job Work",
  production: "Inter-Unit",
  general: "General",
  department: "Department",
  rejection: "Rejection",
  replacement: "Replacement",
};
// Each kind's own words for its states; anything else prints as stored.
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "At vendor",
  partially_returned: "Part returned",
  closed: "Returned",
  dispatched: "In transit",
  received: "Received",
  delivered: "Delivered",
  returned: "Dispatched",
  replaced: "Replaced",
  cancelled: "Cancelled",
  // A non-returnable General DC once dispatched (0796) — gone for good, not "returned".
  sent: "Sent",
};
const OVERRIDES = { delivered: "warning", issued: "warning", dispatched: "warning", returned: "warning", replaced: "success", closed: "success" } as const;

export function DcRegisterScreen({
  rows,
  canCreate,
  canDispatch = false,
  initialType = null,
}: {
  rows: DcRegisterRow[];
  canCreate: boolean;
  /** May dispatch a Rejection / Replacement DC from its row (stores:edit, as postVendorReturn). */
  canDispatch?: boolean;
  /** The tab the URL asked for (`?type=`), so closing the drawer lands where it opened. */
  initialType?: string | null;
}) {
  const router = useRouter();
  const [word, setWord] = useState<Word>(
    initialType === "process" || initialType === "production" || initialType === "general" || initialType === "department" || initialType === "rejection" || initialType === "replacement" ? initialType : "all",
  );
  const counts = useMemo(() => {
    const c: Record<Word, number> = { all: rows.length, process: 0, production: 0, general: 0, department: 0, rejection: 0, replacement: 0 };
    for (const r of rows) c[r.kind]++;
    return c;
  }, [rows]);
  const shown = useMemo(() => (word === "all" ? rows : rows.filter((r) => r.kind === word)), [rows, word]);
  const open = (r: DcRegisterRow) => {
    if (r.href) router.push(r.href);
  };
  const { success, error: toastError } = useToast();
  const [dispatching, startDispatch] = useTransition();
  /** DISPATCH IN PLACE (user 2026-11-02, two-screen return plan): a draft Rejection /
   *  Replacement DC goes out from its row — the failed goods leave the Rejection store —
   *  and its print appears. No trip to a separate Vendor Returns page. */
  const dispatch = (r: DcRegisterRow) =>
    startDispatch(async () => {
      const res = await postVendorReturn(r.id);
      if (res.ok) {
        success(`${r.code ?? "DC"} dispatched — print the return slip from its row`);
        router.refresh();
      } else toastError(res.error ?? "Could not dispatch");
    });

  // FITS WITHOUT A SIDEWAYS SCROLL (user 2026-11-03, screenshot 3995): every short column
  // hugs its content (HUG) and Party alone takes the spare width, truncating with a reveal.
  const columns: Column<DcRegisterRow>[] = [
    {
      header: "DC No",
      className: HUG,
      cell: (r) => (
        r.href ? (
          <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
            {r.code ?? "—"}
          </button>
        ) : (
          <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span>
        )
      ),
    },
    // Plain text, not a pill: a pill here read as a second Status column (user 2026-11-03,
    // screenshot 3994). Status is the row's only pill.
    { header: "Type", className: HUG, cell: (r) => <span className="text-sm">{KIND_LABEL[r.kind]}</span> },
    { header: "Date", className: HUG, cell: (r) => <span className="text-sm">{fmtDate(r.date)}</span> },
    { header: "Party / Unit", className: "max-w-0 w-full", cell: (r) => <Truncated>{r.party}</Truncated> },
    { header: "Reference", className: HUG, cell: (r) => <span className="text-sm">{r.against ?? "—"}</span> },
    { header: "Qty", align: "right", className: HUG, cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span> },
    {
      header: "Bal. Out",
      align: "right",
      className: HUG,
      cell: (r) =>
        r.outstanding > 0 ? <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.outstanding)}</span> : <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Status",
      className: HUG,
      cell: (r) => <StatusPill tone={statusTone(r.status, OVERRIDES)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
    },
  ];

  // + NEW DELIVERY CHALLAN opens the hub's drawer on the type in view (Process for All); the
  // drawer's DC Type selector switches it. Rejection / Replacement show what is open there.
  const newType = word === "all" ? "process" : word;

  return (
    <MasterListShell<DcRegisterRow>
      rows={shown}
      dense="spacing"
      filterLeading={
        <ToggleGroup<Word>
          label="DC type"
          value={word}
          onChange={setWord}
          options={[
            { value: "all", label: `All (${counts.all})` },
            { value: "process", label: `Job Work (${counts.process})` },
            { value: "production", label: `Inter-Unit (${counts.production})` },
            { value: "general", label: `General (${counts.general})` },
            { value: "department", label: `Department (${counts.department})` },
            { value: "rejection", label: `Rejection (${counts.rejection})` },
            { value: "replacement", label: `Replacement (${counts.replacement})` },
          ]}
        />
      }
      getKey={(r) => r.key}
      perms={{ canCreate, canEdit: true, canDelete: false }}
      addLabel="New Delivery Challan"
      onAdd={() => router.push(`/purchase/dc?new=${newType}&type=${newType}`)}
      searchText={(r) => [r.code, KIND_LABEL[r.kind], r.party, r.against].filter(Boolean).join(" ")}
      searchPlaceholder="Search DC No, vendor, unit, GRN or order…"
      columns={columns}
      actions={{
        onEdit: open,
        menuAs: "icons",
        // The row's next step, then its print (no ⋮ — AGENTS.md "Row actions").
        menu: (r) => [
          ...(r.action === "dispatch" && canDispatch
            ? [{ label: dispatching ? "Dispatching…" : "Dispatch", icon: Send, onClick: () => dispatch(r) }]
            : []),
          ...(r.action === "receive-back" && r.href
            ? [{ label: "Receive back", icon: Undo2, onClick: () => router.push(r.href!) }]
            : r.action === "receive-stock" && r.href
              ? [{ label: "Receive stock", icon: PackageCheck, onClick: () => router.push(r.href!) }]
              : []),
          ...(r.print ? [{ label: "Print DC", icon: FileText, onClick: () => router.push(r.print!) }] : []),
        ],
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
