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
  const [downloadOpen, setDownloadOpen] = useState(false);
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
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setDownloadOpen((o) => !o)}
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
          {downloadOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDownloadOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-md border border-border bg-surface p-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-foreground hover:bg-surface-muted"
                  onClick={() => {
                    setDownloadOpen(false);
                    run(() => exportEntity(entity, exportRows, "xlsx"), "export Excel");
                  }}
                >
                  Excel (.xlsx)
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-foreground hover:bg-surface-muted"
                  onClick={() => {
                    setDownloadOpen(false);
                    run(() => exportEntity(entity, exportRows, "csv"), "export CSV");
                  }}
                >
                  CSV
                </button>
              </div>
            </>
          )}
        </div>
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
