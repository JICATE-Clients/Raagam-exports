"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createGroup,
  toggleGroup,
  deleteGroup,
  createCentre,
  toggleCentre,
  deleteCentre,
} from "@/lib/finance/cost-centres/actions";
import type { CostCentreGroup } from "@/lib/finance/cost-centres/types";
import type { CostCentreRow } from "@/lib/finance/cost-centres/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";

interface Props {
  groups: CostCentreGroup[];
  centres: CostCentreRow[];
  activeGroups: Pick<CostCentreGroup, "id" | "name">[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function CostCentresClient({
  groups,
  centres,
  activeGroups,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // group form
  const [gName, setGName] = useState("");
  const [gCode, setGCode] = useState("");
  // centre form
  const [cName, setCName] = useState("");
  const [cCode, setCCode] = useState("");
  const [cGroup, setCGroup] = useState("");

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

  const groupCols: Column<CostCentreGroup>[] = [
    { header: "Code", cell: (g) => <span className="font-mono text-xs">{g.code ?? "—"}</span> },
    { header: "Group", cell: (g) => <span className="text-sm font-medium">{g.name}</span> },
    {
      header: "Status",
      cell: (g) => (
        <StatusPill tone={g.is_active ? "success" : "neutral"}>
          {g.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    ...(canEdit || canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (g: CostCentreGroup) => (
              <div className="flex justify-end gap-1">
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => toggleGroup(g.id, !g.is_active), "Updated")} disabled={isPending} className="h-7 px-2 text-xs">
                    {g.is_active ? "Deactivate" : "Activate"}
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => deleteGroup(g.id), "Removed")} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                    Delete
                  </Button>
                )}
              </div>
            ),
          } satisfies Column<CostCentreGroup>,
        ]
      : []),
  ];

  const centreCols: Column<CostCentreRow>[] = [
    { header: "Code", cell: (c) => <span className="font-mono text-xs">{c.code ?? "—"}</span> },
    { header: "Cost centre", cell: (c) => <span className="text-sm font-medium">{c.name}</span> },
    { header: "Group", cell: (c) => <span className="text-sm text-muted-foreground">{c.cost_centre_groups?.name ?? "—"}</span> },
    {
      header: "Status",
      cell: (c) => (
        <StatusPill tone={c.is_active ? "success" : "neutral"}>
          {c.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    ...(canEdit || canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (c: CostCentreRow) => (
              <div className="flex justify-end gap-1">
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => toggleCentre(c.id, !c.is_active), "Updated")} disabled={isPending} className="h-7 px-2 text-xs">
                    {c.is_active ? "Deactivate" : "Activate"}
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => deleteCentre(c.id), "Removed")} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                    Delete
                  </Button>
                )}
              </div>
            ),
          } satisfies Column<CostCentreRow>,
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Groups */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Centre Groups ({groups.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable columns={groupCols} rows={groups} getKey={(g) => g.id} empty="No groups yet." />
          {canCreate && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => createGroup({ code: gCode.trim() || null, name: gName.trim(), is_active: true }),
                  "Group added",
                  () => {
                    setGName("");
                    setGCode("");
                  },
                );
              }}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div>
                <Label htmlFor="g-code" className="mb-0.5">Code</Label>
                <Input id="g-code" value={gCode} onChange={(e) => setGCode(e.target.value)} className="w-24" placeholder="Opt." />
              </div>
              <div className="min-w-40 flex-1">
                <Label htmlFor="g-name" className="mb-0.5">Group name *</Label>
                <Input id="g-name" value={gName} onChange={(e) => setGName(e.target.value)} placeholder="e.g. Production" required />
              </div>
              <Button type="submit" size="sm" disabled={isPending || !gName.trim()}>
                Add
              </Button>
            </form>
          )}
        </CardBody>
      </Card>

      {/* Centres */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Centres ({centres.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable columns={centreCols} rows={centres} getKey={(c) => c.id} empty="No cost centres yet." />
          {canCreate && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () =>
                    createCentre({
                      code: cCode.trim() || null,
                      name: cName.trim(),
                      group_id: cGroup || null,
                      is_active: true,
                    }),
                  "Cost centre added",
                  () => {
                    setCName("");
                    setCCode("");
                    setCGroup("");
                  },
                );
              }}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div>
                <Label htmlFor="c-code" className="mb-0.5">Code</Label>
                <Input id="c-code" value={cCode} onChange={(e) => setCCode(e.target.value)} className="w-24" placeholder="Opt." />
              </div>
              <div className="min-w-32 flex-1">
                <Label htmlFor="c-name" className="mb-0.5">Centre name *</Label>
                <Input id="c-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="e.g. Cutting" required />
              </div>
              <div>
                <Label htmlFor="c-group" className="mb-0.5">Group</Label>
                <Select id="c-group" value={cGroup} onChange={(e) => setCGroup(e.target.value)} className="w-36">
                  <option value="">— none —</option>
                  {activeGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" size="sm" disabled={isPending || !cName.trim()}>
                Add
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
