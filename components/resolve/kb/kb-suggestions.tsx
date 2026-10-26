"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BookOpen, ChevronDown, ChevronRight, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { kbFeedback, searchKnowledgeBase } from "@/lib/resolve/desk-actions";
import type { KbSearchHit } from "@/lib/resolve/desk-types";
import { KbSteps } from "./kb-steps";

/** Fewer characters than this is not a question yet. */
const MIN_QUERY = 3;
const DEBOUNCE_MS = 400;

/**
 * "MAYBE THIS IS ALREADY ANSWERED" — published articles matching what the
 * requester is typing (service-desk-plan §6, `rh_kb_search`).
 *
 * Advisory, never a gate: nothing here holds the cursor or blocks Send, and
 * the chips are not on the Tab path (Tab lands on fields), so the form types
 * exactly as it would without them. Opening one shows its steps inline;
 * "This solved it" records helpful feedback against no ticket and hands back
 * to the form (`onSolved`); "Still need help" folds it away and hides it.
 *
 * The newest answer wins: a slow reply to an older query is dropped.
 */
export function KbSuggestions({
  query,
  categoryCode,
  onSolved,
  disabled = false,
}: {
  query: string;
  categoryCode: string | null;
  onSolved: (hit: KbSearchHit) => void;
  disabled?: boolean;
}) {
  const q = query.trim();
  const [hits, setHits] = useState<KbSearchHit[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const asked = useRef("");

  useEffect(() => {
    const key = `${categoryCode ?? ""}|${q}`;
    const t = setTimeout(() => {
      asked.current = key;
      if (q.length < MIN_QUERY) {
        setHits([]);
        return;
      }
      void searchKnowledgeBase(q, categoryCode).then((res) => {
        if (asked.current !== key) return;
        setHits(res.ok ? res.data : []);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, categoryCode]);

  const shown = q.length >= MIN_QUERY ? hits.filter((h) => !dismissed.includes(h.id)) : [];
  if (shown.length === 0) return null;

  return (
    <div className="space-y-1.5 rounded-lg border border-info/40 bg-info-soft/30 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <BookOpen className="h-4 w-4 text-info" aria-hidden />
        These might fix it straight away
      </p>
      <ul className="space-y-1">
        {shown.map((h) => {
          const open = openId === h.id;
          return (
            <li key={h.id} className="rounded-md bg-surface">
              <button
                type="button"
                tabIndex={-1}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : h.id)}
                className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface-muted"
              >
                {open ? (
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="font-medium">{h.title}</span>
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">{h.code}</span>
                </span>
              </button>
              {open ? (
                <div className="space-y-3 px-2 pb-2 pl-7">
                  {h.problem ? <p className="text-sm text-muted-foreground">{h.problem}</p> : null}
                  <KbSteps steps={h.steps} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="approve"
                      tabIndex={-1}
                      disabled={disabled || isPending}
                      onClick={() =>
                        startTransition(async () => {
                          // Feedback is a courtesy to the article; the form is
                          // cleared whether or not it was recorded.
                          await kbFeedback(h.id, true, null);
                          onSolved(h);
                        })
                      }
                    >
                      <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                      This solved it
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      tabIndex={-1}
                      disabled={disabled || isPending}
                      onClick={() => {
                        setOpenId(null);
                        setDismissed((d) => [...d, h.id]);
                      }}
                    >
                      Still need help
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
