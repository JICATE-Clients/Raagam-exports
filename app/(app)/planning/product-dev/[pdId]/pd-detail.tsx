"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import {
  addPdProduct,
  deletePdProduct,
  advancePdStage,
  closePdRequest,
  cancelPdRequest,
  deletePdRequest,
} from "@/lib/planning/extras-actions";
import {
  PD_STAGES,
  PD_STAGE_LABELS,
  nextPdStage,
  type PdStage,
  type PdStatus,
  type PdProduct,
} from "@/lib/planning/types";
import type { StyleOption } from "@/lib/planning/extras-service";

interface Props {
  pdId: string;
  stage: PdStage;
  status: PdStatus;
  description: string | null;
  products: PdProduct[];
  styles: StyleOption[];
  canEdit: boolean;
  canDelete: boolean;
}

export function PdDetail({ pdId, stage, status, description, products, styles, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const isOpen = status === "open";

  const [styleId, setStyleId] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const currentIdx = PD_STAGES.indexOf(stage);
  const next = nextPdStage(stage);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await addPdProduct(pdId, {
        style_id: styleId || null,
        name,
        description: desc || null,
      });
      if (r.ok) {
        success("Product added");
        setStyleId(""); setName(""); setDesc("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<PdProduct>[] = [
    { header: "Product", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Description", cell: (r) => <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span> },
    ...(canEdit && isOpen
      ? [
          {
            header: "",
            cell: (r: PdProduct) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deletePdProduct(r.id, pdId), "Removed")}>Remove</Button>
            ),
          } satisfies Column<PdProduct>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Pipeline strip */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            {PD_STAGES.map((st, i) => (
              <div key={st} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground">→</span>}
                <span
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                    i < currentIdx
                      ? "border-success bg-success-soft text-success"
                      : i === currentIdx
                      ? "border-primary bg-surface text-primary"
                      : "border-border bg-surface-muted text-muted-foreground"
                  }`}
                >
                  {PD_STAGE_LABELS[st]}
                </span>
              </div>
            ))}
          </div>
          {canEdit && isOpen && (
            <div className="mt-4 flex flex-wrap gap-3">
              {next && (
                <Button disabled={isPending} onClick={() => run(() => advancePdStage(pdId), `Advanced to ${PD_STAGE_LABELS[next]}`)}>
                  Advance to {PD_STAGE_LABELS[next]}
                </Button>
              )}
              <Button variant="outline" disabled={isPending} onClick={() => run(() => closePdRequest(pdId), "Closed")}>Close</Button>
              <Button variant="outline" disabled={isPending} onClick={() => run(() => cancelPdRequest(pdId), "Cancelled")}>Cancel</Button>
            </div>
          )}
        </CardBody>
      </Card>

      {description && (
        <Card>
          <CardBody>
            <dt className="text-xs text-muted-foreground">Description</dt>
            <dd className="mt-0.5 text-sm text-muted-foreground">{description}</dd>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Products ({products.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {canEdit && isOpen && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Label htmlFor="pdp-style">Style</Label>
                <Select id="pdp-style" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                  <option value="">— none —</option>
                  {styles.map((s) => <option key={s.id} value={s.id}>{s.style_code ?? s.id.slice(0, 8)}</option>)}
                </Select>
              </div>
              <div className="w-48">
                <Label htmlFor="pdp-name">Name</Label>
                <Input id="pdp-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="min-w-[180px] flex-1">
                <Label htmlFor="pdp-desc">Description</Label>
                <Input id="pdp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          )}
          <DataTable columns={columns} rows={products} getKey={(r) => r.id} empty="No products yet." />
        </CardBody>
      </Card>

      {canDelete && (status === "open" || status === "cancelled") && (
        <div className="flex justify-end">
          <Button variant="outline" className="text-danger hover:border-danger" disabled={isPending}
            onClick={() => run(async () => {
              const r = await deletePdRequest(pdId);
              if (r.ok) router.push("/planning/product-dev");
              return r;
            }, "Deleted")}>Delete PD request</Button>
        </div>
      )}
    </div>
  );
}
