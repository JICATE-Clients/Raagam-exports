"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtNumber, fmtDate } from "@/lib/format";
import {
  createCourier,
  setCourierActive,
  deleteCourier,
  createDespatch,
  markCourierDespatched,
  recordPod,
  cancelDespatch,
  deleteDespatch,
} from "@/lib/admin/extras-actions";
import { COURIER_DESPATCH_STATUS_LABELS, type CourierDespatchStatus } from "@/lib/admin/extras-types";
import type { Courier } from "@/lib/admin/extras-types";
import type { CourierDespatchWithRefs, CourierOption } from "@/lib/admin/extras-service";

function dTone(s: CourierDespatchStatus): StatusTone {
  switch (s) {
    case "draft":
      return "neutral";
    case "despatched":
      return "warning";
    case "delivered":
      return "success";
    case "cancelled":
      return "danger";
  }
}

interface Props {
  couriers: Courier[];
  despatches: CourierDespatchWithRefs[];
  courierOpts: CourierOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function CouriersClient({ couriers, despatches, courierOpts, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  // courier master form
  const [cOpen, setCOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cContact, setCContact] = useState("");
  const [cPhone, setCPhone] = useState("");
  function addCourier(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createCourier({ name: cName, contact_person: cContact || null, phone: cPhone || null });
      if (r.ok) {
        success("Courier added");
        setCName(""); setCContact(""); setCPhone(""); setCOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  // despatch form
  const [dOpen, setDOpen] = useState(false);
  const [dCourier, setDCourier] = useState("");
  const [dRef, setDRef] = useState("");
  const [dDate, setDDate] = useState("");
  const [dDest, setDDest] = useState("");
  const [dContents, setDContents] = useState("");
  const [dInvNo, setDInvNo] = useState("");
  const [dInvAmt, setDInvAmt] = useState("");
  function addDespatch(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createDespatch({
        courier_id: dCourier || null,
        reference: dRef || null,
        despatch_date: dDate || null,
        destination: dDest || null,
        contents: dContents || null,
        invoice_no: dInvNo || null,
        invoice_amount: dInvAmt ? parseFloat(dInvAmt) : null,
        notes: null,
      });
      if (r.ok) {
        success("Despatch created");
        setDCourier(""); setDRef(""); setDDate(""); setDDest(""); setDContents(""); setDInvNo(""); setDInvAmt(""); setDOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const courierColumns: Column<Courier>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Contact", cell: (r) => <span className="text-sm">{r.contact_person ?? "—"}</span> },
    { header: "Phone", cell: (r) => <span className="text-sm">{r.phone ?? "—"}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</StatusPill> },
    ...(canEdit || canDelete
      ? [{ header: "", cell: (r: Courier) => (
          <div className="flex flex-wrap gap-1">
            {canEdit && (
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => setCourierActive(r.id, !r.is_active), r.is_active ? "Deactivated" : "Activated")}>
                {r.is_active ? "Deactivate" : "Activate"}
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
                onClick={() => run(() => deleteCourier(r.id), "Deleted")}>Del</Button>
            )}
          </div>
        ) } satisfies Column<Courier>]
      : []),
  ];

  const despatchColumns: Column<CourierDespatchWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Courier", cell: (r) => <span className="text-sm">{r.courier_name ?? "—"}</span> },
    { header: "Reference", cell: (r) => <span className="text-sm">{r.reference ?? "—"}</span> },
    { header: "Destination", cell: (r) => <span className="text-sm">{r.destination ?? "—"}</span> },
    { header: "Invoice", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.invoice_amount != null ? fmtNumber(r.invoice_amount) : "—"}</span> },
    { header: "POD", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.pod_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={dTone(r.status)}>{COURIER_DESPATCH_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => markCourierDespatched(r.id), "Despatched")}>Despatch</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => cancelDespatch(r.id), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canEdit && r.status === "despatched" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => recordPod(r.id, null), "POD recorded")}>Record POD</Button>
          )}
          {canDelete && (r.status === "draft" || r.status === "cancelled") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deleteDespatch(r.id), "Deleted")}>Del</Button>
          )}
        </div>
      ),
    },
  ];

  const couriersTab = (
    <div className="space-y-4">
      {canCreate &&
        (cOpen ? (
          <Card>
            <CardHeader>
              <CardTitle>New courier</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setCOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={addCourier} className="flex flex-wrap items-end gap-3">
                <div className="min-w-[200px] flex-1"><Label htmlFor="c-name">Name</Label><Input id="c-name" value={cName} onChange={(e) => setCName(e.target.value)} required /></div>
                <div className="w-44"><Label htmlFor="c-contact">Contact</Label><Input id="c-contact" value={cContact} onChange={(e) => setCContact(e.target.value)} /></div>
                <div className="w-36"><Label htmlFor="c-phone">Phone</Label><Input id="c-phone" value={cPhone} onChange={(e) => setCPhone(e.target.value)} /></div>
                <Button type="submit" disabled={isPending}>Add</Button>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setCOpen(true)}>New courier</Button></div>
        ))}
      <DataTable columns={courierColumns} rows={couriers} getKey={(r) => r.id} empty="No couriers yet." />
    </div>
  );

  const despatchesTab = (
    <div className="space-y-4">
      {canCreate &&
        (dOpen ? (
          <Card>
            <CardHeader>
              <CardTitle>New despatch</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setDOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={addDespatch} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="d-courier">Courier</Label>
                    <Select id="d-courier" value={dCourier} onChange={(e) => setDCourier(e.target.value)}>
                      <option value="">— none —</option>
                      {courierOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="d-ref">Reference</Label><Input id="d-ref" value={dRef} onChange={(e) => setDRef(e.target.value)} /></div>
                  <div><Label htmlFor="d-date">Despatch date</Label><Input id="d-date" type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} /></div>
                  <div><Label htmlFor="d-dest">Destination</Label><Input id="d-dest" value={dDest} onChange={(e) => setDDest(e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label htmlFor="d-contents">Contents</Label><Input id="d-contents" value={dContents} onChange={(e) => setDContents(e.target.value)} /></div>
                  <div><Label htmlFor="d-invno">Invoice no.</Label><Input id="d-invno" value={dInvNo} onChange={(e) => setDInvNo(e.target.value)} /></div>
                  <div><Label htmlFor="d-invamt">Invoice amount</Label><Input id="d-invamt" type="number" min="0" step="0.01" value={dInvAmt} onChange={(e) => setDInvAmt(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setDOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>Create</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setDOpen(true)}>New despatch</Button></div>
        ))}
      <DataTable columns={despatchColumns} rows={despatches} getKey={(r) => r.id} empty="No despatches yet." />
    </div>
  );

  return (
    <Tabs
      items={[
        { key: "despatches", label: `Despatches (${despatches.length})`, content: despatchesTab },
        { key: "couriers", label: `Couriers (${couriers.length})`, content: couriersTab },
      ]}
      defaultKey="despatches"
    />
  );
}
