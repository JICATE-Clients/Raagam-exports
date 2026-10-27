"use client";

import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Link2, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  ATTACHMENTS_PER_MESSAGE,
  MESSAGE_MAX,
  attachmentPath,
  attachmentProblem,
  mentionToken,
  recordToken,
  RECORD_KINDS,
  type AttachmentInput,
  type CommMember,
  type RecordPreview,
} from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { discardUpload, verifyUpload } from "@/lib/comms/attachment-actions";
import { ACCEPT_ATTR, ATTACHMENT_TYPES_LABEL } from "@/lib/comms/attachments";
import { uploadWithProgress } from "@/lib/comms/upload";
import { fileSize } from "./message-body";
import { RecordPickerSheet } from "./record-picker-sheet";

/**
 * One pending file: uploading (with progress) -> checking (the server reads its
 * first bytes, 0761) -> done, or failed with the reason. Only `done` files are
 * sent; a removed chip deletes its upload.
 */
type Upload = {
  key: string;
  name: string;
  size: number;
  status: "uploading" | "checking" | "done" | "failed";
  progress: number;
  path?: string;
  file?: AttachmentInput;
  error?: string;
};

/**
 * The message box.
 *
 * ## ENTER SENDS — A DELIBERATE, SCOPED EXCEPTION TO THE KEYBOARD CONTRACT
 *
 * Everywhere else in the app Enter moves to the next field and saves off the
 * last one (raagam-keyboard-contract). A chat box has one field, and every chat
 * tool an operator has used sends on Enter, so here Enter sends and Shift+Enter
 * starts a new line. The handler calls `preventDefault()`, which is exactly
 * what makes keyboard-nav-provider.tsx stand down (`if (e.defaultPrevented)
 * return`); the hub root also carries `data-focus-scope="off"`. Nothing global
 * changes. Phase-3 default, flagged for the client — reversing it is this one
 * handler.
 *
 * ## caps-input: exempt -- a chat message is prose, not a stored value
 * (reasoning in lib/comms/types.ts; same carve-out as the order channel).
 *
 * ## MENTIONS
 *
 * Typing `@` offers the conversation's active members. Picking one inserts
 * `@Name` for the eye and remembers name → id; on send each remembered `@Name`
 * becomes the `<@uuid>` token the server parses. The SERVER decides who was
 * really mentioned (active members only) — this list is a convenience.
 *
 * ## RECORD LINKS (phase 6)
 *
 * "Link a record" picks a PO, indent or RE the SENDER may see and inserts
 * `[PO PO-0012]` for the eye; on send it becomes `<rec:kind:uuid>`. Only the
 * kind and id travel — each reader's chip is resolved for that reader.
 *
 * ## FILES UPLOAD WHEN CHOSEN
 *
 * Straight from the browser into the private bucket (its insert policy
 * requires membership of the folder's conversation), so Send carries only the
 * keys. Type and size are checked here for the sentence, and again by the
 * bucket and the send RPC for the guarantee.
 */
