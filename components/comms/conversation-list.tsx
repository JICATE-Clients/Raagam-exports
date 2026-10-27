import Link from "next/link";
import { Hash, Lock, PenSquare, Users } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import type { ConversationSummary } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { initials } from "./message-body";

/**
 * Chats — the person's direct and group conversations, as the page itself
 * rather than a panel beside every hub view (user 2026-10-26). Channels are not
 * repeated here; they have their own page in the Huddle group. New lands as
 * ?new=1, which the hub frame (comms-shell.tsx) answers with its one sheet.
 */
export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  const people = conversations.filter((c) => c.kind !== "channel");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h1 className="text-sm font-semibold text-heading">Pulse</h1>
        <Link href="/comms?new=1" className={buttonClasses({ size: "sm" })}>
          <PenSquare className="h-4 w-4" aria-hidden /> New
        </Link>
      </header>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Conversations">
        {people.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No conversations yet. Start one with New.</p>
        ) : (
          <ul className="space-y-0.5">
            {people.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

/** One conversation row, with its unread and @-mention badges. */
function Row({ c }: { c: ConversationSummary }) {
  const unread = c.unread_count;
  const mentions = c.mention_count;
  const Icon = c.kind === "channel" ? (c.visibility === "private" ? Lock : Hash) : c.kind === "group" ? Users : null;
  const label = c.kind === "channel" ? c.title.replace(/^#/, "") : c.title;
  return (
    <li>
      <Link
        href={`/comms/c/${c.id}`}
        aria-label={`${label}${unread ? `, ${unread} unread` : ""}${mentions ? `, ${mentions} mentioning you` : ""}`}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted",
          c.muted && "opacity-60",
        )}
      >
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[10px] font-semibold text-muted-foreground"
          >
            {initials(c.title)}
          </span>
        )}
        <span className={cn("min-w-0 flex-1 break-words", unread > 0 ? "font-semibold text-foreground" : "text-foreground")}>
          {label}
        </span>
        {mentions > 0 && (
          <span className="shrink-0 rounded-full bg-warning-soft px-1.5 text-[11px] font-bold text-warning" aria-hidden>
            @
          </span>
        )}
        {unread > 0 && !c.muted && (
          <span className="shrink-0 rounded-full bg-danger-solid px-1.5 text-[11px] font-bold text-white tabular-nums" aria-hidden>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
    </li>
  );
}
