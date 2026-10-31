"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useAppUser } from "@/lib/auth/permission-context";
import { useCreateIntent } from "@/lib/use-create-intent";
import { createClient } from "@/lib/supabase/client";
import type { ConversationSummary } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { ConversationList } from "./conversation-list";
import { NewConversationSheet } from "./new-conversation-sheet";

/**
 * ## PULSE IS TWO PANES (user 2026-10-29, "apply this design … in the same way")
 *
 * On Pulse — /comms and any conversation the person is in (direct, group or
 * channel) — the dark Pulse sidebar (conversation-list.tsx) stands beside the
 * open conversation once the hub is wide enough (`@3xl/comms`, 768px), the
 * Slack-style screen the user chose (2026-10-29). This brings back the list
 * panel 2026-10-26 removed, for Pulse only; the Channels browser, Search,
 * Saved and the rest keep the single full-width view described below. Narrower than that it
 * is one pane at a time: /comms shows the list, a chat shows the chat (with
 * its back arrow). The list's data is the layout's own listMyConversations()
 * read, so a realtime refresh updates both panes at once.
 *
 * The Communication Hub frame: the open view, full width. There is no list
 * panel beside it (user 2026-10-26, "remove this") — the sidebar's Huddle group
 * is the hub's navigation, Chats (/comms) lists the person's conversations and
 * Channels lists channels.
 *
 * `data-focus-scope="off"`: this is a chat surface, not a form. The global
 * Enter-advances / arrows-move contract stays out of it, so the message box can
 * own Enter (see composer.tsx).
 *
 * ## THE LISTS STAY CURRENT WITHOUT A SUBSCRIPTION PER CONVERSATION
 *
 * One Realtime listener on `comm_messages` INSERT, unfiltered — Supabase
 * applies the table's SELECT policy per subscriber, so it delivers only rows
 * this person may read — and a debounced `router.refresh()` re-reads the list
 * (unread counts come from the database, never counted in the browser). A tab
 * returning to view or the network coming back refreshes too, which is what
 * covers an event missed while disconnected.
 *
 * `top` is the workspace bar (0750), drawn by the server layout above every view.
 */
/** One Pulse pane: a white card with a soft shadow once the hub is wide. */
const PANE =
  "min-h-0 min-w-0 flex-col overflow-hidden @3xl/comms:rounded-[22px] @3xl/comms:shadow-[0_1px_2px_rgba(26,34,51,.05),0_8px_24px_rgba(26,34,51,.06)]";

export function CommsShell({
  children,
  top,
  chats,
}: {
  children: ReactNode;
  top?: ReactNode;
  /** The caller's conversations, for Pulse's list pane. */
  chats?: ConversationSummary[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAppUser();
  const instance = useId().replace(/[^A-Za-z0-9]/g, "");
  const [composing, setComposing] = useState(false);
  // Chats' New button and the mobile ＋ (SECTION_ACTIONS "/comms") both land
  // as ?new=1, so the one sheet lives here on every hub route.
  useCreateIntent(() => setComposing(true));

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

  const openId = /^\/comms\/c\/([0-9a-f-]{36})/i.exec(pathname)?.[1]?.toLowerCase() ?? null;
  const isHome = pathname === "/comms";
  const pulse = !!chats && (isHome || (!!openId && chats.some((c) => c.id === openId)));

  return (
    <div
      data-focus-scope="off"
      className="@container/comms flex min-h-[22rem] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface md:min-h-[30rem]"
    >
      {top}
      {pulse && chats ? (
        // THE COLOURFUL REDESIGN (2026-10-29): wide, the two panes are white
        // cards on a muted ground with a gap between them; narrow, one pane
        // fills the frame with no card around it.
        <div className="flex min-h-0 flex-1 @3xl/comms:gap-3 @3xl/comms:bg-surface-muted @3xl/comms:p-3">
          <aside
            aria-label="Chats"
            className={cn(
              PANE,
              "@3xl/comms:flex @3xl/comms:w-[22rem] @3xl/comms:shrink-0 @6xl/comms:w-[25rem]",
              isHome ? "flex w-full" : "hidden",
            )}
          >
            <ConversationList conversations={chats} activeId={openId} composing={isHome} />
          </aside>
          {/* `data-pulse`: a conversation shown here has the sidebar beside it
              when wide, so it hides its own back arrow (conversation-view.tsx). */}
          <div data-pulse="" className={cn(PANE, "group/pulse flex-1 bg-surface", isHome ? "hidden @3xl/comms:flex" : "flex")}>
            {children}
          </div>
        </div>
      ) : (
        children
      )}
      <NewConversationSheet open={composing} meId={user.id} onClose={() => setComposing(false)} />
    </div>
  );
}
