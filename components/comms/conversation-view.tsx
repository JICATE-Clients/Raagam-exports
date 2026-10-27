"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, Hash, Info, Loader2, Lock, Pin, RotateCw, Users, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import {
  attachmentUrl,
  deleteMessage,
  editMessage,
  joinChannel,
  loadMessages,
  markRead,
  sendMessage,
  setPinned,
  setSaved,
  setReaction,
  loadMessagesById,
} from "@/lib/comms/actions";
import type { AttachmentInput, CommAttachment, CommMessage, ConversationDetail, MessagePage } from "@/lib/comms/types";
import { Composer } from "./composer";
import { DetailsSheet } from "./details-sheet";
import { ChannelDetailsSheet } from "./channel-details-sheet";
import { announceChannelsChanged } from "./sidebar-channels";
import type { ChannelAbilities } from "@/lib/comms/channels";
import { applyReaction } from "@/lib/comms/reactions";
import { MessageItem, type MessageActions } from "./message-item";
import { MessageBody, dayKey } from "./message-body";
import { PinnedSheet } from "./pinned-sheet";
import { ThreadSheet } from "./thread-sheet";

type Pending = {
  client_id: string;
  body: string | null;
  attachments: AttachmentInput[];
  status: "sending" | "failed" | "sent";
  error?: string;
  server_id?: string;
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Fresh rows replace stale ones by id; the result is in reading order. */
function merge(a: CommMessage[], b: CommMessage[]): CommMessage[] {
  const byId = new Map(a.map((m) => [m.id, m]));
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) =>
    x.created_at === y.created_at ? (x.id < y.id ? -1 : 1) : x.created_at < y.created_at ? -1 : 1,
  );
}

function grouped(m: CommMessage, prev: CommMessage | undefined): boolean {
  if (!prev || prev.author_id !== m.author_id || prev.deleted_at || m.kind !== "message") return false;
  if (dayKey(prev.created_at) !== dayKey(m.created_at)) return false;
  return new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS;
}

/**
 * One conversation: header, history, composer.
 *
 * ## LIVE, WITHOUT TRUSTING THE LIVE FEED
 *
 * Realtime is a doorbell, not the data (spec §6: "without treating Realtime as
 * the permanent data store"). Any INSERT or UPDATE on this conversation —
 * RLS-filtered by Supabase, so a subscriber hears only messages it may read —
 * triggers a re-read of the newest page through the same server action the
 * history uses, merged by id. That makes duplicate events harmless (a merge is
 * idempotent), and a reconnect, a tab coming back into view or the network
 * returning ring the same bell, so a missed event heals itself.
 *
 * ## OPTIMISTIC SEND, WITH RETRY ON THE SAME KEY
 *
 * A sent message shows at once as "Sending…". The `client_id` is minted once;
 * Retry resends the SAME id, so a send that reached the database before the
 * connection dropped comes back as the existing row instead of a duplicate.
 * The pending bubble stays until the re-read contains its server id — no
 * flicker between "sent" and "arrived".
 */
