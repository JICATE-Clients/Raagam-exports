"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useAppUser } from "@/lib/auth/permission-context";
import { useCreateIntent } from "@/lib/use-create-intent";
import { createClient } from "@/lib/supabase/client";
import { NewConversationSheet } from "./new-conversation-sheet";

/**
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
export function CommsShell({ children, top }: { children: ReactNode; top?: ReactNode }) {
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

  return (
    <div
      data-focus-scope="off"
      className="@container/comms flex min-h-[30rem] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      {top}
      {children}
      <NewConversationSheet open={composing} meId={user.id} onClose={() => setComposing(false)} />
    </div>
  );
}
