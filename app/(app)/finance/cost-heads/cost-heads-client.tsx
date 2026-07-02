"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCostHead,
  toggleCostHead,
  deleteCostHead,
  createCostItem,
  toggleCostItem,
  deleteCostItem,
} from "@/lib/finance/cost-heads/actions";
import type { CostHead } from "@/lib/finance/cost-heads/types";
import type { CostItemRow } from "@/lib/finance/cost-heads/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";

interface Props {
  heads: CostHead[];
  items: CostItemRow[];
  activeHeads: Pick<CostHead, "id" | "name">[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function CostHeadsClient({
  heads,
  items,
  activeHeads,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [hName, setHName] = useState("");
  const [hCategory, setHCategory] = useState("");
  const [iName, setIName] = useState("");
  const [iHead, setIHead] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(msg);
        after?.();
        router.refresh();
      } else {
        toastError(r.error ?? "Action failed");
      }
    });
  }

  const headCols: Column<CostHead>[] = [
    { header: "Head", cell: (h) => <span className="text-sm font-medium">{h.name}</span> },
    { header: "Category", cell: (h) => <span className="text-sm text-muted-foreground">{h.category ?? "—"}</span> },
    {
      header: "Status",
      cell: (h) => (
        <StatusPill tone={h.is_active ? "success" : "neutral"}>
          {h.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    ...(canEdit || canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (h: CostHead) => (
              <div className="flex justify-end gap-1">
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => toggleCostHead(h.id, !h.is_active), "Updated")} disabled={isPending} className="h-7 px-2 text-xs">
                    {h.is_active ? "Deactivate" : "Activate"}
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => deleteCostHead(h.id), "Removed")} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                    Delete
                  </Button>
                )}
              </div>
            ),
          } satisfies Column<CostHead>,
        ]
      : []),
  ];

  const itemCols: Column<CostItemRow>[] = [
    { header: "Item", cell: (i) => <span className="text-sm font-medium">{i.name}</span> },
    { header: "Head", cell: (i) => <span className="text-sm text-muted-foreground">{i.cost_heads?.name ?? "—"}</span> },
    {
      header: "Status",
      cell: (i) => (
        <StatusPill tone={i.is_active ? "success" : "neutral"}>
          {i.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    ...(canEdit || canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (i: CostItemRow) => (
              <div className="flex justify-end gap-1">
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => toggleCostItem(i.id, !i.is_active), "Updated")} disabled={isPending} className="h-7 px-2 text-xs">
                    {i.is_active ? "Deactivate" : "Activate"}
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => deleteCostItem(i.id), "Removed")} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                    Delete
                  </Button>
                )}
              </div>
            ),
          } satisfies Column<CostItemRow>,
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Heads */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Heads ({heads.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable columns={headCols} rows={heads} getKey={(h) => h.id} empty="No cost heads yet." />
          {canCreate && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => createCostHead({ name: hName.trim(), category: hCategory.trim() || null, is_active: true }),
                  "Head added",
                  () => {
                    setHName("");
                    setHCategory("");
                  },
                );
              }}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div className="min-w-32 flex-1">
                <Label htmlFor="h-name" className="mb-0.5">Head name *</Label>
                <Input id="h-name" value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Direct Labour" required />
              </div>
              <div>
                <Label htmlFor="h-cat" className="mb-0.5">Category</Label>
                <Input id="h-cat" value={hCategory} onChange={(e) => setHCategory(e.target.value)} className="w-32" placeholder="Optional" />
              </div>
              <Button type="submit" size="sm" disabled={isPending || !hName.trim()}>
                Add
              </Button>
            </form>
          )}
        </CardBody>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Items ({items.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable columns={itemCols} rows={items} getKey={(i) => i.id} empty="No cost items yet." />
          {canCreate && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => createCostItem({ name: iName.trim(), cost_head_id: iHead || null, is_active: true }),
                  "Item added",
                  () => {
                    setIName("");
                    setIHead("");
                  },
                );
              }}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div className="min-w-32 flex-1">
                <Label htmlFor="i-name" className="mb-0.5">Item name *</Label>
                <Input id="i-name" value={iName} onChange={(e) => setIName(e.target.value)} placeholder="e.g. Overtime wages" required />
              </div>
              <div>
                <Label htmlFor="i-head" className="mb-0.5">Cost head</Label>
                <Select id="i-head" value={iHead} onChange={(e) => setIHead(e.target.value)} className="w-36">
                  <option value="">— none —</option>
                  {activeHeads.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" size="sm" disabled={isPending || !iName.trim()}>
                Add
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
