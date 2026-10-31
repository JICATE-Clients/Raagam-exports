"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Hash, Lightbulb, Loader2, Lock, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createGroup, findPeople, openDirect, sendMessage } from "@/lib/comms/actions";
import { MESSAGE_MAX, type DirectoryPerson } from "@/lib/comms/types";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { avatarStyle } from "./conversation-list";
import { initials } from "./message-body";

/** Somebody or somewhere the message can go. */
type Target =
  | { kind: "person"; id: string; label: string; sub: string | null }
  | { kind: "channel"; id: string; label: string; sub: string | null; visibility: "public" | "private" };

export type ChannelOption = { id: string; name: string; visibility: "public" | "private"; topic: string | null };

/**
 * NEW MESSAGE — Pulse's home pane, Slack's shape (user 2026-10-29, screenshot
 * of the Slack-style mock-up: "apply this screen for in pulse module").
 *
 * "To:" takes a #channel the person is in, or colleagues by name (the same
 * `comm_directory` search the people picker uses). Picked ones become chips;
 * Enter or Tab takes the first suggestion, Backspace in an empty box removes
 * the last chip. Then the message:
 *
 * - one #channel → posted there;
 * - one person   → their direct chat, found or opened (the database keeps one
 *   per pair, so this never makes a second);
 * - two or more people → a new group with them;
 * - a channel AND people together is refused with a sentence — a message goes
 *   to one place.
 *
 * Every send goes through `sendMessage`, the same action the chat box uses,
 * with a client id minted once per message, and then opens the conversation.
 */
