"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { createClient } from "@/lib/supabase/client";

/**
 * ONE marker PDF, on one marker row.
 *
 * ## WHY THIS IS NOT `components/ui/file-attachments.tsx`
 *
 * That component is the right one for a RECORD's document list and this is not
 * one. Two differences, and the second is the one that decides it:
 *
 *  - It holds MANY files with a per-row "Document type" `<Select>`. A marker
 *    layout has exactly one PDF and its kind is fixed by the row it sits on, so
 *    the select would be a field whose only correct answer is the one already
 *    given — and every other option in it ("Buyer Order Sheet", "Approval /
 *    Shade Card") a way to mislabel the marker.
 *  - Its `AttachmentKind` union is `'sketch' | 'order_sheet' | 'approval'` and
 *    `amendmentFileInput` in `lib/orders/amendments/types.ts` states the same
 *    three as a Zod enum. Filing a marker through it means widening both, in
 *    files this lane may not edit — see the header of the CAD migration for what
 *    goes wrong if a fourth kind reaches that table unwidened.
 *
 * WHAT IS SHARED IS THE THING WORTH SHARING: the same PRIVATE
 * `garment-order-docs` bucket 0416 created, the same `createSignedUrl` read, and
 * the same accepted remainder — the object outlives the row, because Cancel is
 * the operator's undo and an undo must not destroy a file.
 *
 * ## KEYS
 *
 * Nothing here is field-like, so `cycleTab` (lib/focus.ts) walks straight past
 * it — which is the contract, not an accident: Tab lands on FIELDS, and Upload /
 * Open / Remove are actions. They stay on the mouse and in screen-reader order.
 */

export type MarkerFile = {
  file_name: string;
  /** Path WITHIN the bucket. Never a URL — a signed one expires. */
  storage_path: string;
  mime_type: string;
  size_bytes: number;
};

export const MARKER_BUCKET = "garment-order-docs";

const ACCEPT = "application/pdf,image/jpeg,image/png";
/** Seconds. Long enough to open, short enough that a copied link is not a leak. */
const SIGNED_URL_TTL = 60;
const MAX_MB = 20;

function prettySize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CadMarkerFile({
  value,
  onChange,
  folder,
  disabled,
}: {
  value: MarkerFile | null;
  onChange: (next: MarkerFile | null) => void;
  /** Path prefix inside the bucket — scope it to the sheet, not to the row: a
   *  row has no id until Save and the upload happens before that. */
  folder: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!ACCEPT.split(",").includes(file.type)) {
      setError(`${file.name}: a marker must be a PDF, JPG or PNG.`);
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`${file.name}: over the ${MAX_MB} MB limit.`);
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "pdf";
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(MARKER_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) {
        setError(`${file.name}: ${upErr.message}`);
        return;
      }
      onChange({
        file_name: file.name,
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  /** Signed on demand, never held: a stored URL would be dead when clicked. */
  async function open() {
    if (!value) return;
    setError(null);
    const supabase = createClient();
    const { data, error: signErr } = await supabase.storage
      .from(MARKER_BUCKET)
      .createSignedUrl(value.storage_path, SIGNED_URL_TTL);
    if (signErr || !data?.signedUrl) {
      setError(signErr?.message ?? "Could not open the marker.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="min-w-0">
      {value ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <button
            type="button"
            onClick={open}
            className="min-w-0 flex-1 text-left text-sm text-foreground hover:underline"
          >
            <Truncated text={value.file_name} className="block" />
          </button>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {prettySize(value.size_bytes)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Remove ${value.file_name}`}
            className="shrink-0 text-muted-foreground hover:text-danger"
            onClick={() => onChange(null)}
          >
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
          </Button>
        </div>
      ) : (
        // `sm`, not `md` — an in-grid control, the dense band AGENTS.md's
        // "The header row" exempts.
        // toolbar-size: exempt -- in-grid upload control, not a header row
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-4 w-4 shrink-0" aria-hidden />
          )}
          {busy ? "Uploading" : "Marker PDF"}
        </Button>
      )}

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}

      {/* Hidden on purpose: a bare file input is unstyleable, and being
          field-like to nobody it would sit in the tab order doing nothing.
          autofill: exempt -- a file input has no suggestion list */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
