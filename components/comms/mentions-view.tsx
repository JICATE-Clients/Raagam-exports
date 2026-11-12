"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, AtSign, CheckCheck, Loader2, MessagesSquare, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { loadMentions, markMentionsRead } from "@/lib/comms/actions";
import { messageHref } from "@/lib/comms/search";
import type { MentionItem } from "@/lib/comms/service";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MessageBody } from "./message-body";
import { Face } from "./person-photo";

/**
 * Pulse ▸ Mentions (user 2026-11-06, option A of the "fixing the Mentions
 * shortcut" artifact). Each row is the message itself — who, which chat, when —
 * and opens that chat AT the message (a thread reply opens in its thread),
 * through the same `messageHref` a search hit and a saved message use.
 *
 * Unread / All is a URL parameter the SERVER applies; Unread is the set the
 * shortcut's badge counts (newer than your read point in that chat). Opening a
 * mention moves nothing by itself — the chat marks itself read when opened, as
 * it always has — and Mark all as read moves the read point of every chat on
 * the Unread list.
 */
export function MentionsView({
  unreadOnly,
  initial,
  initialNext,
  meId,
}: {
  unreadOnly: boolean;
  initial: MentionItem[];
  initialNext: string | null;
  meId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const unreadChats = Array.from(new Set(items.filter((x) => x.unread).map((x) => x.hit.message.conversation_id)));
  const names = new Map(items.map((x) => [x.hit.message.author_id ?? "", x.hit.message.author_name] as const));

  function show(v: "unread" | "all") {
    start(() => router.push(v === "all" ? `${pathname}?show=all` : pathname));
  }

  async function more() {
    if (!next) return;
    setLoading(true);
    setMoreError(null);
    const r = await loadMentions({ cursor: next });
    setLoading(false);
    if (!r.ok) {
      setMoreError(r.error);
      return;
    }
    setItems((prev) => {
      const seen = new Set(prev.map((x) => x.hit.message.id));
      return [...prev, ...r.items.filter((x) => !seen.has(x.hit.message.id))];
    });
    setNext(r.next);
  }

  function markAll() {
    if (unreadChats.length === 0 || pending) return;
    start(async () => {
      const r = await markMentionsRead(unreadChats);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setItems((prev) => (unreadOnly ? [] : prev.map((x) => ({ ...x, unread: false }))));
      toast.success("All mentions marked as read.");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Link href="/comms" className="rounded-md p-2.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden [@media(hover:hover)]:p-1.5" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">Mentions</h1>
        <ToggleGroup
          label="Show"
          value={unreadOnly ? "unread" : "all"}
          onChange={show}
          options={[
            { value: "unread", label: "Unread" },
            { value: "all", label: "All" },
          ]}
        />
        {unreadChats.length > 0 && (
          <Button variant="outline" onClick={markAll} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />} Mark all as read
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={pending}>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <AtSign className="h-6 w-6" aria-hidden />
            {unreadOnly ? (
              <>
                <p className="font-semibold text-foreground">You&apos;re all caught up</p>
                <p>No unread mentions. Choose All to see earlier ones.</p>
              </>
            ) : (
              <p>Nobody has mentioned you yet. When someone types @ and your name in a chat, it shows up here.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map(({ hit, unread }) => (
              <li key={hit.message.id} className={cn(unread && "bg-primary-soft/40")}>
                <Link
                  href={messageHref(hit.message)}
                  className="flex min-w-0 gap-3 px-3 py-2.5 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`${unread ? "Unread. " : ""}${hit.message.author_name ?? "Former user"} in ${hit.conversation_title}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-xs font-semibold text-primary" aria-hidden>
                    <Face userId={hit.message.author_id} name={hit.message.author_name} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                      <span className={cn("text-foreground", unread ? "font-bold" : "font-semibold")}>{hit.message.author_name ?? "Former user"}</span>
                      <span className="font-medium text-primary">
                        {hit.conversation_kind === "direct" ? `DM · ${hit.conversation_title}` : hit.conversation_title}
                      </span>
                      {hit.message.parent_id && (
                        <span className="inline-flex items-center gap-0.5">
                          <MessagesSquare className="h-3 w-3" aria-hidden /> thread reply
                        </span>
                      )}
                      <time dateTime={hit.message.created_at}>{fmtDateTime(hit.message.created_at)}</time>
                    </span>
                    {/* truncate-reveal: exempt -- a preview row; the whole message is one click away in its conversation */}
                    <MessageBody body={hit.message.body} names={names} meId={meId} className="line-clamp-3" recordLinks={false} />
                    {hit.message.attachments.length > 0 && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3" aria-label="Attachments" />
                        {hit.message.attachments.map((a) => (
                          <span key={a.id} className="break-all">
                            {a.file_name}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {unread && <span aria-hidden className="mt-3 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </Link>
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
