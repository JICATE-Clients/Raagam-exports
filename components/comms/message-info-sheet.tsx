"use client";

import { Sheet } from "@/components/ui/sheet";
import type { CommMessage, ConversationDetail } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { MessageBody, clockTime, dayKey } from "./message-body";
import { AVATAR_TINT, avatarStyle } from "./conversation-list";
import { cn } from "@/lib/utils";

/**
 * MESSAGE INFO (user 2026-11-14, screenshots 105224 / 105240 and the artifact
 * "Pulse Type and Spacing", Message info): WhatsApp's panel, opened from the ⌄
 * menu of one of YOUR messages. It says who has read it and when it was
 * delivered.
 *
 * READ, WITHOUT A TIME — the decision, not an omission. Pulse keeps one
 * `last_read_at` per member and it moves forward every time they open the
 * chat, so it says WHETHER they have read a message (the same test as the blue
 * ticks, `isSeen`) but not WHEN they first did. Printing it as the read time
 * would show a later time every visit. An exact time needs a per-message read
 * record (a migration), offered to the user and not yet applied.
 *
 * DELIVERED = when Pulse stored it, the time on the bubble. There is no
 * separate delivery record.
 */
export function MessageInfoSheet({
  message,
  conversation,
  meId,
  names,
  onClose,
}: {
  message: CommMessage | null;
  conversation: ConversationDetail;
  meId: string;
  names: Map<string, string | null>;
  onClose: () => void;
}) {
  const m = message;
  // Everyone else who is in the chat and was there when it was sent.
  const others = m
    ? conversation.members.filter((x) => x.user_id !== meId && !x.removed_at && x.joined_at <= m.created_at)
    : [];
  const read = m ? others.filter((x) => !!x.last_read_at && x.last_read_at >= m.created_at) : [];
  const unread = m ? others.filter((x) => !(x.last_read_at && x.last_read_at >= m.created_at)) : [];
  const direct = conversation.kind === "direct";

  return (
    <Sheet open={!!m} onClose={onClose} title="Message info" size="sm" alignToPane>
      {m && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-surface-muted px-3 py-2.5">
            <MessageBody body={m.body ?? ""} names={names} meId={meId} recordLinks={false} className="line-clamp-4" />
            {!m.body && m.attachments.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {m.attachments.length === 1 ? "1 attachment" : `${m.attachments.length} attachments`}
              </p>
            )}
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{clockTime(m.created_at)}</p>
          </div>

          {direct ? (
            <dl className="flex flex-col divide-y divide-border">
              <div className="flex flex-col gap-0.5 py-3">
                <dt className="flex items-center gap-2.5 text-[15px] text-foreground">
                  <Ticks read={read.length > 0} /> {read.length > 0 ? "Read" : "Not read yet"}
                </dt>
                <dd className="pl-[30px] text-[13px] text-muted-foreground">
                  {read.length > 0 ? "Opened the chat after it arrived" : "Waiting for them to open the chat"}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 py-3">
                <dt className="flex items-center gap-2.5 text-[15px] text-foreground">
                  <Ticks read={false} /> Delivered
                </dt>
                <dd className="pl-[30px] text-[13px] text-muted-foreground">{whenAt(m.created_at)}</dd>
              </div>
            </dl>
          ) : (
            <>
              <People title="Read by" count={`${read.length} of ${others.length}`} read people={read} />
              <People
                title="Delivered, not read yet"
                count={String(unread.length)}
                read={false}
                people={unread}
                note={`Delivered ${whenAt(m.created_at)}`}
              />
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function People({
  title,
  count,
  read,
  people,
  note,
}: {
  title: string;
  count: string;
  read: boolean;
  people: { user_id: string; full_name: string | null }[];
  note?: string;
}) {
  if (people.length === 0 && !read) return null;
  return (
    <section aria-label={title} className="flex flex-col">
      <h3 className="flex items-center gap-2.5 pb-1 text-[15px] font-bold text-heading">
        <Ticks read={read} /> {title}
        <span className="text-[13px] font-normal text-muted-foreground">{count}</span>
      </h3>
      {note && <p className="pb-1 pl-[30px] text-[12.5px] text-muted-foreground">{note}</p>}
      {people.length === 0 ? (
        <p className="py-2 pl-[30px] text-[13px] text-muted-foreground">Nobody yet.</p>
      ) : (
        <ul>
          {people.map((p) => {
            const name = p.full_name ?? "Someone";
            return (
              <li key={p.user_id} className="flex h-11 items-center gap-3">
                <span
                  aria-hidden
                  style={avatarStyle(name)}
                  className={cn("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] text-[12px] font-bold", AVATAR_TINT, !read && "opacity-75")}
                >
                  {name.trim().charAt(0).toUpperCase()}
                </span>
                <span className={cn("min-w-0 flex-1 break-words text-[15px]", read ? "text-foreground" : "text-muted-foreground")}>{name}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Ticks({ read }: { read: boolean }) {
  return (
    <svg width="20" height="14" viewBox="0 0 24 16" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={read ? "stroke-[#34a7e0]" : "stroke-muted-foreground"}>
      <path d="M1 9l4 4 8-10M9 13l2 0 8-10" />
    </svg>
  );
}

/** "Today at 10:21 AM", "Yesterday at …", or "14/11/2026 at …". */
function whenAt(iso: string): string {
  const today = new Date();
  let day = fmtDate(iso);
  if (dayKey(iso) === dayKey(today.toISOString())) day = "Today";
  else {
    today.setDate(today.getDate() - 1);
    if (dayKey(iso) === dayKey(today.toISOString())) day = "Yesterday";
  }
  return `${day} at ${clockTime(iso)}`;
}
