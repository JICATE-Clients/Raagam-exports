import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getJournal, listAccounts } from "@/lib/finance/gl-service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { PostButton, ReverseButton } from "./entry-actions";
import type { JournalStatus, JournalLine } from "@/lib/finance/types";
import type { GlAccount } from "@/lib/finance/types";

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

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ entryId: string }>;
}) {
  await requirePermission("finance", "view");
  const { entryId } = await params;

  const [entry, accounts, canEdit, canDelete] = await Promise.all([
    getJournal(entryId),
    listAccounts(),
    can("finance", "edit"),
    can("finance", "delete"),
  ]);

  if (!entry) notFound();

  const accountMap = Object.fromEntries(
    accounts.map((a: GlAccount) => [a.id, `${a.code} — ${a.name}`]),
  );

  const lineColumns: Column<JournalLine>[] = [
    {
      header: "Account",
      cell: (r) => (
        <span className="font-mono text-xs">{accountMap[r.gl_account_id] ?? r.gl_account_id}</span>
      ),
    },
    {
      header: "Description",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span>
      ),
    },
    {
      header: "Debit",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.debit > 0 ? fmtMoney(r.debit) : "—"}
        </span>
      ),
    },
    {
      header: "Credit",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.credit > 0 ? fmtMoney(r.credit) : "—"}
        </span>
      ),
    },
  ];

  const showPost = entry.status === "draft" && canEdit;
  const showReverse = entry.status === "posted" && canDelete;

  return (
    <div className="space-y-4">
      <PageHeader
        title={entry.code ?? "Journal Entry"}
        description={`${fmtDate(entry.entry_date)}${entry.narration ? ` · ${entry.narration}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={journalStatusTone(entry.status)}>
              {STATUS_LABELS[entry.status]}
            </StatusPill>
            {showPost && <PostButton entryId={entry.id} />}
            {showReverse && <ReverseButton entryId={entry.id} />}
          </div>
        }
      />

      {entry.reversal_of && (
        <p className="text-sm text-muted-foreground">
          Reversal of journal{" "}
          <a href={`/finance/ledger/${entry.reversal_of}`} className="text-primary hover:underline">
            {entry.reversal_of}
          </a>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Journal Lines</CardTitle>
          <div className="text-xs text-muted-foreground tabular-nums">
            Dr {fmtMoney(entry.total_debit)} / Cr {fmtMoney(entry.total_credit)}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <DataTable
            columns={lineColumns}
            rows={entry.lines}
            getKey={(r) => r.id}
            empty="No lines on this entry."
          />
        </CardBody>
      </Card>

      {entry.posted_at && (
        <p className="text-xs text-muted-foreground">
          Posted {fmtDate(entry.posted_at)}
        </p>
      )}
    </div>
  );
}
