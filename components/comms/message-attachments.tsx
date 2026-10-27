"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { attachmentDownloadUrl, attachmentLinks, type AttachmentLink } from "@/lib/comms/attachment-actions";
import { fileKind, isImageMime, isOpenableMime } from "@/lib/comms/attachments";
import type { CommAttachment } from "@/lib/comms/types";
import { fileSize } from "./message-body";

// ---------------------------------------------------------------------------
// Links, fetched in batches and only for images that scroll into view
// ---------------------------------------------------------------------------

/**
 * A short-lived signed link per image (10 min), requested ONLY when the image
 * nears the screen, and in one call for every image that did so within 40 ms.
 * Kept for 8 minutes, so scrolling back does not ask again. A conversation of
 * 500 photos therefore loads the few on screen — never all of them.
 */
type Cached = { link: AttachmentLink; at: number };
const cache = new Map<string, Cached>();
const waiting = new Map<string, ((l: AttachmentLink | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
const TTL = 8 * 60 * 1000;

function linkFor(path: string): Promise<AttachmentLink | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.link);
  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        const batch = new Map(waiting);
        waiting.clear();
        void attachmentLinks(Array.from(batch.keys())).then((r) => {
          const got = new Map(r.ok ? r.links.map((l) => [l.path, l] as const) : []);
          for (const [p, fns] of batch) {
            const l = got.get(p) ?? null;
            if (l?.url) cache.set(p, { link: l, at: Date.now() });
            for (const fn of fns) fn(l);
          }
        });
      }, 40);
    }
  });
}

// ---------------------------------------------------------------------------

/**
 * A message's attachments (0737, shown properly since 0761): images as
 * thumbnails, everything else as a file card. Every link is signed for the
 * VIEWER by storage's read policy — a file in a conversation they cannot read
 * yields no link, whatever this component asks for.
 */
export function MessageAttachments({
  attachments,
  onOpenFile,
}: {
  attachments: CommAttachment[];
  onOpenFile: (a: CommAttachment) => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<CommAttachment | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const images = attachments.filter((a) => isImageMime(a.mime_type));
  const files = attachments.filter((a) => !isImageMime(a.mime_type));

  async function download(a: CommAttachment) {
    setDownloading(a.id);
    const r = await attachmentDownloadUrl(a.storage_path, a.file_name);
    setDownloading(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    // A same-tab navigation to an attachment-disposition link downloads
    // without leaving the conversation.
    window.location.assign(r.url);
  }

  return (
    <div className="mt-1 space-y-2">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Images">
          {images.map((a) => (
            <li key={a.id}>
              <Thumb attachment={a} onOpen={() => setPreview(a)} />
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Files">
          {files.map((a) => (
            <li
              key={a.id}
              className="flex w-full max-w-[22rem] items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-xs"
            >
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block break-all font-medium text-foreground">{a.file_name}</span>
                <span className="block text-muted-foreground">
                  {fileKind(a.mime_type, a.file_name)} · {fileSize(a.size_bytes)}
                </span>
              </span>
              {isOpenableMime(a.mime_type) && (
                <button
                  type="button"
                  onClick={() => onOpenFile(a)}
                  aria-label={`Open ${a.file_name}`}
                  title="Open in a new tab"
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void download(a)}
                disabled={downloading === a.id}
                aria-label={`Download ${a.file_name}`}
                title="Download"
                className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {downloading === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.file_name ?? "Image"}
        size="md"
        alignToPane
        footer={
          preview ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setPreview(null)}>
                Close
              </Button>
              <Button onClick={() => void download(preview)} disabled={downloading === preview.id}>
                <Download className="h-4 w-4" /> Download
              </Button>
            </div>
          ) : null
        }
      >
        {preview && <FullImage attachment={preview} />}
      </Sheet>
    </div>
  );
}

/** A thumbnail: nothing is requested until it is near the screen. */
function Thumb({ attachment: a, onOpen }: { attachment: CommAttachment; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [link, setLink] = useState<AttachmentLink | null>(null);
  const [state, setState] = useState<"idle" | "thumb" | "full" | "failed">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void linkFor(a.storage_path).then((l) => {
          if (!live) return;
          setLink(l);
          setState(l?.thumb ? "thumb" : l?.url ? "full" : "failed");
        });
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [a.storage_path]);

  const src = state === "thumb" ? link?.thumb : state === "full" ? link?.url : null;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={`Preview ${a.file_name}, ${fileSize(a.size_bytes)}`}
      title={a.file_name}
      className="flex h-40 w-56 max-w-full items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage link; next/image would proxy and cache a private file
        <img
          src={src}
          alt={a.file_name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
          // No thumbnail service on this project → the original; the original
          // failing too → the fallback below. Never a broken-image icon.
          onError={() => setState((s) => (s === "thumb" && link?.url ? "full" : "failed"))}
        />
      ) : state === "failed" ? (
        <span className="flex flex-col items-center gap-1 px-2 text-center text-xs text-muted-foreground">
          <ImageOff className="h-5 w-5" aria-hidden />
          <span className="break-all">{a.file_name}</span>
        </span>
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}

/** The original, scaled to fit, aspect ratio kept. */
function FullImage({ attachment: a }: { attachment: CommAttachment }) {
  const [link, setLink] = useState<AttachmentLink | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void linkFor(a.storage_path).then((l) => live && setLink(l));
    return () => {
      live = false;
    };
  }, [a.storage_path]);

  if (link === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the image…
      </p>
    );
  }
  if (!link?.url || failed) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="alert">
        <ImageOff className="h-4 w-4" /> The image could not be shown. Download it instead.
      </p>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage link (see Thumb)
    <img src={link.url} alt={a.file_name} className="mx-auto max-h-[70vh] w-auto max-w-full object-contain" onError={() => setFailed(true)} />
  );
}
