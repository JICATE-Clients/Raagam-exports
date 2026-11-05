"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useAppUser } from "@/lib/auth/permission-context";
import { useCreateIntent } from "@/lib/use-create-intent";
import { createClient } from "@/lib/supabase/client";
import type { CommunitySummary, ConversationSummary, ThreadSummary } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { ConversationList } from "./conversation-list";
import { NewConversationSheet } from "./new-conversation-sheet";
import { PhotosProvider } from "./person-photo";

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
/** One Pulse pane. Flat since 2026-11-05 (user: "card mari irukkathalma
 *  remove pannu") — no corners, no shadow; a hairline divides the two. */
const PANE = "min-h-0 min-w-0 flex-col overflow-hidden";

export function CommsShell({
  children,
  top,
  chats,
  communities,
  threads,
  photos,
}: {
  children: ReactNode;
  top?: ReactNode;
  /** The caller's conversations, for Pulse's list pane. */
  chats?: ConversationSummary[];
  /** 0775: the caller's communities; null before 0775 is applied. */
  communities?: CommunitySummary[] | null;
  /** 0811: threads the caller is in, for the list's Threads section. */
  threads?: ThreadSummary[];
  /** userId → HR photo URL (lib/comms/photos.ts). */
  photos?: Record<string, string>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAppUser();
  const instance = useId().replace(/[^A-Za-z0-9]/g, "");
  const [composing, setComposing] = useState(false);
  // Chats' New button and the mobile ＋ (SECTION_ACTIONS "/comms") both land
  // as ?new=1, so the one sheet lives here on every hub route.
  // `a=group` (the Groups heading's ⋮ ▸ New group, user 2026-11-05) opens
  // the sheet straight in group mode. Read from the live URL: the intent runs
  // before it strips `new` and `a`.
  const [composeGroup, setComposeGroup] = useState(false);
  useCreateIntent(() => {
    setComposeGroup(new URLSearchParams(window.location.search).get("a") === "group");
    setComposing(true);
  });

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
  // /comms/new: the New message screen (moved off /comms on 2026-11-05, when
  // /comms became the Home feed). A pane like a conversation.
  const isNew = pathname === "/comms/new";
  // 0775: a community's page is part of Pulse too — the list stays beside it.
  const communityId = /^\/comms\/community\/([0-9a-f-]{36})/i.exec(pathname)?.[1]?.toLowerCase() ?? null;
  // Pulse ▸ Files opens a file beside the list too (user 2026-10-31).
  const fileId = /^\/comms\/files\/([0-9a-f-]{36})/i.exec(pathname)?.[1]?.toLowerCase() ?? null;
  // Every conversation opens beside the list since Pulse ▸ Channels (user
  // 2026-10-31): a public channel read before joining is one tap from the
  // list, as a WhatsApp channel is.
  const pulse = !!chats && (isHome || isNew || !!communityId || !!fileId || !!openId);

  // NO OUTER CARD (user 2026-11-05, "remove this card based"): the frame has
  // no border or corners, and <main> drops its padding around it — sides and
  // top always, bottom from md up, so a phone keeps its tab-bar room
  // (app/(app)/layout.tsx). Pulse runs edge to edge under the tab strip, as
  // WhatsApp Web does.
  return (
    <PhotosProvider photos={photos ?? {}}>
    <div
      data-focus-scope="off"
      data-comms-frame=""
      className="@container/comms flex min-h-[22rem] flex-1 flex-col overflow-hidden bg-surface md:min-h-[30rem]"
    >
      {top}
      {pulse && chats ? (
        // FLAT (user 2026-11-05): wide, the two panes share one white surface
        // with a hairline between them — the 2026-10-29 cards-on-a-muted-ground
        // look is withdrawn. Narrow, one pane fills the frame.
        <div className="flex min-h-0 flex-1">
          <aside
            aria-label="Chats"
            className={cn(
              PANE,
              // WhatsApp's width (user 2026-10-31, screenshot 122843): 460px wide fits
              // All · Unread · Favourites · Groups · ▾ on one line.
              "@3xl/comms:flex @3xl/comms:w-[18rem] @3xl/comms:shrink-0 @3xl/comms:border-r @3xl/comms:border-border",
              isHome ? "flex w-full" : "hidden",
            )}
          >
            <ConversationList
              conversations={chats}
              threads={threads ?? []}
              activeId={openId}
              composing={isNew}
              home={isHome}
              communities={communities}
              activeCommunityId={communityId}
              activeFileId={fileId}
            />
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
      <NewConversationSheet key={composeGroup ? "group" : "direct"} startGroup={composeGroup} open={composing} meId={user.id} onClose={() => setComposing(false)} />
    </div>
    </PhotosProvider>
  );
}
