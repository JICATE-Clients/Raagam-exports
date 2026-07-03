"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, UploadCloud, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { parseSpreadsheet, type ParsedSheet } from "@/lib/data-io/parse";
import { coerceRow } from "@/lib/data-io/coerce";
import { bulkImport } from "@/lib/data-io/actions";
import type { IoEntity } from "@/lib/data-io/entities";
import { cn } from "@/lib/utils";

interface PreviewRow {
  line: number;
  raw: Record<string, string>;
  errors: string[];
}

/** Run the SAME coerce + Zod validation the server will, for a live preview. */
function validate(entity: IoEntity, raw: Record<string, string>): string[] {
  const { value, errors } = coerceRow(entity.fields, raw);
  if (errors.length) return errors;
  if (!entity.schema) return []; // export-only entity — no import validation
  const parsed = entity.schema.safeParse(value);
  if (!parsed.success) {
    return [parsed.error.issues[0]?.message ?? "Validation failed"];
  }
  return [];
}

export function ImportDialog({
  entity,
  open,
  onClose,
}: {
  entity: IoEntity;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  // Reset when opened.
  useEffect(() => {
    if (open) {
      setSheet(null);
      setFileName("");
      setParseError(null);
    }
  }, [open]);

  const preview = useMemo<PreviewRow[]>(() => {
    if (!sheet) return [];
    return sheet.rows.map((raw, i) => ({
      line: i + 2,
      raw,
      errors: validate(entity, raw),
    }));
  }, [sheet, entity]);

  const validCount = preview.filter((r) => r.errors.length === 0).length;
  const invalidCount = preview.length - validCount;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setSheet(null);
    try {
      const parsed = await parseSpreadsheet(file);
      setSheet(parsed);
    } catch (err) {
      setParseError((err as Error).message);
    }
  }

  function runImport() {
    if (!sheet) return;
    startTransition(async () => {
      const result = await bulkImport(entity.key, sheet.rows);
      if (result.ok) {
        success(
          `Imported ${result.imported} ${entity.label}` +
            (result.skipped ? ` · skipped ${result.skipped}` : ""),
        );
        onClose();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Import ${entity.label}`}
        className="relative mt-[8vh] flex max-h-[80vh] w-[94%] max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            Import {entity.label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* File picker */}
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-muted/40 px-4 py-6 text-center hover:bg-surface-muted",
            )}
          >
            <UploadCloud className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">
              {fileName || "Choose an .xlsx or .csv file"}
            </span>
            <span className="text-xs text-muted-foreground">
              Columns must match the template headers.
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              onChange={onFile}
              className="hidden"
            />
          </label>

          {parseError && (
            <p className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {parseError}
            </p>
          )}

          {sheet && (
            <div className="mt-4">
              <p className="mb-2 text-sm">
                <span className="font-semibold text-success">{validCount} valid</span>
                {invalidCount > 0 && (
                  <span className="font-semibold text-danger"> · {invalidCount} with errors</span>
                )}
                <span className="text-muted-foreground"> · {preview.length} rows</span>
              </p>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted">
                      <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Row</th>
                      {entity.fields.map((f) => (
                        <th key={f.key} className="px-2 py-1.5 text-left font-semibold text-muted-foreground">
                          {f.header}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 200).map((r) => (
                      <tr
                        key={r.line}
                        className={cn(
                          "border-b border-border last:border-0",
                          r.errors.length && "bg-danger-soft/40",
                        )}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground">{r.line}</td>
                        {entity.fields.map((f) => (
                          <td key={f.key} className="px-2 py-1.5">
                            {r.raw[f.header] || <span className="text-muted-foreground">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-danger">
                          {r.errors.join("; ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.length > 200 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing first 200 of {preview.length} rows (all will be imported).
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={runImport}
            disabled={!sheet || validCount === 0 || isPending}
          >
            {isPending ? "Importing…" : `Import ${validCount} valid row${validCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
