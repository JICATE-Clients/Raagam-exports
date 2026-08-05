"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createCategory,
  updateCategory,
  toggleCategory,
  deleteCategory,
} from "@/lib/logistics/export-categories/actions";
import type { ExportCategory } from "@/lib/logistics/export-categories/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { Ban, CheckCircle2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { withCreatedColumns } from "@/components/ui/created-columns";

interface Props {
  categories: ExportCategory[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function ExportCategoriesClient({
  categories,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function openCreate() {
    setEditingId(null);
    setName("");
    setDescription("");
    setFormOpen(true);
  }

  function openEdit(c: ExportCategory) {
    setEditingId(c.id);
    setName(c.name);
    setDescription(c.description ?? "");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const payload = { name: name.trim(), description: description.trim() || null, is_active: true };
    startTransition(async () => {
      const result = editingId
        ? await updateCategory(editingId, payload)
        : await createCategory(payload);
      if (result.ok) {
        success(editingId ? "Category updated" : "Category added");
        closeForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleToggle(c: ExportCategory) {
    startTransition(async () => {
      const result = await toggleCategory(c.id, !c.is_active);
      if (result.ok) {
        success(c.is_active ? "Deactivated" : "Activated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteCategory(id);
      if (result.ok) {
        success("Category removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<ExportCategory>[] = [
    { header: "Name", cell: (c) => <span className="text-sm font-medium">{c.name}</span> },
    {
      header: "Description",
      cell: (c) => <span className="text-sm text-muted-foreground">{c.description ?? "—"}</span>,
    },
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
          rowActionsColumn<ExportCategory>((c) => (
            <RowActions
              label={c.name}
              onEdit={() => openEdit(c)}
              canEdit={canEdit}
              onDelete={() => handleDelete(c.id)}
              canDelete={canDelete}
              isPending={isPending}
              /* Activate/Deactivate is a lifecycle toggle, not row CRUD — it
                 belongs behind the ⋮ rather than competing with Edit. */
              menu={
                canEdit
                  ? [
                      {
                        label: c.is_active ? "Deactivate" : "Activate",
                        icon: c.is_active ? Ban : CheckCircle2,
                        onClick: () => handleToggle(c),
                      },
                    ]
                  : []
              }
            />
          )),
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="md" onClick={closeForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={openCreate}>New category</Button>
          )}
        </div>
      )}

      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit category" : "New category"}</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ec-name">Name *</Label>
                <Input id="ec-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Knitted garments" required />
              </div>
              <div>
                <Label htmlFor="ec-desc">Description</Label>
                <Input id="ec-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !name.trim()}>
                  {isPending ? "Saving…" : editingId ? "Update" : "Add category"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={withCreatedColumns(columns, categories)}
        rows={categories}
        getKey={(c) => c.id}
        empty="No export categories yet."
      />
    </div>
  );
}
