"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ArrowLeft, Hash, Loader2, Lock, MessageSquare, MessagesSquare, Paperclip, Search, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { ToggleGroup } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { openDirect } from "@/lib/comms/actions";
import { searchMore } from "@/lib/comms/search-actions";
import {
  KIND_LABEL,
  SEARCH_KINDS,
  messageHref,
  snippet,
  type SearchKind,
  type SearchSort,
} from "@/lib/comms/search";
import { plainText, type DirectoryPerson, type MessageHit } from "@/lib/comms/types";
import type { SearchOutcome } from "@/lib/comms/service";
import type { DiscoveredChannel } from "@/lib/comms/channels";
import type { WorkspacePerson } from "@/lib/comms/workspace";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { initials } from "./message-body";
import { PeoplePicker } from "./people-picker";

export type SearchState = {
  q: string;
  author: string | null;
  conversation: string | null;
  fromDay: string | null;
  toDay: string | null;
  hasFile: boolean;
  kind: SearchKind | null;
  sort: SearchSort;
};

/**
 * Huddle ▸ Search (0762). EVERY FILTER IS A URL PARAMETER read by the server:
 * changing one is a soft navigation that re-runs the search there, so the
 * browser never filters a result list of its own (which would only ever filter
 * the page it happened to have) and Back returns to exactly this search.
 *
 * Highlighting is done on PIECES of text rendered inside <mark> — never HTML —
 * so a message that contains markup shows as typed.
 */
