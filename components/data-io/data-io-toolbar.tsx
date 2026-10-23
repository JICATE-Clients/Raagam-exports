"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DownloadMenu } from "@/components/ui/download-menu";
import { useToast } from "@/components/ui/toast";
import { getIoEntity } from "@/lib/data-io/entities";
import { exportEntity, downloadTemplate } from "@/lib/data-io/export";
import { ImportDialog } from "./import-dialog";

/**
 * Import / Export / Template action bar for a list page. Drop it above a
 * `DataTable`, pass the entity key + the currently displayed rows. Export &
 * template are gated by `canExport`, import by `canImport`.
 *
 * `size="md"` is the header-row size and is not a free choice — see
 * LAYOUT.md §10 "The header row". These buttons sit in the same band as the
 * search `Input` (`h-9`) and the screen's `+ Add <Entity>` button, and they were
 * `sm` for long enough that Download read as 4px shorter and a font size smaller
 * than the Add button beside it on 28 screens (client 2026-08-05). There is
 * deliberately no `size` prop: the row's size is the row's, not the caller's.
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
          <Button variant="outline" size="md" onClick={() => setImportOpen(true)}>
            <Upload />
            Import
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={busy}
            onClick={() => run(() => downloadTemplate(entity), "download the template")}
          >
            <FileSpreadsheet />
            Template
          </Button>
        </>
      )}

      {/* The shared Download menu (user 2026-10-16, "globally fix") — this screen's
          hand-rolled one was the shape the rest of the app now copies. */}
      {canExport && (
        <DownloadMenu
          disabled={busy}
          formats={[
            { label: "Excel (.xlsx)", icon: FileSpreadsheet, run: () => run(() => exportEntity(entity, exportRows, "xlsx"), "export Excel") },
            { label: "CSV", icon: FileText, run: () => run(() => exportEntity(entity, exportRows, "csv"), "export CSV") },
          ]}
        />
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
