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
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { createPdRequest } from "@/lib/planning/extras-actions";
import {
  PD_STAGE_LABELS,
  PD_STATUS_LABELS,
  type PdStatus,
} from "@/lib/planning/types";
import type {
  PdRequestWithRefs,
  BuyerOption,
  OpportunityOption,
} from "@/lib/planning/extras-service";

function tone(s: PdStatus): StatusTone {
  return s === "open" ? "info" : s === "closed" ? "success" : "danger";
}

interface Props {
  rows: PdRequestWithRefs[];
  buyers: BuyerOption[];
  opportunities: OpportunityOption[];
  canCreate: boolean;
  canExport?: boolean;
}

export function ProductDevClient({ rows, buyers, opportunities, canCreate, canExport = false }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [opportunityId, setOpportunityId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createPdRequest({
        opportunity_id: opportunityId || null,
        buyer_id: buyerId || null,
        title,
        description: description || null,
      });
      if (r.ok) {
        success("PD request created");
        router.push(`/planning/product-dev/${r.pdId}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<PdRequestWithRefs>[] = [
    {
      header: "PD #",
      cell: (r) => (
        <Link href={`/planning/product-dev/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Title", cell: (r) => <span className="text-sm">{r.title}</span> },
    { header: "Buyer", cell: (r) => <span className="text-sm">{r.buyer_name ?? "—"}</span> },
    { header: "Stage", cell: (r) => <span className="text-sm">{PD_STAGE_LABELS[r.stage]}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{PD_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="pd_requests" rows={rows} canExport={canExport} />

      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New PD request</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="pd-opp">Opportunity (optional)</Label>
                    <Select id="pd-opp" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
                      <option value="">— none —</option>
                      {opportunities.map((o) => <option key={o.id} value={o.id}>{o.code ?? o.id.slice(0, 8)}{o.title ? ` — ${o.title}` : ""}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pd-buyer">Buyer (optional)</Label>
                    <Select id="pd-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                      <option value="">— none —</option>
                      {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="pd-title">Title</Label>
                    <Input id="pd-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="pd-desc">Description</Label>
                    <Textarea id="pd-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New PD request</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No PD requests yet." />
    </div>
  );
}
