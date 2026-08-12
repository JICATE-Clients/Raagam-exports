"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Truncated } from "@/components/ui/truncated";
import { createClient } from "@/lib/supabase/client";

/**
 * Documents attached to a record — a JPG of the style, the buyer's original PDF
 * order sheet, a shade card (client 2026-08-12).
 *
 * ## Why this is not `PhotoUpload` with more props
 *
 * `components/ui/photo-upload.tsx` holds ONE image, in the **public**
 * `employee-photos` bucket (0336), and hands back `getPublicUrl` — a URL anyone
 * can read forever, with no login. That is a defensible trade for a staff photo
 * and the wrong one for a buyer's order sheet, which carries the prices and the
 * customer's name. So this reads back through `createSignedUrl` and its bucket
 * is created `public = false`; widening `PhotoUpload` instead would have made
 * the employee screen's URLs signed too, or left this one public by inheritance.
 *
 * ## THE OBJECT OUTLIVES THE ROW, DELIBERATELY
 *
 * The file uploads the moment it is chosen; the metadata row is written on Save.
 * Removing a row therefore drops the row and LEAVES the object in the bucket,
 * and so does cancelling the edit. Deleting on removal would be tidier and is
 * the wrong call: Cancel is the operator's undo, and a delete makes the one
 * action they expect to be reversible destroy a file they may not have another
 * copy of. Orphaned objects accumulate instead. That is a known, accepted
 * remainder — a sweep is a separate job, not a silent side effect of a click.
 *
 * ## Keys
 *
 * Nothing here is field-like except the per-row kind `<Select>`, so `cycleTab`
 * (lib/focus.ts) walks straight to it and skips the buttons — which is the
 * contract, not an accident: Tab lands on FIELDS, and Upload / Remove / Open are
 * actions. They stay on the mouse and in screen-reader order. Render the panel
 * AFTER a section's fields so the Select does not become the section edge ahead
 * of them.
 */

export type AttachmentKind = "sketch" | "order_sheet" | "approval";

export const ATTACHMENT_KINDS: { value: AttachmentKind; label: string }[] = [
  { value: "sketch", label: "Style Sketch / Image" },
  { value: "order_sheet", label: "Buyer Order Sheet" },
  { value: "approval", label: "Approval / Shade Card" },
];

export type AttachmentRow = {
  /** Client-side row identity, as every child grid on these screens uses. */
  key: string;
  doc_kind: AttachmentKind | "";
  file_name: string;
  /** Path WITHIN the bucket. Never a URL — a signed one expires. */
  storage_path: string;
  mime_type: string;
  size_bytes: number;
};

const DEFAULT_ACCEPT = "image/jpeg,image/png,application/pdf";
/** Seconds. Long enough to open, short enough that a copied link is not a leak. */
const SIGNED_URL_TTL = 60;

function prettySize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileAttachments({
  rows,
  onChange,
  bucket,
  folder,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = 10,
  disabled,
  label = "Attachments",
  hint = "JPG, PNG or PDF — the style sketch, the buyer order sheet, and any approvals.",
}: {
  rows: AttachmentRow[];
  onChange: (next: AttachmentRow[]) => void;
  bucket: string;
  /** Path prefix inside the bucket — scope it to the record, e.g. the amendment id. */
  folder: string;
  accept?: string;
  maxSizeMb?: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accepted = accept.split(",").map((s) => s.trim());
  const maxBytes = maxSizeMb * 1024 * 1024;

  async function handleFiles(files: FileList) {
    setError(null);
    const supabase = createClient();
    const added: AttachmentRow[] = [];

    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!accepted.includes(file.type)) {
          setError(`${file.name}: only JPG, PNG and PDF are accepted.`);
          continue;
        }
        if (file.size > maxBytes) {
          setError(`${file.name}: over the ${maxSizeMb} MB limit.`);
          continue;
        }
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${folder}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) {
          setError(`${file.name}: ${upErr.message}`);
          continue;
        }
        added.push({
          key: crypto.randomUUID(),
          // Guessed from the type and never final — the operator can re-label
          // it. A PDF is far more often the order sheet than a sketch.
          doc_kind: file.type === "application/pdf" ? "order_sheet" : "sketch",
          file_name: file.name,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
        });
      }
      if (added.length) onChange([...rows, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  /** Signed on demand, never held: a stored URL would be dead when it was clicked. */
  async function open(row: AttachmentRow) {
    setError(null);
    const supabase = createClient();
    const { data, error: signErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL);
    if (signErr || !data?.signedUrl) {
      setError(signErr?.message ?? "Could not open the file.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {/* `sm`, not `md` — this is a child-grid add control, the dense band
            AGENTS.md's "The header row" exempts.
            toolbar-size: exempt -- in-editor add control, not a header row */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-add
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 shrink-0" />
          )}
          {busy ? "Uploading" : "+ Add file"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No documents attached.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
            >
              {r.mime_type === "application/pdf" ? (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <button
                type="button"
                onClick={() => open(r)}
                className="min-w-0 flex-1 text-left text-sm text-foreground hover:underline"
              >
                <Truncated text={r.file_name} className="block" />
              </button>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {prettySize(r.size_bytes)}
              </span>
              <Select
                aria-label="Document type"
                className="w-44 shrink-0"
                value={r.doc_kind}
                disabled={disabled}
                onChange={(e) =>
                  onChange(
                    rows.map((x) =>
                      x.key === r.key
                        ? { ...x, doc_kind: e.target.value as AttachmentKind | "" }
                        : x,
                    ),
                  )
                }
              >
                <option value="">—</option>
                {ATTACHMENT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
              {/* `data-row-remove` so Ctrl+Del reaches it from the row's Select,
                  the affordance every child-grid row already carries. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-row-remove
                disabled={disabled}
                aria-label={`Remove ${r.file_name}`}
                className="shrink-0 text-muted-foreground hover:text-danger"
                onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="h-4 w-4 shrink-0" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {/* Hidden on purpose: a bare file input is unstyleable, and being
          field-like to nobody it would sit in the tab order doing nothing.
          autofill: exempt -- a file input has no suggestion list */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const fs = e.target.files;
          if (fs && fs.length) handleFiles(fs);
          e.target.value = "";
        }}
      />
    </div>
  );
}
