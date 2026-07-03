"use client";

import { useState } from "react";
import { Upload, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { getIoEntity } from "@/lib/data-io/entities";
import { exportEntity, downloadTemplate } from "@/lib/data-io/export";
import { ImportDialog } from "./import-dialog";

/**
 * Import / Export / Template action bar for a list page. Drop it above a
 * `DataTable`, pass the entity key + the currently displayed rows. Export &
 * template are gated by `canExport`, import by `canImport`.
 */
export function DataIoToolbar({
  entityKey,
  rows,
  canImport = false,
  canExport = false,
}: {
  entityKey: string;
  /** The list's current rows (any record shape); read by key for export. */
  rows: readonly unknown[];
  canImport?: boolean;
  canExport?: boolean;
}) {
  const { error: toastError } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const entity = getIoEntity(entityKey);

  if (!entity) return null;

  const exportRows = rows as Record<string, unknown>[];

  async function run(fn: () => Promise<void>, label: string) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      toastError(`Could not ${label}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canImport && (
        <>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => run(() => downloadTemplate(entity), "download the template")}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Template
          </Button>
        </>
      )}

      {canExport && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => exportEntity(entity, exportRows, "xlsx"), "export Excel")}
          >
            <Download className="h-4 w-4" />
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => exportEntity(entity, exportRows, "csv"), "export CSV")}
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </>
      )}

      {canImport && (
        <ImportDialog
          entity={entity}
          open={importOpen}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
