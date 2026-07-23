"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
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
import { createVendorReturn } from "@/lib/stores/extras-actions";
import { VENDOR_RETURN_STATUS_LABELS, type VendorReturnStatus } from "@/lib/stores/extras-types";
import type { VendorReturnWithRefs, StoreOption, VendorOption } from "@/lib/stores/extras-service";

function tone(s: VendorReturnStatus): StatusTone {
  switch (s) {
    case "draft":
      return "neutral";
    case "returned":
      return "warning";
    case "replaced":
      return "info";
    case "closed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

interface Props {
  rows: VendorReturnWithRefs[];
  stores: StoreOption[];
  vendors: VendorOption[];
  canCreate: boolean;
}

export function VendorReturnsClient({ rows, stores, vendors, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [storeId, setStoreId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId) {
      toastError("Select a store");
      return;
    }
    startTransition(async () => {
      const r = await createVendorReturn({
        store_id: storeId,
        vendor_id: vendorId || null,
        reason: reason || null,
        return_date: returnDate || null,
        notes: notes || null,
      });
      if (r.ok) {
        success("Return created");
        router.push(`/stores/vendor-returns/${r.id}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<VendorReturnWithRefs>[] = [
    {
      header: "Return #",
      cell: (r) => (
        <Link href={`/stores/vendor-returns/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Store", cell: (r) => <span className="text-sm">{r.store_code ?? "—"}</span> },
    { header: "Vendor", cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.return_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{VENDOR_RETURN_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New return</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="vr-store">Store</Label>
                    <Select id="vr-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                      <option value="">— select store —</option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="vr-vendor">Vendor</Label>
                    <Select id="vr-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                      <option value="">— none —</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="vr-date">Return date</Label>
                    <Input id="vr-date" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="vr-reason">Reason</Label>
                    <Input id="vr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="vr-notes">Notes</Label>
                    <Textarea id="vr-notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New return</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No vendor returns yet." />
    </div>
  );
}
