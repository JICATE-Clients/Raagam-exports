"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Hash, ImageIcon, Loader2, Lock, Send, Users } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { forwardPhotos, forwardTargets, type ForwardTarget } from "@/lib/comms/forward-actions";
import { nameCase } from "@/lib/comms/name-case";
import type { CommMessage } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { avatarStyle } from "./conversation-list";
import { Face } from "./person-photo";

const MAX_PICK = 10;

/**
 * FORWARD TO — WhatsApp's picker (user 2026-11-05, the "forward an image"
 * board). Opened by the round ↪ beside a photo or "Forward" in its ⌄ menu.
 * Recent chats first (the caller's own conversations, newest activity first),
 * search by name, tick up to ten, an optional caption, Send. Each chosen chat
 * gets the photos as a new message marked "Forwarded" (lib/comms/forward-actions.ts).
 */
export function ForwardSheet({ message, onClose }: { message: CommMessage | null; onClose: () => void }) {
  const toast = useToast();
  const open = !!message;
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let live = true;
    void forwardTargets().then((r) => {
      if (!live) return;
      if (r.ok) setTargets(r.targets);
      else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open]);

  function close() {
    if (pending) return;
    setQ("");
    setPicked([]);
    setCaption("");
    setError(null);
    onClose();
  }

  const photos = message ? message.attachments.filter((a) => a.mime_type.toLowerCase().startsWith("image/")).length : 0;
  const lower = q.trim().toLowerCase();
  const shown = (targets ?? []).filter((t) => !lower || t.title.toLowerCase().includes(lower));
  const byId = new Map((targets ?? []).map((t) => [t.id, t]));

  function toggle(id: string) {
    setError(null);
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_PICK ? prev : [...prev, id]));
  }

  function send() {
    if (!message || picked.length === 0 || pending) return;
    start(async () => {
      setError(null);
      const r = await forwardPhotos({
        message_id: message.id,
        targets: picked.map((id) => ({ conversation_id: id, client_id: crypto.randomUUID() })),
        caption: caption.trim() || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.sent === 0) {
        setError(r.error ?? "Nothing was forwarded. Try again.");
        return;
      }
      toast.success(r.sent === 1 ? "Forwarded." : `Forwarded to ${r.sent} chats.`);
      if (r.failed > 0) toast.error(`${r.failed} chat${r.failed === 1 ? "" : "s"} could not be reached. ${r.error ?? ""}`.trim());
      setQ("");
      setPicked([]);
      setCaption("");
      onClose();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Forward to"
      size="sm"
      alignToPane
      footer={
        <div className="flex items-center gap-2">
          {/* truncate-reveal: exempt -- the chosen names are also ticked in the list above */}
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {picked.length === 0 ? "Pick a chat" : picked.map((id) => byId.get(id)?.title ?? "").filter(Boolean).join(", ")}
          </p>
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={pending || picked.length === 0}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ImageIcon className="h-4 w-4" aria-hidden />
          {photos === 1 ? "1 photo" : `${photos} photos`}
        </p>
        {/* caps-input: exempt -- a search for a chat, not a stored value */}
        <Input
          uppercase={false}
          type="search"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a name or #channel"
          aria-label="Search chats"
        />

        <div role="list" aria-label="Chats" className="scrollbar-hairline -mx-1 max-h-80 overflow-y-auto">
          {targets === null && !loadError && (
            <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your chats…
            </p>
          )}
          {loadError && <p className="px-2 py-3 text-sm text-danger">{loadError}</p>}
          {targets && shown.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No chat matches.</p>}
          {shown.map((t) => {
            const on = picked.includes(t.id);
            const label = t.kind === "channel" ? `#${t.title}` : t.kind === "direct" ? nameCase(t.title) : t.title;
            return (
              <div role="listitem" key={t.id}>
                <button
                  type="button"
                  onClick={() => toggle(t.id)}
                  role="checkbox"
                  aria-checked={on}
                  className="flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {t.kind === "channel" ? (
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                      {t.visibility === "private" ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                    </span>
                  ) : t.kind === "group" ? (
                    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <Users className="h-4 w-4" />
                    </span>
                  ) : (
                    <span
                      aria-hidden
                      style={avatarStyle(t.title)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--ink)] text-[11px] font-bold text-white"
                    >
                      <Face userId={t.other_user_id} name={t.title} />
                    </span>
                  )}
                  <Truncated text={label} className="min-w-0 flex-1 text-sm font-semibold text-foreground" />
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                      on ? "border-primary bg-primary text-white" : "border-border-strong",
                    )}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        {picked.length >= MAX_PICK && <p className="text-xs text-muted-foreground">You can forward to {MAX_PICK} chats at a time.</p>}

        {/* caps-input: exempt -- a caption is chat content, prose not a stored value (lib/comms/types.ts) */}
        <Input
          uppercase={false}
          value={caption}
          maxLength={500}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Add a caption (optional)"
          aria-label="Caption"
        />
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
