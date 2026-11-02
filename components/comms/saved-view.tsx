"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ArrowLeft, Bookmark, BookmarkX, Loader2, MessagesSquare, Paperclip, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { loadSaved, setSaved } from "@/lib/comms/actions";
import { KIND_LABEL, SEARCH_KINDS, messageHref, type SearchKind } from "@/lib/comms/search";
import type { SavedItem } from "@/lib/comms/service";
import { fmtDateTime } from "@/lib/format";
import { MessageBody, initials } from "./message-body";

export type SavedFilters = { q: string; conversation: string | null; kind: SearchKind | null; hasFile: boolean };

/**
 * Huddle ▸ Saved (0763). The caller's own bookmarks, newest save first, a page
 * at a time. Filters are URL parameters the SERVER applies (comm_my_saved),
 * so they work across every saved item, not only the page in hand.
 *
 * A message the person can no longer read stays on the list as "no longer
 * available" with a Remove — the database says nothing else about it — and a
 * deleted one shows the deleted line, as everywhere else (0737's policy).
 */
export function SavedView({
  filters,
  initial,
  initialNext,
  channels,
  meId,
}: {
  filters: SavedFilters;
  initial: SavedItem[];
  initialNext: string | null;
  channels: { id: string; name: string; visibility: string }[];
  meId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [q, setQ] = useState(filters.q);
  const [items, setItems] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const filtered = !!(filters.q || filters.conversation || filters.kind || filters.hasFile);

  function go(next: Partial<SavedFilters>) {
    const f = { ...filters, q, ...next };
    const p = new URLSearchParams();
    if (f.q.trim()) p.set("q", f.q.trim());
    if (f.conversation) p.set("in", f.conversation);
    if (f.kind) p.set("kind", f.kind);
    if (f.hasFile) p.set("file", "1");
    const qs = p.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    go({ q });
  }

  async function more() {
    if (!next) return;
    setLoading(true);
    setMoreError(null);
    const r = await loadSaved({ ...filters, cursor: next });
    setLoading(false);
    if (!r.ok) {
      setMoreError(r.error);
      return;
    }
    setItems((prev) => {
      const seen = new Set(prev.map((x) => x.message_id));
      return [...prev, ...r.items.filter((x) => !seen.has(x.message_id))];
    });
    setNext(r.next);
  }

  async function remove(id: string) {
    // One request per item: a second click while the first is in flight does nothing.
    if (removing.has(id)) return;
    setRemoving((s) => new Set(s).add(id));
    const r = await setSaved(id, false);
    setRemoving((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setItems((prev) => prev.filter((x) => x.message_id !== id));
    toast.success("Removed from saved.");
  }

  const names = new Map(items.flatMap((x) => (x.hit ? [[x.hit.message.author_id ?? "", x.hit.message.author_name] as const] : [])));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link href="/comms" className="rounded-md p-2.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden [@media(hover:hover)]:p-1.5" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">Saved messages</h1>
      </header>

      <div className="space-y-2 border-b border-border p-2">
        <form onSubmit={submit} className="flex gap-2" role="search">
          {/* caps-input: exempt -- a search box; the query is not a stored value */}
          <Input
            type="search"
            uppercase={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your saved messages"
            aria-label="Search your saved messages"
            maxLength={200}
            className="flex-1"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find
          </Button>
        </form>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Channel">
            <Select value={filters.conversation ?? ""} onChange={(e) => go({ conversation: e.target.value || null })} className="w-44">
              <option value="">Any conversation</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.visibility === "private" ? "🔒 " : "#"}
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={filters.kind ?? ""} onChange={(e) => go({ kind: (e.target.value || null) as SearchKind | null })} className="w-40">
              <option value="">Everything</option>
              {SEARCH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Files">
            <Toggle label="Has a file" checked={filters.hasFile} onChange={(v) => go({ hasFile: v })} />
          </Field>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                go({ q: "", conversation: null, kind: null, hasFile: false });
              }}
              className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden /> Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={pending}>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <Bookmark className="h-6 w-6" aria-hidden />
            {filtered ? (
              <p>No saved messages match these filters.</p>
            ) : (
              <p>Nothing saved yet. Use the bookmark on any message — in a chat, a channel or a thread — to keep it here.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.message_id} className="flex gap-3 px-3 py-2.5">
                {it.hit ? (
                  <Link href={messageHref(it.hit.message)} className="flex min-w-0 flex-1 gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary" aria-hidden>
                      {initials(it.hit.message.author_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{it.hit.message.author_name ?? "Former user"}</span>
                        <span className="font-medium text-primary">
                          {it.hit.conversation_kind === "direct" ? `DM · ${it.hit.conversation_title}` : it.hit.conversation_title}
                        </span>
                        {it.hit.message.parent_id && (
                          <span className="inline-flex items-center gap-0.5">
                            <MessagesSquare className="h-3 w-3" aria-hidden /> thread reply
                          </span>
                        )}
                        <time dateTime={it.hit.message.created_at}>{fmtDateTime(it.hit.message.created_at)}</time>
                      </span>
                      {it.hit.message.deleted_at ? (
                        <span className="block text-sm italic text-muted-foreground">This message was deleted.</span>
                      ) : (
                        // truncate-reveal: exempt -- a preview row; the whole message is one click away in its conversation
                        <MessageBody body={it.hit.message.body} names={names} meId={meId} className="line-clamp-3" recordLinks={false} />
                      )}
                      {!it.hit.message.deleted_at && it.hit.message.attachments.length > 0 && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          <Paperclip className="h-3 w-3" aria-label="Attachments" />
                          {it.hit.message.attachments.map((a) => (
                            <span key={a.id} className="break-all">
                              {a.file_name}
                            </span>
                          ))}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">Saved {fmtDateTime(it.saved_at)}</span>
                    </span>
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                    <p className="italic">This message is no longer available to you.</p>
                    <p className="text-[11px]">Saved {fmtDateTime(it.saved_at)}</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void remove(it.message_id)}
                  disabled={removing.has(it.message_id)}
                  aria-label="Remove from saved"
                  title="Remove from saved"
                  className="self-start rounded-md p-2.5 text-muted-foreground hover:bg-surface-muted hover:text-danger [@media(hover:hover)]:p-1.5"
                >
                  {removing.has(it.message_id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkX className="h-4 w-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {next && (
          <div className="flex flex-col items-center gap-1 p-3">
            {moreError && (
              <p className="text-xs text-danger" role="alert">
                {moreError}
              </p>
            )}
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void more()}>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {moreError ? "Retry" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