export function ConversationView({
  conversation,
  initialPage,
  meId,
  canModerate,
  abilities = null,
  focus = null,
}: {
  conversation: ConversationDetail;
  initialPage: MessagePage;
  meId: string;
  /** communication:delete — may delete anyone's message in a channel. */
  canModerate: boolean;
  /** 0751: what the caller may do on this CHANNEL; null on a DM or group. */
  abilities?: ChannelAbilities | null;
  /** 0762: open AT a message (?m=) — and, for a thread reply, its thread (?t=). */
  focus?: { messageId: string; threadParentId: string | null } | null;
}) {
  const router = useRouter();
  const { error: toastError } = useToast();
  const instance = useId().replace(/[^A-Za-z0-9]/g, "");
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prependFrom = useRef<number | null>(null);
  const lastMarked = useRef<string | null>(null);

  const [messages, setMessages] = useState<CommMessage[]>(initialPage.messages);
  const [cursor, setCursor] = useState<string | null>(initialPage.next_cursor);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [threadOf, setThreadOf] = useState<CommMessage | null>(null);
  const [threadVersion, setThreadVersion] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CommMessage | null>(null);
  const [joining, startJoin] = useTransition();

  const id = conversation.id;
  const me = conversation.me;
  const canPost = !!me?.active && !conversation.is_archived;
  const names = useMemo(
    () => new Map(conversation.members.map((m) => [m.user_id, m.full_name] as const)),
    [conversation.members],
  );

  const refreshLatest = useCallback(async () => {
    const r = await loadMessages(id, null);
    if (!r.ok) {
      setLiveError(r.error);
      return;
    }
    setLiveError(null);
    const fresh = r.page.messages;
    setMessages((prev) => merge(prev, fresh));
    setPending((p) => p.filter((x) => !(x.status === "sent" && fresh.some((m) => m.id === x.server_id))));
  }, [id]);

  // ---- Realtime doorbell + recovery -------------------------------------------
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dropped = false;
    // UPDATE events name the message (a reaction, an edit, a delete bumps its
    // updated_at — 0737 / 0760). Those ids are re-read individually, so a
    // change to a message scrolled far above the newest page arrives too.
    const changed = new Set<string>();
    const ring = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refreshLatest();
        setThreadVersion((v) => v + 1);
        const ids = Array.from(changed);
        changed.clear();
        if (ids.length) {
          void loadMessagesById(id, ids).then((r) => {
            if (r.ok) setMessages((prev) => merge(prev, r.messages));
          });
        }
      }, 250);
    };
    const onUpdate = (payload: { new?: { id?: unknown } }) => {
      if (typeof payload.new?.id === "string") changed.add(payload.new.id);
      ring();
    };
    const filter = `conversation_id=eq.${id}`;
    const channel = supabase
      .channel(`comm:${id}:${instance}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comm_messages", filter }, ring)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "comm_messages", filter }, onUpdate)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          if (dropped) ring(); // reconnected: fetch whatever we missed
          dropped = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          dropped = true;
          setConnected(false);
        }
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") ring();
    };
    window.addEventListener("online", ring);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", ring);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [id, instance, refreshLatest]);

  // ---- Read marker: move it when the newest message changes and we can see it --
  const newest = messages[messages.length - 1]?.created_at ?? null;
  useEffect(() => {
    if (!me?.active || !newest || newest === lastMarked.current) return;
    if (document.visibilityState !== "visible") return;
    const first = lastMarked.current === null;
    lastMarked.current = newest;
    void markRead(id).then((r) => {
      // Once on opening, so the sidebar's badge for this conversation clears.
      if (r.ok && first) router.refresh();
    });
  }, [id, me?.active, newest, router]);

  // ---- Scroll: hold the bottom, and hold the reading position on a prepend ----
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prependFrom.current !== null) {
      el.scrollTop += el.scrollHeight - prependFrom.current;
      prependFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  // ---- Open at a message (a search result, a saved item, an alert) ------------
  // The message is looked for in what is loaded, then up to TEN older pages
  // (400 messages) are read until it appears; it is then scrolled into view
  // and flashed. A thread reply opens its thread with the reply flashed there.
  // Every read is RLS-scoped, so a message the caller cannot read is simply
  // never found — the conversation opens as normal.
  const [flashId, setFlashId] = useState<string | null>(null);
  const savingIds = useRef(new Set<string>());
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const focusDone = useRef(false);
  useEffect(() => {
    if (!focus || focusDone.current) return;
    focusDone.current = true;
    let live = true;
    const target = focus.threadParentId ?? focus.messageId;
    void (async () => {
      let loaded = messages;
      let cur = cursor;
      for (let i = 0; i < 10 && !loaded.some((m) => m.id === target) && cur; i++) {
        const r = await loadMessages(id, cur);
        if (!live || !r.ok) break;
        loaded = merge(r.page.messages, loaded);
        cur = r.page.next_cursor;
        stick.current = false;
        setMessages(loaded);
        setCursor(cur);
      }
      if (!live) return;
      const found = loaded.find((m) => m.id === target);
      if (!found) {
        setFocusNote("That message is further back than the last 400 — scroll up to reach it.");
        return;
      }
      setFlashId(found.id);
      requestAnimationFrame(() => document.getElementById(`msg-${found.id}`)?.scrollIntoView({ block: "center" }));
      if (focus.threadParentId) setThreadOf(found);
      setTimeout(() => live && setFlashId(null), 4000);
    })();
    return () => {
      live = false;
    };
    // Runs once per opened conversation (the view is keyed by id); `messages`
    // and `cursor` are read as they were at that moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, id]);

  async function loadOlder() {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    const r = await loadMessages(id, cursor);
    setLoadingOlder(false);
    if (!r.ok) {
      setOlderError(r.error);
      return;
    }
    setOlderError(null);
    prependFrom.current = listRef.current?.scrollHeight ?? null;
    setMessages((prev) => merge(r.page.messages, prev));
    setCursor(r.page.next_cursor);
  }

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && cursor && !loadingOlder && !olderError) void loadOlder();
  }

  // ---- Sending ------------------------------------------------------------------
  async function deliver(p: Pending) {
    setPending((x) => x.map((y) => (y.client_id === p.client_id ? { ...y, status: "sending", error: undefined } : y)));
    const r = await sendMessage({ conversation_id: id, client_id: p.client_id, body: p.body, attachments: p.attachments });
    if (r.ok) {
      setPending((x) => x.map((y) => (y.client_id === p.client_id ? { ...y, status: "sent", server_id: r.id } : y)));
      void refreshLatest();
    } else {
      setPending((x) => x.map((y) => (y.client_id === p.client_id ? { ...y, status: "failed", error: r.error } : y)));
    }
  }

  async function send(body: string | null, attachments: AttachmentInput[]): Promise<boolean> {
    const p: Pending = { client_id: crypto.randomUUID(), body, attachments, status: "sending" };
    stick.current = true;
    setPending((x) => [...x, p]);
    void deliver(p);
    return true; // queued: the box clears, the bubble carries the outcome
  }

  // ---- Message actions ------------------------------------------------------------
  async function openFile(a: CommAttachment) {
    const r = await attachmentUrl(a.storage_path);
    if (!r.ok) return toastError(r.error);
    const w = window.open(r.url, "_blank", "noopener,noreferrer");
    if (!w) toastError("Allow pop-ups for this site to open attachments.");
  }

  const actions: MessageActions = {
    onOpenFile: (a) => void openFile(a),
    onReply: (m) => setThreadOf(m),
    // OPTIMISTIC, THEN THE TRUTH: the chip moves at once; the server's answer
    // (the message's reactions as stored) replaces it either way, and a refusal
    // puts back exactly what was there. A set, never a flip, so a double click
    // cannot undo itself. The Realtime echo of our own change only re-reads
    // the same rows, so it cannot double a count.
    onReact: async (m, emoji, on) => {
      const before = m.reactions;
      const patch = (fn: (x: CommMessage) => CommMessage) =>
        setMessages((prev) => prev.map((x) => (x.id === m.id ? fn(x) : x)));
      patch((x) => ({ ...x, reactions: applyReaction(x.reactions, emoji, on, meId) }));
      const r = await setReaction(m.id, emoji, on);
      if (!r.ok) {
        patch((x) => ({ ...x, reactions: before }));
        toastError(r.error);
      } else if (r.reactions) {
        const truth = r.reactions;
        patch((x) => ({ ...x, reactions: truth }));
      }
    },
    // Personal: only this person's row changes, and nothing is broadcast. One
    // request per message at a time, so a double click cannot save and then
    // immediately unsave; the bookmark flips when the server has confirmed.
    onSave: async (m) => {
      if (savingIds.current.has(m.id)) return;
      savingIds.current.add(m.id);
      const want = !m.saved;
      const r = await setSaved(m.id, want);
      savingIds.current.delete(m.id);
      if (!r.ok) toastError(r.error);
      else setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, saved: want } : x)));
    },
    onPin: async (m) => {
      const r = await setPinned(m.id, !m.pinned);
      if (!r.ok) toastError(r.error);
      else void refreshLatest();
    },
    onEdit: async (m, body) => {
      const r = await editMessage(m.id, body);
      if (!r.ok) {
        toastError(r.error);
        return false;
      }
      void refreshLatest();
      return true;
    },
    onDelete: (m) => setConfirmDelete(m),
  };

  async function doDelete() {
    const m = confirmDelete;
    if (!m) return;
    setConfirmDelete(null);
    const r = await deleteMessage(m.id);
    if (!r.ok) toastError(r.error);
    else setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body: null, attachments: [], reactions: [] } : x)));
  }

  function mayDelete(m: CommMessage): boolean {
    return m.author_id === meId || conversation.can_manage || (conversation.kind === "channel" && canModerate);
  }

  function join() {
    startJoin(async () => {
      const r = await joinChannel(id);
      if (!r.ok) toastError(r.error);
      else {
        announceChannelsChanged();
        router.refresh();
      }
    });
  }

  const KindIcon = conversation.kind === "channel" ? (conversation.visibility === "private" ? Lock : Hash) : Users;
  const activeCount = conversation.members.filter((m) => !m.removed_at).length;
  const subtitle =
    conversation.topic ??
    conversation.description ??
    (conversation.kind === "direct"
      ? "Direct message"
      : `${activeCount} ${activeCount === 1 ? "member" : "members"}${conversation.department_name ? ` · ${conversation.department_name}` : ""}`);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {/* Always shown: no list sits beside the view any more (2026-10-26). */}
        <Link
          href={conversation.kind === "channel" ? "/comms/channels" : "/comms"}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted"
          aria-label={conversation.kind === "channel" ? "Back to channels" : "Back to chats"}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <KindIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-sm font-semibold text-heading">
            {conversation.kind === "channel" ? conversation.title.replace(/^#/, "") : conversation.title}
          </h1>
          <p className="break-words text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {!connected && (
          <span className="flex items-center gap-1 text-xs text-warning" role="status">
            <WifiOff className="h-3.5 w-3.5" aria-hidden /> Reconnecting…
          </span>
        )}
        <Button variant="ghost" size="icon" onClick={() => setPinnedOpen(true)} aria-label="Pinned messages" title="Pinned messages">
          <Pin className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setDetailsOpen(true)} aria-label="Conversation details" title="Details and members">
          <Info className="h-4 w-4" />
        </Button>
      </header>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto py-2"
        role="log"
        aria-live="polite"
        aria-label={`Messages in ${conversation.title}`}
      >
        {cursor ? (
          <div className="flex justify-center py-2">
            {olderError ? (
              <span className="flex items-center gap-2 text-xs text-danger">
                {olderError}
                <Button size="sm" variant="outline" onClick={() => { setOlderError(null); void loadOlder(); }}>
                  <RotateCw className="h-3.5 w-3.5" /> Retry
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void loadOlder()} disabled={loadingOlder}>
                {loadingOlder && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load earlier messages
              </Button>
            )}
          </div>
        ) : messages.length > 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">This is the start of the conversation.</p>
        ) : null}

        {messages.length === 0 && pending.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-sm font-medium text-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground">
              {canPost ? "Start the conversation below." : "Nothing has been said here yet."}
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-2 flex items-center gap-3 px-3" role="separator">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-semibold text-muted-foreground">{fmtDate(m.created_at)}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <MessageItem
                message={m}
                grouped={!newDay && grouped(m, prev)}
                names={names}
                meId={meId}
                canAct={canPost}
                canDelete={mayDelete(m)}
                actions={actions}
                highlight={m.id === flashId}
              />
            </div>
          );
        })}

        {pending
          .filter((p) => !(p.status === "sent" && messages.some((m) => m.id === p.server_id)))
          .map((p) => (
            <div key={p.client_id} className="flex gap-3 px-3 py-1 opacity-80">
              <div className="w-8 shrink-0" />
              <div className="min-w-0 flex-1">
                {p.body && <MessageBody body={p.body} names={names} meId={meId} />}
                {p.attachments.length > 0 && (
                  <p className="text-xs text-muted-foreground">{p.attachments.map((a) => a.file_name).join(", ")}</p>
                )}
                {p.status === "failed" ? (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-danger" role="alert">
                    Not sent — {p.error}
                    <button type="button" className="font-semibold underline" onClick={() => void deliver(p)}>
                      Retry
                    </button>
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => setPending((x) => x.filter((y) => y.client_id !== p.client_id))}
                    >
                      Discard
                    </button>
                  </p>
                ) : (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {p.status === "sending" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    {p.status === "sending" ? "Sending…" : "Sent"}
                  </p>
                )}
              </div>
            </div>
          ))}

        {focusNote && (
          <p className="py-2 text-center text-xs text-muted-foreground" role="status">
            {focusNote}
          </p>
        )}
        {liveError && (
          <p className="flex items-center justify-center gap-2 py-2 text-xs text-danger" role="alert">
            {liveError}
            <button type="button" className="font-semibold underline" onClick={() => void refreshLatest()}>
              Retry
            </button>
          </p>
        )}
      </div>

      {canPost ? (
        <Composer
          key={id}
          conversationId={id}
          members={conversation.members}
          meId={meId}
          placeholder={`Message ${conversation.title}`}
          onSend={send}
          autoFocus
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-muted px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {conversation.is_archived
              ? "This conversation is archived. It can be read but not added to."
              : me && !me.active
                ? "You are no longer in this conversation. You can still read what was said while you were."
                : conversation.kind === "channel" && conversation.visibility === "public"
                  ? `You are previewing ${conversation.title}. Join to post, react or pin.`
                  : "You cannot post here."}
          </span>
          {!conversation.is_archived && conversation.kind === "channel" && conversation.visibility === "public" && !me?.active && (
            <Button size="sm" onClick={join} disabled={joining}>
              {joining && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Join channel
            </Button>
          )}
        </div>
      )}

      <ThreadSheet
        parent={threadOf}
        version={threadVersion}
        conversation={conversation}
        names={names}
        meId={meId}
        canPost={canPost}
        onClose={() => setThreadOf(null)}
        onChanged={() => void refreshLatest()}
        highlightId={focus?.threadParentId ? focus.messageId : null}
        onOpenFile={(a) => void openFile(a)}
      />
      <PinnedSheet
        open={pinnedOpen}
        conversationId={id}
        names={names}
        meId={meId}
        onClose={() => setPinnedOpen(false)}
        onOpenFile={(a) => void openFile(a)}
      />
      {conversation.kind === "channel" && abilities ? (
        <ChannelDetailsSheet
          open={detailsOpen}
          conversation={conversation}
          abilities={abilities}
          meId={meId}
          onClose={() => setDetailsOpen(false)}
        />
      ) : (
        <DetailsSheet open={detailsOpen} conversation={conversation} meId={meId} onClose={() => setDetailsOpen(false)} />
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this message?"
        body="It is replaced by “This message was deleted.” for everyone, and its files are removed. This cannot be undone."
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
