"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Loader2, MessageCircle } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { attachmentUrl } from "@/lib/comms/actions";
import type { PulseFile } from "@/lib/comms/files-service";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FILE_TILE } from "./conversation-list";
import { fileSize } from "./message-body";

const KIND_LABEL: Record<PulseFile["kind"], string> = {
  pdf: "PDF document",
  sheet: "Spreadsheet",
  image: "Image",
  doc: "Document",
  other: "File",
};

/**
 * One file from Pulse ▸ Files (user 2026-10-31, the Pulse mockup): a preview
 * (an image is shown; anything else its type tile), where and by whom it was
 * shared, and two ways on — Open in chat (lands AT the message, 0762's ?m=)
 * and Download (a 60-second signed link, as a message's own attachment).
 */
export function FileView({ file }: { file: PulseFile }) {
  const toast = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [tag, tint] = FILE_TILE[file.kind];

  useEffect(() => {
    if (file.kind !== "image") return;
    let live = true;
    void attachmentUrl(file.storage_path).then((r) => live && r.ok && setPreview(r.url));
    return () => {
      live = false;
    };
  }, [file.kind, file.storage_path]);

  async function download() {
    setOpening(true);
    const r = await attachmentUrl(file.storage_path);
    setOpening(false);
    if (!r.ok) return toast.error(r.error);
    const w = window.open(r.url, "_blank", "noopener,noreferrer");
    if (!w) toast.error("Allow pop-ups for this site to open files.");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Link
          href="/comms"
          className="rounded-md p-2.5 text-muted-foreground hover:bg-surface-muted group-data-[pulse]/pulse:@3xl/comms:hidden [@media(hover:hover)]:p-1.5"
          aria-label="Back to files"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span aria-hidden className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold tracking-wide", tint)}>
          {tag}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="break-all text-base font-semibold text-heading">{file.file_name}</h1>
          <p className="text-xs text-muted-foreground">
            {KIND_LABEL[file.kind]} · {fileSize(file.size_bytes)}
          </p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto bg-surface-muted/60 px-4 py-5">
        <div className="flex aspect-[4/3] w-full max-w-md items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface">
          {file.kind === "image" && preview ? (
            // A signed, private URL — next/image would need the bucket's host allow-listed and would cache it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={file.file_name} className="h-full w-full object-contain" />
          ) : file.kind === "image" ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading preview" />
          ) : (
            <span aria-hidden className={cn("flex h-24 w-24 items-center justify-center rounded-3xl text-lg font-extrabold tracking-wide", tint)}>
              {tag}
            </span>
          )}
        </div>
        <dl className="w-full max-w-md divide-y divide-border rounded-2xl border border-border bg-surface px-4 text-sm">
          {[
            ["Shared in", file.conversation_title],
            ["Shared by", file.uploaded_by_name ?? "—"],
            ["Date", fmtDateTime(file.created_at)],
            ["Type", KIND_LABEL[file.kind]],
            ["Size", fileSize(file.size_bytes)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-2.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words text-right font-semibold text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href={`/comms/c/${file.conversation_id}?m=${file.message_id}`} className={buttonClasses({ variant: "outline" })}>
            <MessageCircle className="h-4 w-4" aria-hidden /> Open in chat
          </Link>
          <Button onClick={() => void download()} disabled={opening}>
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" aria-hidden />} Download
          </Button>
        </div>
      </div>
    </div>
  );
}
