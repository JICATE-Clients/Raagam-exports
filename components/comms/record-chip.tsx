"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, FileText, Lock, Package } from "lucide-react";
import { resolveRecordLinks } from "@/lib/comms/actions";
import { RECORD_KINDS, recordKey, type RecordKind, type RecordPreview } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";

/**
 * A linked ERP record inside a message (phase 6).
 *
 * ONE REQUEST FOR EVERY CHIP ON SCREEN. Chips register what they need; a
 * short timer collects them and asks `resolveRecordLinks` once, so a page of
 * forty messages linking ten POs costs one round trip, not ten (spec §12).
 * Answers are kept for the life of the page.
 *
 * The answer is the VIEWER's: a record they may not see comes back absent and
 * the chip says "not available to you" with no number and no link — the link
 * never becomes a way in (spec §8). A network failure is not cached, so the
 * chip offers Retry rather than claiming the record is off limits.
 */

type Entry = { state: "ok"; preview: RecordPreview } | { state: "none" } | { state: "error" };

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
let queue = new Map<string, { kind: RecordKind; id: string }>();
let timer: ReturnType<typeof setTimeout> | null = null;

function notifyKey(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

async function flush() {
  timer = null;
  const batch = queue;
  queue = new Map();
  const r = await resolveRecordLinks([...batch.values()]);
  for (const key of batch.keys()) {
    if (!r.ok) cache.set(key, { state: "error" });
    else cache.set(key, r.previews[key] ? { state: "ok", preview: r.previews[key] } : { state: "none" });
    notifyKey(key);
  }
}

function request(kind: RecordKind, id: string) {
  const key = recordKey(kind, id);
  if (cache.has(key) && cache.get(key)!.state !== "error") return;
  cache.delete(key);
  queue.set(key, { kind, id });
  if (!timer) timer = setTimeout(() => void flush(), 40);
}

const ICON: Record<RecordKind, typeof FileText> = {
  purchase_order: Package,
  purchase_indent: FileText,
  sales_order: ClipboardList,
};

function useRecord(kind: RecordKind, id: string): Entry | undefined {
  const key = recordKey(kind, id);
  const [entry, setEntry] = useState<Entry | undefined>(() => cache.get(key));
  useEffect(() => {
    const set = listeners.get(key) ?? new Set();
    const fn = () => setEntry(cache.get(key));
    set.add(fn);
    listeners.set(key, set);
    request(kind, id);
    return () => {
      set.delete(fn);
    };
  }, [key, kind, id]);
  return entry;
}

export function RecordChip({
  kind,
  id,
  link = true,
}: {
  kind: RecordKind;
  id: string;
  /** False where the chip already sits inside a link (Saved, Search): an <a> may not nest. */
  link?: boolean;
}) {
  const entry = useRecord(kind, id);
  const def = RECORD_KINDS[kind];
  const Icon = ICON[kind];
  const base =
    "mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 align-middle text-xs";

  if (!entry) {
    return (
      <span className={`${base} border-border bg-surface-muted text-muted-foreground`} aria-busy="true">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> {def.short}…
      </span>
    );
  }
  if (entry.state === "error") {
    if (!link) {
      return (
        <span className={`${base} border-border bg-surface-muted text-muted-foreground`}>
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> {def.short} could not load
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => request(kind, id)}
        className={`${base} border-border bg-surface-muted text-muted-foreground hover:text-foreground`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> {def.short} could not load · Retry
      </button>
    );
  }
  if (entry.state === "none") {
    return (
      <span className={`${base} border-border bg-surface-muted text-muted-foreground`}>
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden /> {def.label} not available to you
      </span>
    );
  }
  const p = entry.preview;
  const detail = [p.party, p.status ? p.status.replace(/_/g, " ") : null, p.date ? fmtDate(p.date) : null]
    .filter(Boolean)
    .join(" · ");
  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-semibold">{p.number}</span>
      {detail && <span className="break-words text-primary/80">{detail}</span>}
    </>
  );
  const title = `${def.label} ${p.number}${detail ? ` — ${detail}` : ""}`;
  return link ? (
    <Link href={p.href} className={`${base} border-primary/40 bg-primary-soft text-primary hover:border-primary`} title={title}>
      {inner}
    </Link>
  ) : (
    <span className={`${base} border-primary/40 bg-primary-soft text-primary`} title={title}>
      {inner}
    </span>
  );
}
