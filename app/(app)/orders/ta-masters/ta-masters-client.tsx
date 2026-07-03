"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createTaActivity,
  updateTaActivity,
  toggleTaActivity,
  deleteTaActivity,
} from "@/lib/orders/ta-activities/actions";
import { TA_DEPARTMENTS, type TaActivity } from "@/lib/orders/ta-activities/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { BulkDeleteBar } from "@/components/data-io/bulk-delete-bar";
import { useRowSelection } from "@/lib/data-io/use-row-selection";

interface Props {
  activities: TaActivity[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport?: boolean;
}

export function TaMastersClient({
  activities,
  canCreate,
  canEdit,
  canDelete,
  canExport = false,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const sel = useRowSelection();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shortName, setShortName] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [sequence, setSequence] = useState("");
  const [offset, setOffset] = useState("");

  function openCreate() {
    setEditingId(null);
    setShortName("");
    setName("");
    setDepartment("");
    setSequence(String((activities.length + 1) * 10));
    setOffset("");
    setFormOpen(true);
  }

  function openEdit(a: TaActivity) {
    setEditingId(a.id);
    setShortName(a.short_name);
    setName(a.name);
    setDepartment(a.department ?? "");
    setSequence(String(a.sequence));
    setOffset(String(a.default_offset_days));
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      short_name: shortName.trim(),
      name: name.trim(),
      department: department.trim() || null,
      sequence: Number(sequence) || 0,
      default_offset_days: Number(offset) || 0,
      is_active: true,
    };
    startTransition(async () => {
      const result = editingId
        ? await updateTaActivity(editingId, payload)
        : await createTaActivity(payload);
      if (result.ok) {
        success(editingId ? "Activity updated" : "Activity added");
        closeForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleToggle(a: TaActivity) {
    startTransition(async () => {
      const result = await toggleTaActivity(a.id, !a.is_active);
      if (result.ok) {
        success(a.is_active ? "Deactivated" : "Activated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteTaActivity(id);
      if (result.ok) {
        success("Activity removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<TaActivity>[] = [
    {
      header: "#",
      cell: (a) => (
        <span className="text-xs tabular-nums text-muted-foreground">{a.sequence}</span>
      ),
    },
    {
      header: "Short",
      cell: (a) => <span className="font-mono text-xs font-medium">{a.short_name}</span>,
    },
    { header: "Activity", cell: (a) => <span className="text-sm font-medium">{a.name}</span> },
    {
      header: "Department",
      cell: (a) => (
        <span className="text-sm text-muted-foreground">{a.department ?? "—"}</span>
      ),
    },
    {
      header: "Offset (days)",
      align: "right",
      cell: (a) => (
        <span className="tabular-nums text-sm">{a.default_offset_days}</span>
      ),
    },
    {
      header: "Status",
      cell: (a) => (
        <StatusPill tone={a.is_active ? "success" : "neutral"}>
          {a.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    ...(canEdit || canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (a: TaActivity) => (
              <div className="flex justify-end gap-1">
                {canEdit && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(a)}
                      disabled={isPending}
                      className="h-7 px-2 text-xs"
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleToggle(a)}
                      disabled={isPending}
                      className="h-7 px-2 text-xs"
                    >
                      {a.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(a.id)}
                    disabled={isPending}
                    className="h-7 px-2 text-xs text-danger hover:opacity-80"
                  >
                    Delete
                  </Button>
                )}
              </div>
            ),
          } satisfies Column<TaActivity>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataIoToolbar
          entityKey="ta_activities"
          rows={activities}
          canImport={canCreate}
          canExport={canExport}
        />
        {canCreate &&
          (formOpen ? (
            <Button variant="outline" size="sm" onClick={closeForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={openCreate}>New activity</Button>
          ))}
      </div>

      {canDelete && (
        <BulkDeleteBar
          entityKey="ta_activities"
          selectedIds={sel.selectedIds}
          onClear={sel.clear}
          label="activities"
        />
      )}

      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit activity" : "New activity"}</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              onSubmit={handleSave}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <Label htmlFor="ta-short">Short name *</Label>
                <Input
                  id="ta-short"
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  placeholder="e.g. KNIT"
                  required
                />
              </div>
              <div>
                <Label htmlFor="ta-name">Activity name *</Label>
                <Input
                  id="ta-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Knitting"
                  required
                />
              </div>
              <div>
                <Label htmlFor="ta-dept">Department</Label>
                <Input
                  id="ta-dept"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g. Knitting"
                  list="ta-departments"
                />
                <datalist id="ta-departments">
                  {TA_DEPARTMENTS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="ta-seq">Sequence</Label>
                <Input
                  id="ta-seq"
                  type="number"
                  min="0"
                  value={sequence}
                  onChange={(e) => setSequence(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="ta-offset">Default offset (days vs ship)</Label>
                <Input
                  id="ta-offset"
                  type="number"
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                  placeholder="e.g. -65"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !shortName.trim() || !name.trim()}>
                  {isPending ? "Saving…" : editingId ? "Update activity" : "Add activity"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={activities}
        getKey={(a) => a.id}
        empty="No T&A activities defined yet."
        selectable={canDelete}
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() => sel.toggleAll(activities.map((a) => a.id))}
      />
    </div>
  );
}
