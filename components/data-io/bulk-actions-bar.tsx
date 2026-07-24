"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, RotateCcw, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { bulkSetActive } from "@/lib/data-io/actions";
import { getIoEntity } from "@/lib/data-io/entities";
import { exportEntity } from "@/lib/data-io/export";

/**
 * Contextual action bar shown when ≥1 row is selected (checklist "Bulk
 * Operations"): Deactivate / Activate the selection (bulk status change) and
 * Export just the selected rows to Excel. Generalizes `BulkDeleteBar`. Render
 * only for an entity that has a data-io descriptor; pass the currently-selected
 * row objects (already permission-scoped by the list) for export.
 */
export function BulkActionsBar<Row extends Record<string, unknown>>({
  entityKey,
  selectedIds,
  selectedRows,
  onClear,
  label = "records",
  canDelete = false,
  canEdit = false,
  canExport = false,
}: {
  entityKey: string;
  selectedIds: string[];
  selectedRows: Row[];
  onClear: () => void;
  label?: string;
  canDelete?: boolean;
  canEdit?: boolean;
  canExport?: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  if (selectedIds.length === 0) return null;

  function setActive(active: boolean) {
    startTransition(async () => {
      const result = await bulkSetActive(entityKey, selectedIds, active);
      if (result.ok) {
        success(`${active ? "Activated" : "Deactivated"} ${result.count} ${label}.`);
        onClear();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  async function exportSelected() {
    const entity = getIoEntity(entityKey);
    if (!entity) {
      toastError("Export is not available for this entity.");
      return;
    }
    try {
      await exportEntity(entity, selectedRows as Record<string, unknown>[], "xlsx");
      success(`Exported ${selectedRows.length} ${label}.`);
    } catch {
      toastError("Export failed.");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
      <span className="text-sm font-medium">{selectedIds.length} selected</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="h-4 w-4" />
          Clear
        </Button>
        {canExport && (
          <Button variant="outline" size="sm" onClick={exportSelected} disabled={isPending}>
            <Download className="h-4 w-4" />
            Export
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setActive(true)} disabled={isPending}>
            <RotateCcw className="h-4 w-4" />
            Activate
          </Button>
        )}
        {canDelete && (
          <Button variant="danger" size="sm" onClick={() => setActive(false)} disabled={isPending}>
            <Trash2 className="h-4 w-4" />
            {isPending ? "Working…" : "Deactivate"}
          </Button>
        )}
      </div>
    </div>
  );
}
