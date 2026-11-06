"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Truncated } from "@/components/ui/truncated";
import type { ConversationSummary } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { nameCase } from "@/lib/comms/name-case";
import { cn } from "@/lib/utils";
import { ChatAvatar, UnreadOnlyButton, preview } from "./conversation-list";
import { clockTime } from "./message-body";

/**
 * PULSE ▸ HOME (user 2026-11-05, artifact "Pulse – Home by default": "default
 * a home irukkanum, mail chat mari"). What /comms shows beside the chat list:
 * one card per chat, newest activity first — avatar, name, kind, time, and the
 * latest message as "Name: text". Unread chats are bold with a dot, and the
 * Unread envelope narrows the feed to them. A card opens its chat.
 *
 * The artifact's Threads chip was dropped at the user's request ("remove
 * threds"). Everything here comes from the conversation read the list already
 * makes (`listMyConversations`); nothing new is fetched.
 */
export function HomeFeed({ conversations }: { conversations: ConversationSummary[] }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [now] = useState(() => Date.now());

  const all = conversations
    .filter((c) => !c.archived && c.last_message_at)
    .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
  const unread = (c: ConversationSummary) => !c.muted && c.unread_count > 0;
  const shown = unreadOnly ? all.filter(unread) : all;

  function when(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (days <= 0) return clockTime(iso);
    if (days === 1) return "Yesterday";
    if (days < 7) return d.toLocaleDateString("en-IN", { weekday: "long" });
    return fmtDate(iso);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="pulse-home-title">
      <header className="flex items-center gap-3 px-5 pb-2 pt-4">
        <h1 id="pulse-home-title" className="flex-1 text-xl font-semibold text-heading">
          Home
        </h1>
        {/* The chat list's envelope, not a switch (user 2026-11-06, screenshots
            095209 / 095614: "apply this type of toggle button in home page"),
            so Home and the list headings draw "Unread only" the same way. */}
        <UnreadOnlyButton on={unreadOnly} onChange={setUnreadOnly} label="Show only unread chats" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {shown.length === 0 ? (
          <div className="mx-4 my-12 flex flex-col items-center gap-2 text-center">
            <span aria-hidden className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <MessageCircle className="h-6 w-6" />
            </span>
            <p className="text-[15px] font-bold text-foreground">{unreadOnly ? "You are all caught up" : "No messages yet"}</p>
            <p className="text-[13px] text-muted-foreground">
              {unreadOnly ? "New messages will show up here." : "Start one with ＋ New."}
            </p>
          </div>
        ) : (
          <ul>
            {shown.map((c) => {
              const u = unread(c);
              const name = c.kind === "direct" ? nameCase(c.title) : c.title.replace(/^#/, "");
              const kind = c.is_announcement ? "Announcements" : c.kind === "channel" ? "Channel" : c.kind === "group" ? "Group" : null;
              return (
                <li key={c.id} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/comms/c/${c.id}`}
                    aria-label={`${name}${u ? `, ${c.unread_count} unread` : ""}`}
                    className="flex gap-3 rounded-xl px-2.5 py-3 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChatAvatar c={c} size="lg" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline gap-2">
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <Truncated
                            text={name}
                            className={cn("min-w-0 text-sm", u ? "font-bold text-heading" : "font-medium text-muted-foreground")}
                          />
                          {kind && (
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 text-[10px] font-extrabold",
                                kind === "Group" ? "bg-[color-mix(in_srgb,#6c5ce7_14%,var(--surface))] text-[#5b4bd6] dark:text-[#b4a9ff]" : "bg-primary-soft text-primary",
                              )}
                            >
                              {kind}
                            </span>
                          )}
                        </span>
                        <span className={cn("flex shrink-0 items-center gap-1.5 text-xs tabular-nums", u ? "font-bold text-heading" : "text-muted-foreground")}>
                          {when(c.last_message_at)}
                          {u && <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />}
                        </span>
                      </span>
                      <Truncated
                        text={preview(c)}
                        className={cn("text-[13.5px]", c.last_deleted ? "italic text-muted-foreground" : u ? "font-semibold text-foreground" : "text-foreground/80")}
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
