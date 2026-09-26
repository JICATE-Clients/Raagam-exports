"use client";

/**
 * The CAD dispatch's files — .DXF / .PDS / .PLT (doc/order/cad.md §3.1).
 *
 * ## BY EXTENSION, NOT MIME TYPE
 *
 * `file-attachments.tsx` and `cad-marker-file.tsx` both test `file.type`
 * against an accept list. A browser reports an EMPTY or vendor-specific type
 * for every CAD format (a .DXF is "", "image/vnd.dxf" or
 * "application/dxf" depending on the machine), so either component would
 * refuse the very files this dispatch exists to send. `isCadFile` reads the
 * name instead — the same test 0628's `cad_dispatch` applies.
 *
 * ## THE REVISION PATH
 *
 * Uploaded the moment it is chosen, under `cadStoragePath` —
 * cad/{order}/{style}/v{n}/{style}_{n}_{timestamp}.{ext} — with
 * `upsert: false`, so nothing is ever overwritten. The row is written only
 * when the dispatch is recorded (`cad_dispatch`); a sheet cancelled before
 * then hands its paths to `discardCadUploads`.
 *
 * ## TWO KINDS, ONE WIDGET (0632)
 *
 * `kind="pattern"` takes the CAD files and a .PDF marker print; `kind="proof"`
 * takes the email slip / courier docket (.PDF .JPG .PNG .EML .MSG) into the
 * version's `proof/` sub-folder. The rules are `isPatternFile` / `isProofFile`
 * — the same lists 0632's CHECK and `cad_dispatch` hold.
 */

import { useRef, useState } from "react";
import { Download, FileCode2, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { createClient } from "@/lib/supabase/client";
import {
  CAD_BUCKET,
  CAD_FILE_ACCEPT,
  CAD_FILE_MAX_MB,
  cadStoragePath,
  isPatternFile,
  isProofFile,
  PROOF_FILE_ACCEPT,
  type CadFileInput,
  type CadFileKind,
} from "@/lib/orders/cad-lifecycle/types";

/** Seconds — long enough to download, short enough that a copied link is not a leak. */
const SIGNED_URL_TTL = 60;

export function prettySize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Signed on demand, never held. A CAD file cannot be previewed, so it downloads. */
export async function downloadCadFile(storagePath: string, fileName: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(CAD_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL, { download: fileName });
  if (error || !data?.signedUrl) return error?.message ?? "Could not open the file.";
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  return null;
}

export function CadFileUpload({
  files,
  onChange,
  orderId,
  styleRef,
  versionNo,
  disabled,
  kind = "pattern",
}: {
  files: CadFileInput[];
  onChange: (next: CadFileInput[]) => void;
  orderId: string;
  styleRef: string;
  versionNo: number;
  disabled?: boolean;
  kind?: CadFileKind;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList) {
    setError(null);
    const picked = Array.from(list);
    const bad = picked.find((f) => !(kind === "proof" ? isProofFile(f.name) : isPatternFile(f.name)));
    if (bad) {
      setError(
        kind === "proof"
          ? `${bad.name} cannot be a transmission proof — attach a .PDF, .JPG, .PNG, .EML or .MSG.`
          : `${bad.name} is not a CAD file — only .DXF, .PDS, .PLT and a .PDF marker are accepted.`,
      );
      return;
    }
    const big = picked.find((f) => f.size > CAD_FILE_MAX_MB * 1024 * 1024);
    if (big) {
      setError(`${big.name} is over the ${CAD_FILE_MAX_MB} MB limit.`);
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const stamp = Date.now();
      const added: CadFileInput[] = [];
      for (let i = 0; i < picked.length; i++) {
        const f = picked[i];
        const path = cadStoragePath(orderId, styleRef, versionNo, f.name, stamp, files.length + i, kind);
        const { error: upErr } = await supabase.storage
          .from(CAD_BUCKET)
          .upload(path, f, { upsert: false, contentType: f.type || "application/octet-stream" });
        if (upErr) {
          setError(`${f.name}: ${upErr.message}`);
          break;
        }
        added.push({ kind, file_name: f.name, storage_path: path, mime_type: f.type || null, size_bytes: f.size });
      }
      if (added.length > 0) onChange([...files, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((f) => (
            <li key={f.storage_path} className="flex min-w-0 items-center gap-2 px-2 py-1.5">
              <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">
                <Truncated>{f.file_name}</Truncated>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{prettySize(f.size_bytes)}</span>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Download ${f.file_name}`}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={async () => setError(await downloadCadFile(f.storage_path, f.file_name))}
              >
                <Download className="h-4 w-4" aria-hidden />
              </button>
              {!disabled && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Remove ${f.file_name}`}
                  className="shrink-0 text-muted-foreground hover:text-danger"
                  onClick={() => onChange(files.filter((x) => x.storage_path !== f.storage_path))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={kind === "proof" ? PROOF_FILE_ACCEPT : CAD_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => e.target.files && e.target.files.length > 0 && upload(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            {busy
              ? "Uploading…"
              : files.length > 0
                ? "Add another file"
                : kind === "proof"
                  ? "Attach email slip / docket"
                  : "Attach CAD file"}
          </Button>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {kind === "proof"
          ? ".PDF, .JPG, .PNG, .EML or .MSG"
          : ".DXF, .PDS or .PLT (mandatory) · a .PDF marker alongside"}{" "}
        · up to {CAD_FILE_MAX_MB} MB each
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