export function Composer({
  conversationId,
  members,
  meId,
  placeholder,
  onSend,
  autoFocus = false,
}: {
  conversationId: string;
  members: CommMember[];
  meId: string;
  placeholder: string;
  /** Resolve true when the message is accepted (or queued) and the box may clear. */
  onSend: (body: string | null, attachments: AttachmentInput[]) => Promise<boolean>;
  autoFocus?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // What the operator sees → the token sent: "@Name" → <@uuid>, "[PO PO-0012]" → <rec:…>.
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [linking, setLinking] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [hi, setHi] = useState(0);

  const [dragging, setDragging] = useState(false);
  const uploading = uploads.some((u) => u.status === "uploading" || u.status === "checking");
  useUnsavedGuard(text.trim().length > 0 || uploads.length > 0 || busy);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => !m.removed_at && m.mentionable !== false && m.user_id !== meId && (m.full_name ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, members, meId]);

  function readMention(value: string, caret: number) {
    const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(value.slice(0, caret));
    setMention(m ? { query: m[2], start: caret - m[2].length - 1 } : null);
    setHi(0);
  }

  function pickMention(m: CommMember) {
    if (!mention || !ref.current) return;
    const name = (m.full_name ?? "someone").trim();
    const caret = ref.current.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(caret)}`;
    setText(next);
    setPicked((prev) => new Map(prev).set(`@${name}`, mentionToken(m.user_id)));
    setMention(null);
    const at = mention.start + name.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  }

  function withTokens(value: string): string {
    // Longest label first, so "@ANBU SELVAN" is not eaten by "@ANBU".
    let out = value;
    for (const [label, token] of [...picked].sort((a, b) => b[0].length - a[0].length)) {
      out = out.split(label).join(token);
    }
    return out;
  }

  function insertRecord(p: RecordPreview) {
    const label = `[${RECORD_KINDS[p.kind].short} ${p.number}]`;
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}${label} ${text.slice(caret)}`;
    setText(next);
    setPicked((prev) => new Map(prev).set(label, recordToken(p.kind, p.id)));
    setLinking(false);
    const at = caret + pad.length + label.length + 1;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  }

  const patchUpload = (key: string, next: Partial<Upload>) =>
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...next } : x)));

  async function addFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    if (uploads.length + list.length > ATTACHMENTS_PER_MESSAGE) {
      setProblem(`Attach at most ${ATTACHMENTS_PER_MESSAGE} files to one message.`);
      return;
    }
    setProblem(null);
    // Files upload side by side; each chip follows its own progress.
    await Promise.all(
      list.map(async (file) => {
        const bad = attachmentProblem(file);
        if (bad) {
          setProblem(`${file.name}: ${bad}`);
          return;
        }
        const key = crypto.randomUUID();
        const path = attachmentPath(conversationId, file.name, key);
        setUploads((u) => [...u, { key, name: file.name, size: file.size, status: "uploading", progress: 0, path }]);
        const up = await uploadWithProgress(supabase, path, file, (f) => patchUpload(key, { progress: f }));
        if (!up.ok) {
          patchUpload(key, { status: "failed", error: up.error });
          return;
        }
        // The server reads the first bytes before the file may be sent (0761).
        patchUpload(key, { status: "checking", progress: 1 });
        const v = await verifyUpload(path);
        if (!v.ok) {
          patchUpload(key, { status: "failed", error: v.error, path: undefined });
          return;
        }
        patchUpload(key, {
          status: "done",
          file: { storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size },
        });
      }),
    );
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeUpload(u: Upload) {
    setUploads((x) => x.filter((y) => y.key !== u.key));
    // An uploaded file nobody will send is deleted now, not left for the
    // nightly sweep. The server deletes only the caller's own, unattached file.
    if (u.path && u.status !== "uploading") void discardUpload(u.path);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  }

  async function submit() {
    if (busy || uploading) return;
    const body = text.trim() ? withTokens(text.trim()) : null;
    const files = uploads.filter((u) => u.status === "done" && u.file).map((u) => u.file!);
    if (!body && files.length === 0) return;
    if (body && body.length > MESSAGE_MAX) {
      setProblem(`A message can be at most ${MESSAGE_MAX.toLocaleString("en-IN")} characters.`);
      return;
    }
    setBusy(true);
    setProblem(null);
    const ok = await onSend(body, files);
    setBusy(false);
    if (ok) {
      setText("");
      setUploads([]);
      setPicked(new Map());
      ref.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && candidates.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setHi((h) => (h + (e.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(candidates[hi]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  const canSend = !busy && !uploading && (text.trim().length > 0 || uploads.some((u) => u.status === "done"));

  return (
    <div
      className={cn("relative border-t border-border bg-surface p-3", dragging && "bg-primary-soft/40 ring-2 ring-inset ring-primary")}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {dragging && (
        <p className="pointer-events-none absolute inset-x-3 top-1 text-center text-xs font-medium text-primary" aria-live="polite">
          Drop files to attach them
        </p>
      )}
      {mention && candidates.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mention someone"
          className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          {candidates.map((m, i) => (
            <li
              key={m.user_id}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(m);
              }}
              className={cn("cursor-pointer px-3 py-2 text-sm", i === hi ? "bg-primary-soft text-primary" : "text-foreground")}
            >
              @{m.full_name ?? "someone"}
            </li>
          ))}
        </ul>
      )}

      {uploads.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {uploads.map((u) => (
            <li
              key={u.key}
              className={cn(
                "flex max-w-[16rem] items-center gap-2 rounded-md border px-2 py-1 text-xs",
                u.status === "failed" ? "border-danger text-danger" : "border-border bg-surface-muted",
              )}
            >
              {u.status === "uploading" || u.status === "checking" ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block break-all">{u.name}</span>
                {u.status === "uploading" && (
                  <span
                    role="progressbar"
                    aria-label={`Uploading ${u.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(u.progress * 100)}
                    className="mt-0.5 block h-1 overflow-hidden rounded-full bg-border"
                  >
                    <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                  </span>
                )}
              </span>
              <span className="shrink-0 text-muted-foreground" aria-live="polite">
                {u.status === "failed"
                  ? u.error
                  : u.status === "uploading"
                    ? `${Math.round(u.progress * 100)}%`
                    : u.status === "checking"
                      ? "Checking…"
                      : fileSize(u.size)}
              </span>
              <button
                type="button"
                onClick={() => removeUpload(u)}
                aria-label={`Remove ${u.name}`}
                className="shrink-0 text-muted-foreground hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => void addFiles(e.target.files)}
          aria-hidden
          tabIndex={-1}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach files"
          title={`Attach files: ${ATTACHMENT_TYPES_LABEL}`}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setLinking(true)}
          aria-label="Link a record"
          title="Link a PO, indent or order"
        >
          <Link2 className="h-4 w-4" />
        </Button>
        {/* caps-input: exempt -- a chat message is prose, not a stored value (lib/comms/types.ts) */}
        <Textarea
          ref={ref}
          uppercase={false}
          rows={1}
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={MESSAGE_MAX}
          onChange={(e) => {
            setText(e.target.value);
            readMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setMention(null)}
          className="max-h-40 min-h-9 flex-1 resize-none"
        />
        <Button type="button" onClick={() => void submit()} disabled={!canSend} aria-label="Send message" title="Send (Enter)">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {problem ? (
            <span className="text-danger" role="alert">
              {problem}
            </span>
          ) : uploads.length > 0 ? (
            ATTACHMENT_TYPES_LABEL
          ) : (
            "Enter to send · Shift+Enter for a new line · @ to mention · 📎 or drop files to attach · 🔗 to link a record"
          )}
        </span>
      </div>
      <RecordPickerSheet open={linking} onClose={() => setLinking(false)} onPick={insertRecord} />
    </div>
  );
}
