"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchMore } from "@/lib/comms/search-actions";
import { snippet } from "@/lib/comms/search";
import { plainText, type CommMessage, type MessageHit } from "@/lib/comms/types";
import { fmtDateTime } from "@/lib/format";

/**
 * SEARCH MESSAGES, INSIDE ONE CHAT (user 2026-10-31, the Pulse mockup and
 * WhatsApp's 🔍 in the chat header, screenshot 123202).
 *
 * The same server search Pulse ▸ Search runs (0762, RLS-scoped), narrowed to
 * this conversation and ordered newest first — so it reaches the whole
 * history, not only the page already loaded. A result is the sender, the time
 * and the message with the matched words marked (as text inside <mark>, never
 * HTML). Picking one hands it to the conversation, which scrolls to it —
 * reading older pages first when it is further back — and flashes it.
 *
 * Beside the chat on a wide pane, over it on a narrow one (conversation-view).
 * Esc in the box closes the panel.
 */
export function ChatSearchPanel({
  conversationId,
  names,
  onClose,
  onPick,
}: {
  conversationId: string;
  names: Map<string, string | null>;
  onClose: () => void;
  onPick: (m: CommMessage) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const term = q.trim();

  useEffect(() => {
    const mine = ++seq.current;
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await searchMore({ q: term, conversation: conversationId, sort: "newest" });
      if (mine !== seq.current) return; // a newer keystroke owns the list
      setLoading(false);
      if (r.ok) {
        setHits(r.hits);
        setTerms(r.terms);
        setError(null);
      } else {
        setError(r.error);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [term, conversationId]);

  const shown = term.length >= 2 ? hits : [];

  return (
    <aside
      aria-label="Search messages"
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-surface @5xl/comms:static @5xl/comms:w-[22rem] @5xl/comms:shrink-0 @5xl/comms:border-l @5xl/comms:border-border"
    >
      <header className="flex items-center gap-3 border-b border-border px-3 py-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          title="Close search (Esc)"
          className="rounded-full p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
        <h2 className="text-base font-semibold text-heading">Search messages</h2>
      </header>
      <div className="relative px-3 py-2.5">
        {loading ? (
          <Loader2 className="pointer-events-none absolute left-7 top-1/2 h-[18px] w-[18px] -translate-y-1/2 animate-spin text-[#54656f] dark:text-[#aebac1]" aria-hidden />
        ) : (
          <Search className="pointer-events-none absolute left-7 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#54656f] dark:text-[#aebac1]" aria-hidden />
        )}
        {/* caps-input: exempt -- a search box; the query is not a stored value */}
        <Input
          type="search"
          uppercase={false}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          placeholder="Search…"
          aria-label="Search messages in this chat"
          className="h-10 rounded-full border-2 border-transparent bg-surface-muted pl-11 pr-4 focus-visible:border-primary focus-visible:bg-surface focus-visible:ring-0 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>
      <div className="scrollbar-pulse min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Results">
        {term.length < 2 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Search for messages in this chat.</p>
        ) : error ? (
          <p className="px-5 py-8 text-center text-sm text-danger" role="alert">{error}</p>
        ) : shown.length === 0 && !loading ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No messages found for “{term}”.</p>
        ) : (
          shown.map(({ message: m }) => {
            const plain = plainText(m.body, names);
            const pieces = plain ? snippet(plain, terms.length ? terms : [term.toLowerCase()]) : [];
            return (
              <button
                key={m.id}
                type="button"
                role="listitem"
                onClick={() => onPick(m)}
                className="block w-full border-b border-border px-4 py-2.5 text-left hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
              >
                <span className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 break-words">{m.author_name ?? "Someone"}</span>
                  <span className="shrink-0 tabular-nums">{fmtDateTime(m.created_at)}</span>
                </span>
                <span className="mt-0.5 block break-words text-sm text-foreground">
                  {pieces.length
                    ? pieces.map((p, i) =>
                        p.hit ? (
                          <mark key={i} className="rounded bg-[#d9fdd3] px-0.5 font-semibold text-foreground dark:bg-[#103529]">
                            {p.text}
                          </mark>
                        ) : (
                          <span key={i}>{p.text}</span>
                        ),
                      )
                    : "Attachment"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
