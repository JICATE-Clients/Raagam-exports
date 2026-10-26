"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Bell, Bookmark, CheckCheck, Hash, Lock, MessagesSquare, PenSquare, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppUser } from "@/lib/auth/permission-context";
import { useCreateIntent } from "@/lib/use-create-intent";
import { createClient } from "@/lib/supabase/client";
import type { ConversationSummary } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { initials } from "./message-body";
import { NewConversationSheet } from "./new-conversation-sheet";

/**
 * The Communication Hub frame: conversation list on the left, the open view on
 * the right. On a narrow pane (container query, not the viewport — the
 * sidebar's width is not the operator's content) it is one or the other: the
 * list at /comms, the view everywhere else with a back arrow.
 *
 * `data-focus-scope="off"`: this is a chat surface, not a form. The global
 * Enter-advances / arrows-move contract stays out of it, so the message box can
 * own Enter (see composer.tsx).
 *
 * ## THE LIST STAYS CURRENT WITHOUT A SUBSCRIPTION PER CONVERSATION
 *
 * One Realtime listener on `comm_messages` INSERT, unfiltered — Supabase
 * applies the table's SELECT policy per subscriber, so it delivers only rows
 * this person may read — and a debounced `router.refresh()` re-reads the list
 * (unread counts come from the database, never counted in the browser). A tab
 * returning to view or the network coming back refreshes too, which is what
 * covers an event missed while disconnected.
 */
export function CommsShell({
  conversations,
  approvalsWaiting = null,
  children,
}: {
  conversations: ConversationSummary[];
  /** The approval engine's own queue count; null when unknown (badge off). */
  approvalsWaiting?: number | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAppUser();
  const instance = useId().replace(/[^A-Za-z0-9]/g, "");
  const [filter, setFilter] = useState("");
  const [composing, setComposing] = useState(false);
  // The mobile ＋ (SECTION_ACTIONS "/comms") lands as ?new=1 on any hub route.
  useCreateIntent(() => setComposing(true));

  const activeId = /^\/comms\/c\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const onList = pathname === "/comms";

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dropped = false;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    };
    const channel = supabase
      .channel(`comms-list:${user.id}:${instance}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comm_messages" }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (dropped) refresh(); // back after a drop: catch up on what was missed
          dropped = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          dropped = true;
        }
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router, user.id, instance]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  }, [conversations, filter]);
  const channels = shown.filter((c) => c.kind === "channel");
  const people = shown.filter((c) => c.kind !== "channel");

  return (
    <div
      data-focus-scope="off"
      className="@container/comms flex min-h-[30rem] flex-1 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <aside
        className={cn(
          "min-h-0 w-full flex-col border-border @3xl/comms:flex @3xl/comms:w-72 @3xl/comms:shrink-0 @3xl/comms:border-r",
          onList ? "flex" : "hidden",
        )}
        aria-label="Conversations"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h1 className="text-sm font-semibold text-heading">Messages</h1>
          <Button size="sm" onClick={() => setComposing(true)}>
            <PenSquare className="h-4 w-4" /> New
          </Button>
        </div>
        <div className="border-b border-border p-2">
          {/* caps-input: exempt -- a filter box; the query is not a stored value */}
          <Input
            type="search"
            uppercase={false}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a conversation"
            aria-label="Find a conversation"
          />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Conversation list">
          {/* COLLABORATION — the same caption and order the sidebar draws (components/shell/nav.ts). */}
          <div className="mb-3">
            <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Collaboration</h2>
            <ul className="space-y-0.5">
              <ShellLink href="/comms" icon={MessagesSquare} label="Messages" active={pathname === "/comms"} />
              <ShellLink href="/comms/channels" icon={Hash} label="Channels" active={pathname === "/comms/channels"} />
              <ShellLink href="/comms/search" icon={Search} label="Search" active={pathname.startsWith("/comms/search")} />
              <ShellLink href="/comms/saved" icon={Bookmark} label="Saved" active={pathname === "/comms/saved"} />
              <ShellLink href="/comms/notifications" icon={Bell} label="Notifications" active={pathname === "/comms/notifications"} />
              <ShellLink
                href="/comms/approvals"
                icon={CheckCheck}
                label="My Approvals"
                active={pathname === "/comms/approvals"}
                count={approvalsWaiting}
              />
            </ul>
          </div>

          <Section title="Channels" empty={filter ? "No channels match." : "You are not in any channel yet."}>
            {channels.map((c) => (
              <Row key={c.id} c={c} active={c.id === activeId} />
            ))}
          </Section>
          <Section
            title="Direct messages"
            empty={filter ? "No conversations match." : "No conversations yet. Start one with New."}
          >
            {people.map((c) => (
              <Row key={c.id} c={c} active={c.id === activeId} />
            ))}
          </Section>
        </nav>
      </aside>

      <section className={cn("min-h-0 min-w-0 flex-1 flex-col @3xl/comms:flex", onList ? "hidden" : "flex")}>
        {children}
      </section>

      <NewConversationSheet open={composing} meId={user.id} onClose={() => setComposing(false)} />
    </div>
  );
}

function ShellLink({
  href,
  icon: Icon,
  label,
  active,
  count = null,
}: {
  href: string;
  icon: typeof Hash;
  label: string;
  active: boolean;
  /** A waiting count shown as a badge; 0 or null shows none. */
  count?: number | null;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          active ? "bg-primary-soft font-semibold text-primary" : "text-foreground hover:bg-surface-muted",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0 flex-1">{label}</span>
        {!!count && count > 0 && (
          <span
            className="shrink-0 rounded-full bg-danger-solid px-1.5 text-[11px] font-bold text-white tabular-nums"
            aria-label={`${count} waiting`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </li>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <div className="mb-3">
      <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-0.5">{children}</ul>
      )}
    </div>
  );
}

/**
 * One conversation row. The OPEN conversation never shows a badge: its view
 * marks it read as messages arrive, and the list's refresh can land a moment
 * before that write — a badge flickering on the conversation you are reading
 * is noise.
 */
function Row({ c, active }: { c: ConversationSummary; active: boolean }) {
  const unread = active ? 0 : c.unread_count;
  const mentions = active ? 0 : c.mention_count;
  const Icon = c.kind === "channel" ? (c.visibility === "private" ? Lock : Hash) : c.kind === "group" ? Users : null;
  const label = c.kind === "channel" ? c.title.replace(/^#/, "") : c.title;
  return (
    <li>
      <Link
        href={`/comms/c/${c.id}`}
        aria-current={active ? "page" : undefined}
        aria-label={`${label}${unread ? `, ${unread} unread` : ""}${mentions ? `, ${mentions} mentioning you` : ""}`}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          active ? "bg-primary-soft text-primary" : "hover:bg-surface-muted",
          c.muted && !active && "opacity-60",
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
