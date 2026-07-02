"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { createOpeningStock } from "@/lib/stores/extras-actions";
import { OPENING_STOCK_STATUS_LABELS, type OpeningStockStatus } from "@/lib/stores/extras-types";
import type { OpeningStockWithRefs, StoreOption } from "@/lib/stores/extras-service";

function tone(s: OpeningStockStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "posted" ? "success" : "danger";
}

interface Props {
  rows: OpeningStockWithRefs[];
  stores: StoreOption[];
  canCreate: boolean;
}

export function OpeningStockClient({ rows, stores, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [storeId, setStoreId] = useState("");
  const [openingDate, setOpeningDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId) {
      toastError("Select a store");
      return;
    }
    startTransition(async () => {
      const r = await createOpeningStock({
        store_id: storeId,
        opening_date: openingDate || null,
        notes: notes || null,
      });
      if (r.ok) {
        success("Opening stock created");
        router.push(`/stores/opening-stock/${r.id}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<OpeningStockWithRefs>[] = [
    {
      header: "Doc #",
      cell: (r) => (
        <Link href={`/stores/opening-stock/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Store", cell: (r) => <span className="text-sm">{r.store_code ?? "—"}</span> },
    { header: "Opening date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.opening_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{OPENING_STOCK_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New opening stock</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="os-store">Store</Label>
                    <Select id="os-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                      <option value="">— select store —</option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="os-date">Opening date</Label>
                    <Input id="os-date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-1">
                    <Label htmlFor="os-notes">Notes</Label>
                    <Textarea id="os-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New opening stock</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No opening-stock documents yet." />
    </div>
  );
}
