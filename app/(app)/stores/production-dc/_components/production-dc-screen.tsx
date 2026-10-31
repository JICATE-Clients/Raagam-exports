"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, PackageCheck } from "lucide-react";
import { MasterListShell } from "@/components/masters/master-list-shell";
import type { Column } from "@/components/ui/data-table";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { deleteProductionDc } from "@/lib/stores/production-dc-actions";
import type { ProductionDcRow } from "@/lib/stores/production-dc-service";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";

/**
 * PRODUCTION DC REGISTER (0784). Four words, read from the working unit's side:
 *   Incoming — sent TO this unit, waiting to be received (the receiver's queue);
 *   In Transit — sent BY this unit, not yet received at the other end;
 *   Received — done, either direction;
 *   Draft — this unit's DCs not yet dispatched.
 */

type Word = "incoming" | "transit" | "received" | "draft";

function wordOf(r: ProductionDcRow): Word | null {
  if (r.status === "draft") return r.outgoing ? "draft" : null;
  if (r.status === "dispatched") return r.outgoing ? "transit" : "incoming";
  return "received";
}

const STATUS_LABEL: Record<string, string> = { draft: "Draft", dispatched: "In Transit", received: "Received" };

export function ProductionDcScreen({ rows, canCreate }: { rows: ProductionDcRow[]; canCreate: boolean }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [, startTransition] = useTransition();
  const counts = useMemo(() => {
    const c: Record<Word, number> = { incoming: 0, transit: 0, received: 0, draft: 0 };
    for (const r of rows) {
      const w = wordOf(r);
      if (w) c[w]++;
    }
    return c;
  }, [rows]);
  // Opens on what needs THIS unit's hands: something to receive, else what it sent.
  const [word, setWord] = useState<Word>(counts.incoming > 0 ? "incoming" : "transit");
  const shown = useMemo(() => rows.filter((r) => wordOf(r) === word), [rows, word]);

  const open = (r: ProductionDcRow) => {
    if (r.status === "draft" && r.outgoing) router.push(`/stores/production-dc?send=${r.id}`);
    else if (r.status === "dispatched" && !r.outgoing) router.push(`/stores/production-dc?receive=${r.id}`);
    else router.push(`/stores/production-dc/${r.id}/print`);
  };

  const columns: Column<ProductionDcRow>[] = [
    {
      header: "DC No",
      cell: (r) => (
        <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
          {r.code ?? "—"}
        </button>
      ),
    },
    { header: "DC Date", cell: (r) => <span className="text-sm">{fmtDate(r.dc_date)}</span> },
    {
      header: "From → To",
      cell: (r) => (
        <span className="inline-flex items-center gap-1 text-sm">
          {r.from_unit} <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden /> {r.to_unit}
        </span>
      ),
    },
    { header: "Lines", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.line_count)}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.sent_total)}</span> },
    { header: "Vehicle", cell: (r) => <span className="text-sm">{r.vehicle_no ?? "—"}</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status === "dispatched" ? "in transit" : r.status)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
    },
  ];

  return (
    <MasterListShell<ProductionDcRow>
      rows={shown}
      filterLeading={
        <ToggleGroup<Word>
          label="Production DCs"
          value={word}
          onChange={setWord}
          options={[
            { value: "incoming", label: `Incoming${counts.incoming ? ` (${counts.incoming})` : ""}` },
            { value: "transit", label: `In Transit${counts.transit ? ` (${counts.transit})` : ""}` },
            { value: "received", label: "Received" },
            { value: "draft", label: `Draft${counts.draft ? ` (${counts.draft})` : ""}` },
          ]}
        />
      }
      getKey={(r) => r.id}
      perms={{ canCreate, canEdit: true, canDelete: canCreate }}
      addLabel="New Production DC"
      onAdd={() => router.push("/stores/production-dc?send=new")}
      searchText={(r) => [r.code, r.from_unit, r.to_unit, r.vehicle_no].filter(Boolean).join(" ")}
      searchPlaceholder="Search DC No, unit or vehicle…"
      columns={columns}
      actions={{
        onEdit: open,
        menuAs: "icons",
        menu: (r) => [
          ...(r.status === "dispatched" && !r.outgoing
            ? [{ label: "Receive", icon: PackageCheck, onClick: () => router.push(`/stores/production-dc?receive=${r.id}`) }]
            : []),
          ...(r.status !== "draft"
            ? [{ label: "Print DC", icon: FileText, onClick: () => router.push(`/stores/production-dc/${r.id}/print`) }]
            : []),
        ],
        onDelete: (r) =>
          startTransition(async () => {
            const res = await deleteProductionDc(r.id);
            if (res.ok) {
              success("Draft deleted");
              router.refresh();
            } else toastError(res.error);
          }),
        // A dispatched DC moved stock; it is never deleted — only a draft is.
        deleteDisabledReason: (r) => (r.status === "draft" && r.outgoing ? null : "Only a draft can be deleted — this one has moved stock"),
      }}
      rowLabel={(r) => r.code ?? "Production DC"}
      empty={
        word === "incoming"
          ? "Nothing is on its way to this unit."
          : word === "transit"
            ? "Nothing this unit sent is still on the road."
            : word === "draft"
              ? "No draft waiting to be dispatched."
              : "No Production DC has been received yet."
      }
      mobile={{
        title: (r) => r.code ?? "—",
        subtitle: (r) => `${r.from_unit} → ${r.to_unit}`,
        meta: (r) => `${fmtDate(r.dc_date)} · ${fmtNumber(r.sent_total)} qty`,
        pill: (r) => <StatusPill tone={statusTone(r.status === "dispatched" ? "in transit" : r.status)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
        onEdit: open,
      }}
    />
  );
}
