"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { completePpmReceipt } from "@/lib/planning/extras-actions";
import type { IssuedPpmReceiptRow } from "@/lib/planning/extras-service";

interface Props {
  rows: IssuedPpmReceiptRow[];
  canEdit: boolean;
}

export function PpmReceiptsClient({ rows, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});

  function complete(id: string) {
    startTransition(async () => {
      const r = await completePpmReceipt(id, { note: notes[id]?.trim() || null });
      if (r.ok) {
        success("Receipt completed — PPM marked received");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<IssuedPpmReceiptRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Issued qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.issued_qty)}</span> },
    { header: "Received qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span> },
    ...(canEdit
      ? [
          {
            header: "Note",
            cell: (r: IssuedPpmReceiptRow) => (
              <Input
                className="h-8 w-40 text-xs"
                placeholder="optional"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              />
            ),
          } as Column<IssuedPpmReceiptRow>,
          {
            header: "Actions",
            cell: (r: IssuedPpmReceiptRow) => (
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => complete(r.id)}>Complete receipt</Button>
            ),
          } as Column<IssuedPpmReceiptRow>,
        ]
      : []),
  ];

  return <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No issued PPMs awaiting receipt completion." />;
}
