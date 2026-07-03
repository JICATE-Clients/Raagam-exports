"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { BulkDeleteBar } from "@/components/data-io/bulk-delete-bar";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import {
  createWorkType,
  deleteWorkType,
  createSewingOperation,
  deleteSewingOperation,
} from "@/lib/production/extras-actions";
import type { WorkType, SewingOperation } from "@/lib/production/extras-types";

interface Props {
  workTypes: WorkType[];
  operations: SewingOperation[];
  canCreate: boolean;
  canExport?: boolean;
  canDelete: boolean;
}

export function MastersClient({ workTypes, operations, canCreate, canExport = false, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const selWork = useRowSelection();
  const selSewing = useRowSelection();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  // work type form
  const [wtStage, setWtStage] = useState("");
  const [wtShort, setWtShort] = useState("");
  const [wtName, setWtName] = useState("");

  function addWorkType(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createWorkType({ stage: wtStage || null, short_name: wtShort || null, name: wtName });
      if (r.ok) {
        success("Work type added");
        setWtStage(""); setWtShort(""); setWtName("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  // sewing op form
  const [soName, setSoName] = useState("");
  const [soSmv, setSoSmv] = useState("");

  function addOp(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createSewingOperation({ name: soName, smv: soSmv ? parseFloat(soSmv) : null, notes: null });
      if (r.ok) {
        success("Operation added");
        setSoName(""); setSoSmv("");
        router.refresh();
      } else toastError(r.error);
    });
  }

  const wtColumns: Column<WorkType>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Stage", cell: (r) => <span className="text-sm">{r.stage ?? "—"}</span> },
    { header: "Short", cell: (r) => <span className="text-sm">{r.short_name ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    ...(canDelete
      ? [{ header: "", cell: (r: WorkType) => (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
            onClick={() => run(() => deleteWorkType(r.id), "Deleted")}>Del</Button>
        ) } satisfies Column<WorkType>]
      : []),
  ];

  const soColumns: Column<SewingOperation>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "SMV", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.smv != null ? fmtNumber(r.smv) : "—"}</span> },
    ...(canDelete
      ? [{ header: "", cell: (r: SewingOperation) => (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
            onClick={() => run(() => deleteSewingOperation(r.id), "Deleted")}>Del</Button>
        ) } satisfies Column<SewingOperation>]
      : []),
  ];

  const workTypesTab = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataIoToolbar entityKey="work_types" rows={workTypes} canImport={canCreate} canExport={canExport} />
      </div>

      {canDelete && (
        <BulkDeleteBar entityKey="work_types" selectedIds={selWork.selectedIds} onClear={selWork.clear} label="work types" />
      )}

      {canCreate && (
        <Card>
          <CardHeader><CardTitle>Add work type</CardTitle></CardHeader>
          <CardBody>
            <form onSubmit={addWorkType} className="flex flex-wrap items-end gap-3">
              <div className="w-28"><Label htmlFor="wt-stage">Stage</Label><Input id="wt-stage" placeholder="CP/SW/PACK" value={wtStage} onChange={(e) => setWtStage(e.target.value)} /></div>
              <div className="w-32"><Label htmlFor="wt-short">Short name</Label><Input id="wt-short" value={wtShort} onChange={(e) => setWtShort(e.target.value)} /></div>
              <div className="min-w-[200px] flex-1"><Label htmlFor="wt-name">Name</Label><Input id="wt-name" value={wtName} onChange={(e) => setWtName(e.target.value)} required /></div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          </CardBody>
        </Card>
      )}
      <DataTable
        columns={wtColumns}
        rows={workTypes}
        getKey={(r) => r.id}
        empty="No work types yet."
        selectable={canDelete}
        selectedKeys={selWork.selectedKeys}
        onToggle={selWork.toggle}
        onToggleAll={() => selWork.toggleAll(workTypes.map((r) => r.id))}
      />
    </div>
  );

  const opsTab = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataIoToolbar entityKey="sewing_operations" rows={operations} canImport={canCreate} canExport={canExport} />
      </div>

      {canDelete && (
        <BulkDeleteBar entityKey="sewing_operations" selectedIds={selSewing.selectedIds} onClear={selSewing.clear} label="operations" />
      )}

      {canCreate && (
        <Card>
          <CardHeader><CardTitle>Add sewing operation</CardTitle></CardHeader>
          <CardBody>
            <form onSubmit={addOp} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1"><Label htmlFor="so-name">Name</Label><Input id="so-name" value={soName} onChange={(e) => setSoName(e.target.value)} required /></div>
              <div className="w-32"><Label htmlFor="so-smv">SMV</Label><Input id="so-smv" type="number" min="0" step="0.01" value={soSmv} onChange={(e) => setSoSmv(e.target.value)} /></div>
              <Button type="submit" disabled={isPending}>Add</Button>
            </form>
          </CardBody>
        </Card>
      )}
      <DataTable
        columns={soColumns}
        rows={operations}
        getKey={(r) => r.id}
        empty="No sewing operations yet."
        selectable={canDelete}
        selectedKeys={selSewing.selectedKeys}
        onToggle={selSewing.toggle}
        onToggleAll={() => selSewing.toggleAll(operations.map((r) => r.id))}
      />
    </div>
  );

  return (
    <Tabs
      items={[
        { key: "work-types", label: `Work Types (${workTypes.length})`, content: workTypesTab },
        { key: "operations", label: `Sewing Operations (${operations.length})`, content: opsTab },
      ]}
      defaultKey="work-types"
    />
  );
}
