"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { closeSqNote } from "@/lib/planning/extras-actions";
import type { SqNoteWithRefs } from "@/lib/planning/extras-service";

interface Props {
  rows: SqNoteWithRefs[];
  canEdit: boolean;
}

export function SqClosureClient({ rows, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [reasons, setReasons] = useState<Record<string, string>>({});

  function close(id: string) {
    const reason = reasons[id]?.trim() ?? "";
    if (!reason) {
      toastError("Enter a closure reason first");
      return;
    }
    startTransition(async () => {
      const r = await closeSqNote(id, reason);
      if (r.ok) {
        success("SQ note closed");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<SqNoteWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Order", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Buyer", cell: (r) => <span className="text-sm">{r.buyer_name ?? "—"}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
    ...(canEdit
      ? [
          {
            header: "Closure reason",
            cell: (r: SqNoteWithRefs) => (
              <Input
                className="h-8 w-48 text-xs"
                placeholder="reason"
                value={reasons[r.id] ?? ""}
                onChange={(e) => setReasons((n) => ({ ...n, [r.id]: e.target.value }))}
              />
            ),
          } as Column<SqNoteWithRefs>,
          {
            header: "Actions",
            cell: (r: SqNoteWithRefs) => (
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => close(r.id)}>Close</Button>
            ),
          } as Column<SqNoteWithRefs>,
        ]
      : []),
  ];

  return <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No allocated SQ notes awaiting closure." />;
}
