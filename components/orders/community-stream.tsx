"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Truncated } from "@/components/ui/truncated";
import { createClient } from "@/lib/supabase/client";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDateTime } from "@/lib/format";
import { postMessage, markChannelRead } from "@/lib/orders/community/actions";
import {
  COMMUNITY_BUCKET,
  messageContent,
  isRefusal,
  type ChannelMessage,
  type PostMessageInput,
} from "@/lib/orders/community/types";

/**
 * The RE-Community stream for one order (doc/file.md §4).
 *
 * ## THE COMPOSER REGISTERS WITH THE RELOAD GUARD, AND THAT IS NOT OPTIONAL
 *
 * AGENTS.md's standing rule: a deploy reloads the tab automatically and
 * SILENTLY, and `lib/reload-guard.ts` is the only thing between that reload and
 * half-typed work. A half-written message to the cutting room is exactly the
 * work it protects — and `isPending` is in the flag for the reason the rule
 * gives, that a reload landing mid-action loses the confirmation and leaves the
 * operator unsure whether their message was sent.
 *
 * ## KEYS
 *
 * Nothing here is a form the keyboard contract owns: there is one field, and
 * Enter inside a message body means NEW LINE, not Save. So the send key is
 * Ctrl/⌘+Enter and the button says so. Making Enter send would put the
 * contract's "Enter advances to the next field" in direct conflict with the one
 * thing every person already knows about a chat box, and there is no next field
 * to advance to.
 *
 * ## IT DELIBERATELY CARRIES NO `data-focus-scope`, AND THE AUDIT SAYS SO
 *
 * `audit_keyboard.py --check tab-page-form` flags this file, and the flag is
 * correct about what it can see and wrong about what to do. Its discriminator is
 * `useUnsavedGuard` — "the codebase's own statement that this surface is an
 * editor" — and here that inference does not hold: the guard is present because
 * a half-typed message is work a silent deploy would destroy, not because this
 * is a form somebody tabs through.
 *
 * Marking it a scope would CAGE the operator. `cycleTab` wraps Tab inside the
 * field region, and this surface has exactly ONE field-like element; Tab from
 * the body would return to the body, and Send, Attach and the "← Order" link
 * would become mouse-only. Native order gives body → Send → page chrome, which
 * is what is wanted. So this joins AGENTS.md's enumerated remainder rather than
 * taking a marker that would make the screen worse — see the report note asking
 * for `tab-page-form` to gain the comment opt-out its siblings have.
 */

type PendingFile = {
  key: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
};

const MAX_MB = 20;
/** Seconds. Long enough to open a marker, short enough that a copied link
 *  is not a leak — 0416's reasoning for garment-order-docs, unchanged. */
const SIGNED_URL_TTL = 60;

