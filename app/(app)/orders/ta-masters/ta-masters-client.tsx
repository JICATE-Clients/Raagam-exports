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
import type { TaActivity } from "@/lib/orders/ta-activities/types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";

interface Props {
  activities: TaActivity[];
  types: ConfigLookup[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  masterCanCreate: boolean;
  masterCanEdit: boolean;
}

export function TaMastersClient({
  activities,
  types,
  canCreate,
  canEdit,
  canDelete,
  masterCanCreate,
  masterCanEdit,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shortName, setShortName] = useState("");
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [hasSub, setHasSub] = useState(false);
  const [considerDelivery, setConsiderDelivery] = useState(false);
  const [blocked, setBlocked] = useState(false);

  function reset() {
    setShortName("");
    setName("");
    setTypeId(null);
    setHasSub(false);
    setConsiderDelivery(false);
    setBlocked(false);
  }

  function openCreate() {
    setEditingId(null);
    reset();
    setFormOpen(true);
  }

  useCreateIntent(() => openCreate());

  function openEdit(a: TaActivity) {
    setEditingId(a.id);
    setShortName(a.short_name);
    setName(a.name);
    setTypeId(a.type_id);
    setHasSub(a.has_sub_activities);
    setConsiderDelivery(a.consider_for_delivery_date);
    setBlocked(!a.is_active);
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
      type_id: typeId,
      has_sub_activities: hasSub,
      consider_for_delivery_date: considerDelivery,
      is_active: !blocked,
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
        success(a.is_active ? "Blocked" : "Unblocked");
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
      header: "Short",
      cell: (a) => <span className="font-mono text-xs font-medium">{a.short_name}</span>,
    },
    { header: "Activity", cell: (a) => <span className="text-sm font-medium">{a.name}</span> },
    {
      header: "Type",
      cell: (a) => (
        <span className="text-sm text-muted-foreground">{a.type?.name ?? "—"}</span>
      ),
    },
    {
      header: "Sub-activities",
      align: "center",
      cell: (a) => (
        <span className="text-xs text-muted-foreground">
          {a.has_sub_activities ? "Yes" : "—"}
        </span>
      ),
    },
    {
      header: "Delivery date",
      align: "center",
      cell: (a) => (
        <span className="text-xs text-muted-foreground">
          {a.consider_for_delivery_date ? "Yes" : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (a) => (
        <StatusPill tone={a.is_active ? "success" : "danger"}>
          {a.is_active ? "Active" : "Blocked"}
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
                      {a.is_active ? "Block" : "Unblock"}
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
      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="sm" onClick={closeForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={openCreate}>New activity</Button>
          )}
        </div>
      )}

      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit TA activity" : "New TA activity"}</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              onSubmit={handleSave}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <Label htmlFor="ta-short">
                  Short name <span className="text-danger">*</span>
                </Label>
                <Input
                  id="ta-short"
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  placeholder="e.g. KNIT"
                  required
                />
              </div>
              <div>
                <Label htmlFor="ta-name">
                  Name <span className="text-danger">*</span>
                </Label>
                <Input
                  id="ta-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Knitting"
                  required
                />
              </div>
              <div>
                <LookupDialogPicker
                  kind="ta_activity_type"
                  label="Type"
                  options={types}
                  value={typeId}
                  onChange={setTypeId}
                  canCreate={masterCanCreate}
                  canEdit={masterCanEdit}
                />
              </div>

              <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-primary"
                  checked={hasSub}
                  onChange={(e) => setHasSub(e.target.checked)}
                />
                <span className="text-sm">Has sub-activities</span>
              </label>
              <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-primary"
                  checked={considerDelivery}
                  onChange={(e) => setConsiderDelivery(e.target.checked)}
                />
                <span className="text-sm">Consider for delivery date</span>
              </label>
              <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-danger"
                  checked={blocked}
                  onChange={(e) => setBlocked(e.target.checked)}
                />
                <span className="text-sm">Blocked</span>
              </label>

              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
                <Button
                  type="submit"
                  disabled={isPending || !shortName.trim() || !name.trim()}
                >
                  {isPending ? "Saving…" : editingId ? "Update activity" : "Add activity"}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancel
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
      />
    </div>
  );
}
