"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { bulkDelete } from "@/lib/data-io/actions";

/**
 * Contextual action bar shown when ≥1 row is selected. "Deactivate" soft-deletes
 * the selected records (sets is_active=false) via the generic `bulkDelete`
 * action. Render it only when the user holds `<module>:delete`.
 */
export function BulkDeleteBar({
  entityKey,
  selectedIds,
  onClear,
  label = "records",
}: {
  entityKey: string;
  selectedIds: string[];
  onClear: () => void;
  label?: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  if (selectedIds.length === 0) return null;

  function deactivate() {
    startTransition(async () => {
      const result = await bulkDelete(entityKey, selectedIds);
      if (result.ok) {
        success(`Deactivated ${result.count} ${label}.`);
        onClear();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
      <span className="text-sm font-medium">
        {selectedIds.length} selected
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="h-4 w-4" />
          Clear
        </Button>
        <Button variant="danger" size="sm" onClick={deactivate} disabled={isPending}>
          <Trash2 className="h-4 w-4" />
          {isPending ? "Deactivating…" : "Deactivate"}
        </Button>
      </div>
    </div>
  );
}