export function SearchView({
  state,
  meId,
  searching,
  outcome,
  channels,
  people,
  foundChannels,
  authorName,
}: {
  state: SearchState;
  meId: string;
  searching: boolean;
  outcome: SearchOutcome | null;
  channels: { id: string; name: string; visibility: string }[];
  people: WorkspacePerson[];
  foundChannels: DiscoveredChannel[];
  authorName: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [q, setQ] = useState(state.q);
  const [hits, setHits] = useState<MessageHit[]>(outcome?.hits ?? []);
  const [next, setNext] = useState<string | null>(outcome?.next ?? null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pickingSender, setPickingSender] = useState(false);
  const [pending, start] = useTransition();

  function go(next: Partial<SearchState>) {
    const s = { ...state, q, ...next };
    const p = new URLSearchParams();
    if (s.q.trim()) p.set("q", s.q.trim());
    if (s.author) p.set("from", s.author);
    if (s.conversation) p.set("in", s.conversation);
    if (s.fromDay) p.set("after", s.fromDay);
    if (s.toDay) p.set("before", s.toDay);
    if (s.hasFile) p.set("file", "1");
    if (s.kind) p.set("kind", s.kind);
    if (s.sort !== "relevance") p.set("sort", s.sort);
    const qs = p.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    go({ q });
  }

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    setMoreError(null);
    const r = await searchMore({ ...state, cursor: next });
    setLoadingMore(false);
    if (!r.ok) {
      setMoreError(r.error);
      return;
    }
    // Keyset paging cannot repeat a row; the id check is a belt to that brace.
    setHits((prev) => {
      const seen = new Set(prev.map((h) => h.message.id));
      return [...prev, ...r.hits.filter((h) => !seen.has(h.message.id))];
    });
    setNext(r.next);
  }

  async function message(personId: string) {
    const r = await openDirect(personId);
    if (!r.ok) toast.error(r.error);
    else router.push(`/comms/c/${r.id}`);
  }

  const channelName = channels.find((c) => c.id === state.conversation)?.name ?? outcome?.resolved.conversation?.name;
  const chips: { label: string; clear: Partial<SearchState> }[] = [
    ...(state.author ? [{ label: `From: ${authorName ?? "selected person"}`, clear: { author: null } }] : []),
    ...(state.conversation ? [{ label: `In: #${channelName ?? "channel"}`, clear: { conversation: null } }] : []),
    ...(state.fromDay ? [{ label: `From ${fmtDate(state.fromDay)}`, clear: { fromDay: null } }] : []),
    ...(state.toDay ? [{ label: `To ${fmtDate(state.toDay)}`, clear: { toDay: null } }] : []),
    ...(state.hasFile ? [{ label: "Has a file", clear: { hasFile: false } }] : []),
    ...(state.kind ? [{ label: KIND_LABEL[state.kind], clear: { kind: null } }] : []),
  ];
  const names = new Map(hits.map((h) => [h.message.author_id ?? "", h.message.author_name] as const));
  const terms = outcome?.terms ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link href="/comms" className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">Search</h1>
      </header>

      <div className="space-y-2 border-b border-border p-2">
        <form onSubmit={submit} className="flex gap-2" role="search">
          {/* caps-input: exempt -- a search box; the query is not a stored value */}
          <Input
            type="search"
            uppercase={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Search messages, people and channels — try budget from:"Anbu" in:cutting-room has:file'
            aria-label="Search messages, people and channels"
            maxLength={200}
            autoFocus
            className="flex-1"
          />
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
          </Button>
        </form>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Sender">
            <Button type="button" variant="outline" onClick={() => setPickingSender(true)} className="max-w-[12rem]">
              <User className="h-4 w-4" /> <span className="break-all">{state.author ? authorName ?? "Selected" : "Anyone"}</span>
            </Button>
          </Field>
          <Field label="Channel">
            <Select value={state.conversation ?? ""} onChange={(e) => go({ conversation: e.target.value || null })} className="w-44">
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
            <Select value={state.kind ?? ""} onChange={(e) => go({ kind: (e.target.value || null) as SearchKind | null })} className="w-40">
              <option value="">Everything</option>
              {SEARCH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={state.fromDay ?? ""} max={state.toDay ?? undefined} onChange={(e) => go({ fromDay: e.target.value || null })} className="w-40" />
          </Field>
          <Field label="To">
            <Input type="date" value={state.toDay ?? ""} min={state.fromDay ?? undefined} onChange={(e) => go({ toDay: e.target.value || null })} className="w-40" />
          </Field>
          <Field label="Files">
            <Toggle label="Has a file" checked={state.hasFile} onChange={(v) => go({ hasFile: v })} />
          </Field>
          <Field label="Sort">
            <ToggleGroup
              label="Sort results"
              value={state.sort}
              onChange={(v) => go({ sort: v })}
              options={[
                { value: "relevance", label: "Relevance" },
                { value: "newest", label: "Newest" },
              ]}
            />
          </Field>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {chips.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
                {c.label}
                <button type="button" onClick={() => go(c.clear)} aria-label={`Remove filter ${c.label}`} className="rounded-full hover:bg-primary/10">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => go({ author: null, conversation: null, fromDay: null, toDay: null, hasFile: false, kind: null })}
              className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={pending}>
        {outcome?.problems.length ? (
          <ul className="space-y-1 p-3" role="alert">
            {outcome.problems.map((p) => (
              <li key={p} className="text-sm text-danger">
                {p}
              </li>
            ))}
          </ul>
        ) : null}

        {!searching ? (
          <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
            <p>Search every message you can read, and find people and channels.</p>
            <p className="text-xs">
              Narrow it with <code>from:name</code> · <code>in:channel</code> · <code>after:2026-01-01</code> · <code>before:2026-12-31</code> ·{" "}
              <code>on:2026-03-15</code> · <code>has:file</code> · <code>is:thread</code>
            </p>
          </div>
        ) : (
          <>
            {(people.length > 0 || foundChannels.length > 0) && (
              <div className="grid gap-3 border-b border-border p-3 @3xl/comms:grid-cols-2">
                {people.length > 0 && (
                  <section aria-label="People">
                    <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">People</h2>
                    <ul className="space-y-1">
                      {people.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 text-sm">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-muted-foreground">
                            {initials(p.full_name)}
                          </span>
                          <Link href={`/comms/people?q=${encodeURIComponent(p.full_name ?? "")}`} className="min-w-0 flex-1 break-words hover:underline">
                            <span className="font-medium text-foreground">{p.full_name}</span>
                            <span className="block text-xs text-muted-foreground">{[p.designation, p.department].filter(Boolean).join(" · ")}</span>
                          </Link>
                          {p.id !== meId && (
                            <button
                              type="button"
                              onClick={() => void message(p.id)}
                              aria-label={`Message ${p.full_name}`}
                              title="Message"
                              className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {foundChannels.length > 0 && (
                  <section aria-label="Channels">
                    <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channels</h2>
                    <ul className="space-y-1">
                      {foundChannels.map((c) => (
                        <li key={c.id}>
                          <Link href={`/comms/c/${c.id}`} className="flex items-start gap-2 text-sm hover:underline">
                            {c.visibility === "private" ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <Hash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                            <span className="min-w-0">
                              <span className="font-medium text-foreground">{c.name}</span>
                              <span className="block break-words text-xs text-muted-foreground">
                                {[c.description || c.topic, `${c.member_count} members`, c.is_member ? "joined" : null].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            <section aria-label="Messages">
              <h2 className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Messages{state.sort === "newest" || terms.length === 0 ? " · newest first" : " · best match first"}
              </h2>
              {hits.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {outcome?.problems.length ? "Fix the search above to see results." : "No messages match. Try fewer words or remove a filter."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {hits.map((h) => (
                    <SearchResult key={h.message.id} hit={h} names={names} terms={terms} />
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
                  <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {moreError ? "Retry" : "Load more"}
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <SenderSheet
        open={pickingSender}
        onClose={() => setPickingSender(false)}
        onPick={(p) => {
          setPickingSender(false);
          go({ author: p.id });
        }}
      />
    </div>
  );
}

function SearchResult({ hit: h, names, terms }: { hit: MessageHit; names: Map<string, string | null>; terms: string[] }) {
  const m = h.message;
  const plain = plainText(m.body, names);
  const pieces = plain ? snippet(plain, terms) : [];
  const context =
    h.conversation_kind === "channel" ? h.conversation_title : h.conversation_kind === "direct" ? `DM · ${h.conversation_title}` : h.conversation_title;
  return (
    <li>
      <Link
        href={messageHref(m)}
        className="flex gap-3 px-3 py-2.5 hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary" aria-hidden>
          {initials(m.author_name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{m.author_name ?? "Former user"}</span>
            <span className="font-medium text-primary">{context}</span>
            {m.parent_id && (
              <span className="inline-flex items-center gap-0.5">
                <MessagesSquare className="h-3 w-3" aria-hidden /> thread reply
              </span>
            )}
            <time dateTime={m.created_at}>{fmtDateTime(m.created_at)}</time>
          </span>
          {pieces.length > 0 && (
            <span className="mt-0.5 block whitespace-pre-wrap break-words text-sm text-foreground">
              {pieces.map((p, i) =>
                p.hit ? (
                  <mark key={i} className="rounded bg-warning-soft px-0.5 text-foreground">
                    {p.text}
                  </mark>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
            </span>
          )}
          {m.attachments.length > 0 && (
            <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Paperclip className="h-3 w-3" aria-label="Attachments" />
              {m.attachments.map((a) => (
                <span key={a.id} className="break-all">
                  {a.file_name}
                </span>
              ))}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** Sender filter: the existing people picker, one person. */
function SenderSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: DirectoryPerson) => void }) {
  const [picked, setPicked] = useState<DirectoryPerson[]>([]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Messages from"
      size="sm"
      alignToPane
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked.length === 0} onClick={() => picked[0] && onPick(picked[0])}>
            Filter
          </Button>
        </div>
      }
    >
      <div className="h-72">
        <PeoplePicker selected={picked} onChange={setPicked} single autoFocus />
      </div>
    </Sheet>
  );
}
