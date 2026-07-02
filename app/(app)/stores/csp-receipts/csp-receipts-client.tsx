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
import { createCspReceipt } from "@/lib/stores/extras-actions";
import { CSP_STATUS_LABELS, type CspStatus } from "@/lib/stores/extras-types";
import type { CspReceiptWithRefs, StoreOption, BuyerOption } from "@/lib/stores/extras-service";

function tone(s: CspStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "posted" ? "success" : "danger";
}

interface Props {
  rows: CspReceiptWithRefs[];
  stores: StoreOption[];
  buyers: BuyerOption[];
  canCreate: boolean;
}

export function CspReceiptsClient({ rows, stores, buyers, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [storeId, setStoreId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId) {
      toastError("Select a store");
      return;
    }
    startTransition(async () => {
      const r = await createCspReceipt({
        store_id: storeId,
        buyer_id: buyerId || null,
        receipt_date: receiptDate || null,
        reference: reference || null,
        notes: notes || null,
      });
      if (r.ok) {
        success("CSP receipt created");
        router.push(`/stores/csp-receipts/${r.id}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<CspReceiptWithRefs>[] = [
    {
      header: "Receipt #",
      cell: (r) => (
        <Link href={`/stores/csp-receipts/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Store", cell: (r) => <span className="text-sm">{r.store_code ?? "—"}</span> },
    { header: "Customer", cell: (r) => <span className="text-sm">{r.buyer_name ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.receipt_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{CSP_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New CSP receipt</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="cs-store">Store</Label>
                    <Select id="cs-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                      <option value="">— select store —</option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="cs-buyer">Customer</Label>
                    <Select id="cs-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                      <option value="">— none —</option>
                      {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="cs-date">Receipt date</Label>
                    <Input id="cs-date" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="cs-ref">Reference</Label>
                    <Input id="cs-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="cs-notes">Notes</Label>
                    <Textarea id="cs-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New CSP receipt</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No CSP receipts yet." />
    </div>
  );
}
