"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { ArrowLeft, BookmarkX } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { setSaved } from "@/lib/comms/actions";
import type { MessageHit } from "@/lib/comms/types";
import { fmtDateTime } from "@/lib/format";
import { MessageBody } from "./message-body";

/**
 * A list of messages from many conversations — Saved and Search. Each links to
 * its conversation; the conversation re-checks access when it opens (a link
 * grants nothing).
 *
 * Mentions render from a names map built off the hits themselves (authors), so
 * a mention of someone who is not an author here reads "@someone" rather than
 * costing another round trip per row.
 */
export function MessageHitList({
  title,
  hits,
  empty,
  savedList = false,
  meId,
  toolbar,
}: {
  title: string;
  hits: MessageHit[];
  empty: string;
  savedList?: boolean;
  meId: string;
  toolbar?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  const names = new Map(hits.map((h) => [h.message.author_id ?? "", h.message.author_name] as const));

  function unsave(id: string) {
    start(async () => {
      const r = await setSaved(id, false);
      if (!r.ok) toast.error(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link href="/comms" className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">{title}</h1>
      </header>
      {toolbar}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hits.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {hits.map(({ message: m, conversation_title }) => (
              <li key={m.id} className="flex gap-3 px-4 py-3">
                <Link href={`/comms/c/${m.conversation_id}`} className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-primary">{conversation_title}</span>
                    <span>{m.author_name ?? "—"}</span>
                    <time dateTime={m.created_at}>{fmtDateTime(m.created_at)}</time>
                  </span>
                  {m.deleted_at ? (
                    <p className="text-sm italic text-muted-foreground">This message was deleted.</p>
                  ) : (
                    // truncate-reveal: exempt -- a preview row; the whole message is one click away in its conversation
                    <MessageBody body={m.body ?? (m.attachments.length ? `📎 ${m.attachments.map((a) => a.file_name).join(", ")}` : "")} names={names} meId={meId} className="line-clamp-3" />
                  )}
                </Link>
                {savedList && (
                  <button
                    type="button"
                    onClick={() => unsave(m.id)}
                    aria-label="Remove from saved"
                    title="Remove from saved"
                    className="self-start rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-danger"
                  >
                    <BookmarkX className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
