"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, Paperclip, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { createClient } from "@/lib/supabase/client";
import {
  APPROVAL_LINK_BUCKET,
  BUYER_FILE_MAX_BYTES,
  BUYER_FILE_MAX_COUNT,
  BUYER_FILE_TYPES,
  type ApprovalLinkFile,
} from "@/lib/ta/approval-links-types";
import { buyerUploadTarget, decideApprovalLink } from "./actions";

/**
 * The buyer's Approve / Rework form (0668, 0672). Name is required for both; a
 * comment is required for Rework — the same rule `ta_link_decide` enforces,
 * stated here first so the buyer is told before pressing, not after.
 *
 * ATTACHMENTS ON REWORK (0672): up to three photos or PDFs showing what needs
 * to change. Each goes straight to private storage through a one-file signed
 * upload URL the server mints for this link only (`buyerUploadTarget`), so
 * the browser needs no login and no bucket is opened to the public; the
 * decision then names the uploaded paths, and the database refuses any path
 * outside this link's own folder.
 */
export function DecisionForm({ token, defaultName }: { token: string; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "rework" | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // A half-typed comment must survive a silent deploy reload (AGENTS.md).
  useUnsavedGuard(!done && (comment.trim() !== "" || files.length > 0 || pending));

  const addFiles = (picked: File[]) => {
    setError(null);
    const bad = picked.find((f) => !BUYER_FILE_TYPES.includes(f.type) || f.size > BUYER_FILE_MAX_BYTES);
    if (bad) {
      setError(
        `${bad.name}: only photos (JPG, PNG, WebP) or PDF, up to ${Math.round(BUYER_FILE_MAX_BYTES / 1_048_576)} MB each.`,
      );
      return;
    }
    setFiles((cur) => [...cur, ...picked].slice(0, BUYER_FILE_MAX_COUNT));
  };

  const submit = (decision: "approved" | "rework") => {
    setError(null);
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (decision === "rework" && !comment.trim()) {
      setError("Please say what needs to change.");
      return;
    }
    startTransition(async () => {
      const uploaded: ApprovalLinkFile[] = [];
      // Files go with a Rework only — an approval needs no evidence.
      if (decision === "rework" && files.length) {
        const supabase = createClient();
        for (const f of files) {
          const target = await buyerUploadTarget(token, f.name, f.type, f.size);
          if (!target.ok) {
            setError(target.error);
            return;
          }
          const { error: upErr } = await supabase.storage
            .from(APPROVAL_LINK_BUCKET)
            .uploadToSignedUrl(target.path, target.uploadToken, f, { contentType: f.type });
          if (upErr) {
            setError(`${f.name} could not be uploaded. Please try again.`);
            return;
          }
          uploaded.push({ path: target.path, name: target.name, mime: f.type });
        }
      }
      const res = await decideApprovalLink(token, decision, name, comment, uploaded);
      if (res.ok) setDone(res.decision);
      else setError(res.error);
    });
  };

  if (done) {
    return (
      <p className="rounded-md border border-success/30 bg-success-soft/60 p-3 text-sm">
        <span className="font-medium">{done === "approved" ? "Approved." : "Rework requested."}</span> Thank you — Raagam
        Exports has been told.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="decider-name" className="block text-xs font-medium">
          Your name <span className="text-danger">*</span>
        </label>
        <Input id="decider-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <div className="space-y-1">
        <label htmlFor="decider-comment" className="block text-xs font-medium">
          Comment <span className="text-muted-foreground">(required for Rework)</span>
        </label>
        <Textarea
          id="decider-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </div>
      <div className="space-y-1.5">
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept={BUYER_FILE_TYPES.join(",")}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-xs">
                <span className="min-w-0 truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                  onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length < BUYER_FILE_MAX_COUNT && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
            <Paperclip aria-hidden /> Attach photos or PDF <span className="text-muted-foreground">(for Rework, up to 3)</span>
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={pending} onClick={() => submit("rework")}>
          <RotateCcw aria-hidden /> Rework
        </Button>
        <Button variant="approve" disabled={pending} onClick={() => submit("approved")}>
          <CheckCircle2 aria-hidden /> Approve
        </Button>
      </div>
    </div>
  );
}
