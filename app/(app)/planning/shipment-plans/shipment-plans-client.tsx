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
import { createShipmentPlan } from "@/lib/planning/shipment-plan-actions";
import {
  SHIPMENT_PLAN_STATUS_LABELS,
  type ShipmentPlanStatus,
} from "@/lib/planning/types";
import type {
  ShipmentPlanWithMeta,
  BuyerOption,
} from "@/lib/planning/shipment-plan-service";

function statusTone(status: ShipmentPlanStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "confirmed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

interface Props {
  plans: ShipmentPlanWithMeta[];
  buyers: BuyerOption[];
  canCreate: boolean;
}

export function ShipmentPlansClient({ plans, buyers, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [name, setName] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createShipmentPlan({
        name,
        buyer_id: buyerId || null,
        planned_date: plannedDate || null,
        notes: notes || null,
      });
      if (result.ok) {
        success("Shipment plan created");
        router.push(`/planning/shipment-plans/${result.planId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<ShipmentPlanWithMeta>[] = [
    {
      header: "Plan #",
      cell: (r) => (
        <Link
          href={`/planning/shipment-plans/${r.id}`}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Buyer",
      cell: (r) => (
        <span className="text-sm">{r.buyer_name ?? <span className="text-muted-foreground">—</span>}</span>
      ),
    },
    {
      header: "Planned date",
      cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.planned_date)}</span>,
    },
    {
      header: "Orders",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.order_count}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={statusTone(r.status)}>
          {SHIPMENT_PLAN_STATUS_LABELS[r.status]}
        </StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New shipment plan</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="sp-name">Name</Label>
                    <Input
                      id="sp-name"
                      placeholder="e.g. July week-2 EU dispatch"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="sp-buyer">Buyer (optional)</Label>
                    <Select id="sp-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                      <option value="">— none —</option>
                      {buyers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="sp-date">Planned ship date</Label>
                    <Input
                      id="sp-date"
                      type="date"
                      value={plannedDate}
                      onChange={(e) => setPlannedDate(e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="sp-notes">Notes</Label>
                    <Textarea
                      id="sp-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Saving…" : "Create plan"}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setOpen(true)}>New shipment plan</Button>
          </div>
        ))}

      <DataTable
        columns={columns}
        rows={plans}
        getKey={(r) => r.id}
        empty="No shipment plans yet. Use 'New shipment plan' above to create the first."
      />
    </div>
  );
}