export function NewMessage({ channels, meId }: { channels: ChannelOption[]; meId: string }) {
  const router = useRouter();
  const toRef = useRef<HTMLInputElement>(null);
  const [to, setTo] = useState<Target[]>([]);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [hi, setHi] = useState(0);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  useUnsavedGuard(to.length > 0 || body.trim().length > 0 || pending);

  const term = query.trim().replace(/^[@#]/, "");
  const channelOnly = query.trim().startsWith("#");

  // People are searched on the server, debounced; only the latest answer lands.
  useEffect(() => {
    const mine = ++seq.current;
    if (!term || channelOnly) return;
    const t = setTimeout(async () => {
      const r = await findPeople(term);
      if (mine !== seq.current) return;
      setPeople(r.ok ? r.people : []);
    }, 200);
    return () => clearTimeout(t);
  }, [term, channelOnly]);

  const taken = new Set(to.map((t) => `${t.kind}:${t.id}`));
  const lower = term.toLowerCase();
  const suggestions: Target[] =
    query.trim().length === 0
      ? []
      : [
          ...channels
            .filter((c) => c.name.toLowerCase().includes(lower) || (c.topic ?? "").toLowerCase().includes(lower))
            .map((c): Target => ({ kind: "channel", id: c.id, label: c.name, sub: c.topic, visibility: c.visibility })),
          ...(channelOnly || !term
            ? []
            : people
                .filter((p) => p.id !== meId)
                .map((p): Target => ({
                  kind: "person",
                  id: p.id,
                  label: p.full_name,
                  sub: [p.designation, p.department].filter(Boolean).join(" · ") || null,
                }))),
        ]
          .filter((t) => !taken.has(`${t.kind}:${t.id}`))
          .slice(0, 8);
  const lit = Math.min(hi, Math.max(0, suggestions.length - 1));

  function add(t: Target) {
    setTo((prev) => [...prev, t]);
    setQuery("");
    setPeople([]);
    setHi(0);
    setError(null);
    toRef.current?.focus();
  }

  function onToKey(e: KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setHi((lit + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if ((e.key === "Enter" || e.key === "Tab") && suggestions.length > 0) {
      e.preventDefault();
      add(suggestions[lit]);
    } else if (e.key === "Backspace" && !query && to.length > 0) {
      setTo((prev) => prev.slice(0, -1));
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
    }
  }

  const chans = to.filter((t) => t.kind === "channel");
  const persons = to.filter((t) => t.kind === "person");
  const problem =
    chans.length > 1
      ? "Send to one channel at a time."
      : chans.length === 1 && persons.length > 0
        ? "Send to a channel, or to people — not both in one message."
        : null;
  const canSend = to.length > 0 && !problem && body.trim().length > 0 && !pending;

  function send() {
    if (!canSend) return;
    const text = body.trim();
    start(async () => {
      setError(null);
      let id: string | undefined;
      if (chans.length === 1) id = chans[0].id;
      else {
        const r = persons.length === 1 ? await openDirect(persons[0].id) : await createGroup({ name: null, member_ids: persons.map((p) => p.id) });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        id = r.id;
      }
      if (!id) {
        setError("That conversation could not be opened.");
        return;
      }
      const s = await sendMessage({ conversation_id: id, client_id: crypto.randomUUID(), body: text });
      if (!s.ok) {
        setError(s.error);
        return;
      }
      setTo([]);
      setBody("");
      router.push(`/comms/c/${id}`);
    });
  }

  const tip =
    to.length === 0
      ? { title: "Draft a message, without distractions", text: "From here you can message any colleague or channel. Type a name or #channel in To:, or pick someone under Direct messages." }
      : chans.length === 1 && persons.length === 0
        ? { title: `To #${chans[0].label}`, text: "Type your message below and press Enter. It is posted in the channel." }
        : persons.length === 1 && chans.length === 0
          ? { title: `To ${persons[0].label}`, text: "Type your message below and press Enter. It opens your direct chat." }
          : { title: `To ${persons.length} people`, text: "Type your message below and press Enter. It starts a new group with them." };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-muted/50">
      <header className="relative z-10 border-b border-border bg-surface shadow-sm">
        <h2 className="px-5 pb-2 pt-4 text-lg font-bold text-heading">New message</h2>
        <div className="relative flex flex-wrap items-center gap-1.5 border-t border-border px-5 py-2.5">
          <label htmlFor="pulse-to" className="mr-2 text-sm text-foreground">
            To:
          </label>
          {to.map((t, i) => (
            <span key={`${t.kind}:${t.id}`} className="flex h-7 items-center gap-1 rounded-md bg-primary-soft pl-2 pr-1 text-sm font-semibold text-primary">
              {t.kind === "channel" && "#"}
              {t.label}
              <button
                type="button"
                onClick={() => setTo((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`Remove ${t.label}`}
                className="rounded p-1.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:p-0.5"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ))}
          {/* caps-input: exempt -- a search for a person or channel, not a stored value */}
          {/* autofill: exempt -- the attributes are set by hand below */}
          <input
            ref={toRef}
            id="pulse-to"
            type="text"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="pulse-to-list"
            aria-autocomplete="list"
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            data-form-type="other"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHi(0);
            }}
            onKeyDown={onToKey}
            placeholder={to.length ? "" : "#a-channel, or a colleague’s name"}
            className="h-8 min-w-[10rem] flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
          />
          {suggestions.length > 0 && (
            <ul
              id="pulse-to-list"
              role="listbox"
              aria-label="Channels and people"
              className="absolute left-3 right-3 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg sm:left-14 sm:right-auto sm:w-96"
            >
              {suggestions.map((t, i) => (
                <li key={`${t.kind}:${t.id}`} role="option" aria-selected={i === lit}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(t)}
                    className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm", i === lit ? "bg-primary-soft" : "hover:bg-surface-muted")}
                  >
                    {t.kind === "channel" ? (
                      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
                        {t.visibility === "private" ? <Lock className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />}
                      </span>
                    ) : (
                      <span
                        aria-hidden
                        style={avatarStyle(t.label)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--ink)] text-[10px] font-bold text-white"
                      >
                        {initials(t.label)}
                      </span>
                    )}
                    <span className="font-semibold text-foreground">
                      {t.kind === "channel" && "#"}
                      {t.label}
                    </span>
                    {t.sub && <span className="min-w-0 truncate text-xs text-muted-foreground">{/* truncate-reveal: exempt -- a hint line in a suggestion; the name beside it is the value */}{t.sub}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-end justify-center p-6">
        <div className="mb-4 max-w-lg text-center">
          <p className="mb-1.5 flex items-center justify-center gap-2 text-base font-bold text-heading">
            <Lightbulb className="h-4 w-4 text-warning" aria-hidden /> {tip.title}
          </p>
          <p className="text-sm text-muted-foreground">{tip.text}</p>
        </div>
      </div>

      <div className="border-t border-border bg-surface p-3">
        <div className="flex items-end gap-2">
          {/* caps-input: exempt -- a chat message is prose, not a stored value (lib/comms/types.ts) */}
          <Textarea
            uppercase={false}
            rows={2}
            value={body}
            maxLength={MESSAGE_MAX}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={to.length ? "Start a new message" : "Add someone in To: first"}
            aria-label="Message"
            className="max-h-40 min-h-12 flex-1 resize-none"
          />
          <Button type="button" onClick={send} disabled={!canSend} aria-label="Send message" title="Send (Enter)">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {(problem || error) && (
          <p className="mt-1.5 text-sm text-danger" role="alert">
            {problem ?? error}
          </p>
        )}
      </div>
    </div>
  );
}
