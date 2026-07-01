import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listJournals, getAccountsForPicker, getLocationsForPicker } from "@/lib/finance/gl-service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { NewJournalForm } from "./new-journal-form";
import type { JournalEntry } from "@/lib/finance/types";
import type { JournalStatus } from "@/lib/finance/types";

function journalStatusTone(s: JournalStatus): StatusTone {
  switch (s) {
    case "draft": return "neutral";
    case "posted": return "success";
    case "reversed": return "warning";
  }
}

const STATUS_LABELS: Record<JournalStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  reversed: "Reversed",
};

const columns: Column<JournalEntry>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/finance/ledger/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.entry_date)}</span>
    ),
  },
  {
    header: "Narration",
    cell: (r) => (
      <span className="max-w-xs truncate text-sm text-muted-foreground">
        {r.narration ?? "—"}
      </span>
    ),
  },
  {
    header: "Debit",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtMoney(r.total_debit)}</span>
    ),
  },
  {
    header: "Credit",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtMoney(r.total_credit)}</span>
    ),
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={journalStatusTone(r.status)}>
        {STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
];

export default async function LedgerPage() {
  await requirePermission("finance", "view");

  const [journals, accounts, locations, canCreate] = await Promise.all([
    listJournals(),
    getAccountsForPicker(),
    getLocationsForPicker(),
    can("finance", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="General Ledger"
        description="All journal entries — draft, posted, and reversed."
      />

      {canCreate && (
        <NewJournalForm accounts={accounts} locations={locations} />
      )}

      <DataTable
        columns={columns}
        rows={journals}
        getKey={(r) => r.id}
        empty="No journal entries yet. Create one above."
      />
    </div>
  );
}