function prettySize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CommunityStream({
  salesOrderId,
  channelId,
  messages,
  currentUserId,
  canPost,
}: {
  salesOrderId: string;
  channelId: string;
  messages: ChannelMessage[];
  currentUserId: string;
  canPost: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // A typed message and an in-flight send are both work a silent reload would
  // destroy. An attachment already uploaded counts too: the bytes survive, but
  // the row that points at them has not been written yet.
  useUnsavedGuard(body.trim().length > 0 || files.length > 0 || isPending);

  // The stream is read downwards, so it opens at its recent end.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Opening the channel is reading it. Deliberately not awaited and deliberately
  // not revalidating: clearing a badge must not rebuild the page under the
  // operator while they are reading.
  useEffect(() => {
    void markChannelRead(salesOrderId, channelId);
  }, [salesOrderId, channelId]);

  /**
   * Live updates. 0458 adds `order_channel_messages` to the Realtime
   * publication, and Realtime enforces the SELECT policy — so a subscriber is
   * sent only messages in channels they are a member of. `router.refresh()`
   * rather than appending the payload: the payload has no author NAME on it
   * (that needs `creator_names()`, server-side, for the reason
   * `lib/created-by.ts` records), so appending it would paint a message with a
   * blank author until the next navigation.
   */
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`order-community-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_channel_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelId, router]);

  async function handleFiles(picked: FileList) {
    setError(null);
    setUploading(true);
    const supabase = createClient();
    const added: PendingFile[] = [];
    try {
      for (const f of Array.from(picked)) {
        if (f.size > MAX_MB * 1024 * 1024) {
          setError(`${f.name}: over the ${MAX_MB} MB limit.`);
          continue;
        }
        const ext = f.name.split(".").pop() ?? "bin";
        // THE FIRST FOLDER MUST BE THE CHANNEL ID. The storage policies read it
        // back with `order_channel_of_path()` to decide who may fetch the bytes
        // (0458 §9) — a key under any other prefix resolves to no channel and
        // is refused on upload, which is the correct failure but an opaque one.
        const path = `${channelId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(COMMUNITY_BUCKET)
          .upload(path, f, { upsert: false, contentType: f.type });
        if (upErr) {
          setError(`${f.name}: ${upErr.message}`);
          continue;
        }
        added.push({
          key: crypto.randomUUID(),
          file_name: f.name,
          storage_path: path,
          mime_type: f.type || null,
          size_bytes: f.size,
        });
      }
      if (added.length) setFiles((prev) => [...prev, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** Signed on demand, never stored: a held URL is dead when it is clicked. */
  async function openFile(storagePath: string) {
    setError(null);
    const supabase = createClient();
    const { data, error: signErr } = await supabase.storage
      .from(COMMUNITY_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL);
    if (signErr || !data?.signedUrl) {
      setError(signErr?.message ?? "That file could not be opened.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function send() {
    const payload: Pick<PostMessageInput, "body" | "files"> = {
      body: body || null,
      files: files.map(({ key: _k, ...f }) => f),
    };
    // The SAME function the server action runs, so the composer refuses with the
    // same sentence rather than a second, differently-worded rule that can drift
    // from it. `scripts/check-order-community.mts` proves the one it shares.
    const content = messageContent(payload);
    if (isRefusal(content)) {
      setError(content.refused);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await postMessage({
        sales_order_id: salesOrderId,
        body: content.body,
        parent_id: null,
        files: content.files,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      setFiles([]);
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages yet.
          </p>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              isMine={m.author_id === currentUserId}
              onOpenFile={openFile}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      {canPost ? (
        <div className="space-y-2 border-t border-border pt-3">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="oc-body">
            Message
          </label>
          {/*
            caps-input: exempt -- a stream message is prose read by a person, not
            a stored value anything matches on. Same shape as the client's own
            LC / PO terms carve-out; flagged for confirmation in lib/orders/
            community/types.ts, which carries the reasoning and the two-line
            change if they want capitals after all.
          */}
          <Textarea
            id="oc-body"
            uppercase={false}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            disabled={isPending}
          />

          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((f) => (
                <li
                  key={f.key}
                  className="flex max-w-[16rem] items-center gap-2 rounded-md border border-border bg-surface-muted px-2 py-1 text-xs"
                >
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Truncated text={f.file_name} className="min-w-0 flex-1" />
                  <span className="shrink-0 text-muted-foreground">
                    {prettySize(f.size_bytes)}
                  </span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Remove ${f.file_name}`}
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => setFiles((p) => p.filter((x) => x.key !== f.key))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              {/* toolbar-size: exempt -- an in-editor composer bar, not a header row */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                tabIndex={-1}
                disabled={uploading || isPending}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
                Attach
              </Button>
              <span className="text-xs text-muted-foreground">Ctrl+Enter sends</span>
            </div>
            {/* toolbar-size: exempt -- an in-editor composer bar, not a header row */}
            <Button type="button" size="sm" disabled={isPending} onClick={send}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-sm text-muted-foreground">
          You are not a member of this order&rsquo;s channel.
        </p>
      )}
    </div>
  );
}

/**
 * One message.
 *
 * A BOT ROW IS DRAWN FROM ITS `kind`, NOT FROM ITS TEXT. That is the screen half
 * of 0458's column: the stream can show an alert as machine-generated because
 * the database says it is, and no human post can borrow the styling by choosing
 * its words.
 */
function MessageRow({
  message,
  isMine,
  onOpenFile,
}: {
  message: ChannelMessage;
  isMine: boolean;
  onOpenFile: (path: string) => void;
}) {
  const isBot = message.kind !== "message";
  return (
    <div
      className={
        isBot
          ? "rounded-md border border-info/30 bg-info/5 p-3"
          : "rounded-md border border-border bg-surface p-3"
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          {isBot && <Bot className="h-4 w-4 text-info" />}
          {/* NULL author on a bot row is a real value, not a lookup miss — so it
              prints the bot's own label and never a dash. */}
          {isBot ? "Raagam" : (message.author_name ?? "Unknown user")}
          {isMine && !isBot && (
            <span className="font-normal text-muted-foreground">(you)</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {fmtDateTime(message.created_at)}
          {message.edited_at ? " · edited" : ""}
        </span>
      </div>

      {message.body && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{message.body}</p>
      )}

      {message.href && (
        <a
          href={message.href}
          className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
        >
          Open →
        </a>
      )}

      {message.files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {message.files.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onOpenFile(f.storage_path)}
                className="flex max-w-full items-center gap-2 text-xs text-primary hover:underline"
              >
                <Paperclip className="h-4 w-4 shrink-0" />
                <Truncated text={f.file_name} className="min-w-0" />
                <span className="shrink-0 text-muted-foreground">
                  {prettySize(f.size_bytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
