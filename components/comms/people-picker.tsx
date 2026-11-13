"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { findPeople } from "@/lib/comms/actions";
import type { DirectoryPerson } from "@/lib/comms/types";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";
import { Face } from "./person-photo";
import { WithPresence } from "./presence";

/**
 * Pick colleagues from `comm_directory` — the narrow, messaging-only people
 * list (name, code, designation, department). Multi-select with chips; `single`
 * replaces the selection instead.
 *
 * The search runs on the server per keystroke (debounced): the directory is
 * every active login, which is too many to ship to the browser up front, and
 * `profiles_read_own` would hide them from a client query anyway.
 */
export function PeoplePicker({
  selected,
  onChange,
  exclude = [],
  single = false,
  autoFocus = false,
  boxed = false,
}: {
  selected: DirectoryPerson[];
  onChange: (next: DirectoryPerson[]) => void;
  exclude?: string[];
  single?: boolean;
  autoFocus?: boolean;
  /**
   * COMPACT, ONE BOX (user 2026-11-12, artifact "Compact New Channel"): the
   * chips, the search and the list share one bordered box (no separate 36px
   * search field and gap), and each person is a 44px row with a 28px photo and
   * a tick box. Used by New channel; other callers keep the loose layout.
   */
  boxed?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await findPeople(q);
      if (mine !== seq.current) return; // a newer keystroke owns the list
      setLoading(false);
      if (r.ok) {
        setResults(r.people);
        setError(null);
      } else {
        setError(r.error);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, retry]);

  const chosen = new Set(selected.map((p) => p.id));
  const hidden = new Set(exclude);
  const shown = results.filter((p) => !hidden.has(p.id));

  function toggle(p: DirectoryPerson) {
    if (chosen.has(p.id)) onChange(selected.filter((s) => s.id !== p.id));
    else onChange(single ? [p] : [...selected, p]);
  }

  if (boxed) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        {selected.length > 0 && (
          <ul className="flex max-h-16 shrink-0 flex-wrap gap-1 overflow-y-auto px-1.5 pt-1.5" aria-label="Selected people">
            {selected.map((p) => (
              <li key={p.id} className="flex items-center gap-0.5 rounded-full bg-primary-soft py-0.5 pl-2 pr-0.5 text-xs font-semibold text-primary">
                {p.full_name}
                <button
                  type="button"
                  onClick={() => toggle(p)}
                  aria-label={`Remove ${p.full_name}`}
                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative shrink-0 border-b border-border">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          {/* caps-input: exempt -- a search box; the query is not a stored value */}
          <Input
            type="search"
            uppercase={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, code or department"
            aria-label="Search people"
            autoFocus={autoFocus}
            className="h-8 rounded-none border-0 bg-transparent pl-8 text-[13px] focus-visible:ring-0 md:text-[13px]"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="flex items-center justify-between gap-2 p-2.5 text-[13px] text-danger">
              <span>{error}</span>
              <button type="button" className="font-semibold underline" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </button>
            </div>
          ) : loading && shown.length === 0 ? (
            <p className="flex items-center gap-2 p-2.5 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </p>
          ) : shown.length === 0 ? (
            <p className="p-2.5 text-[13px] text-muted-foreground">No one matches “{q}”.</p>
          ) : (
            <ul role="listbox" aria-multiselectable={!single} aria-label="People">
              {shown.map((p) => {
                const on = chosen.has(p.id);
                return (
                  <li key={p.id} role="option" aria-selected={on}>
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      className={cn(
                        "flex h-11 w-full items-center gap-2.5 px-2.5 text-left hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none",
                        on && "bg-primary-soft/60",
                      )}
                    >
                      <WithPresence userId={p.id}>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-[10px] font-semibold text-muted-foreground">
                          <Face userId={p.id} name={p.full_name} />
                        </span>
                      </WithPresence>
                      <span className="min-w-0 flex-1">
                        <Truncated text={p.full_name} className="block text-[12.5px] font-semibold leading-tight text-foreground" touch={false} />
                        <Truncated
                          text={[p.designation, p.department, p.employee_code].filter(Boolean).join(" · ") || "—"}
                          className="block text-[11.5px] leading-tight text-muted-foreground"
                          touch={false}
                        />
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px]",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                        )}
                      >
                        {on && <Check className="h-2.5 w-2.5" strokeWidth={4} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    // h-full + flex-1: fill whatever height the caller gives — a plain `h-56`
    // box (h-full) or a flex column with a line above (flex-1). Without it the
    // root sized to its content, the list's overflow-y-auto never engaged, and
    // the names spilled out of the box over the hint below it (New channel).
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected people">
          {selected.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1 rounded-full bg-primary-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary"
            >
              {p.full_name}
              <button
                type="button"
                onClick={() => toggle(p)}
                aria-label={`Remove ${p.full_name}`}
                className="rounded-full p-1.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:p-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* caps-input: exempt -- a search box; the query is not a stored value */}
      <Input
        type="search"
        uppercase={false}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, code or department"
        aria-label="Search people"
        autoFocus={autoFocus}
      />

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        {error ? (
          <div className="flex items-center justify-between gap-2 p-3 text-sm text-danger">
            <span>{error}</span>
            <button type="button" className="font-semibold underline" onClick={() => setRetry((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : loading && shown.length === 0 ? (
          <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No one matches “{q}”.</p>
        ) : (
          <ul role="listbox" aria-multiselectable={!single} aria-label="People">
            {shown.map((p) => {
              const on = chosen.has(p.id);
              return (
                <li key={p.id} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none",
                      on && "bg-primary-soft/60",
                    )}
                  >
                    <WithPresence userId={p.id}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-xs font-semibold text-muted-foreground">
                      <Face userId={p.id} name={p.full_name} />
                    </span>
                    </WithPresence>
                    <span className="min-w-0 flex-1">
                      <Truncated text={p.full_name} className="block text-sm font-medium text-foreground" touch={false} />
                      <Truncated
                        text={[p.designation, p.department, p.employee_code].filter(Boolean).join(" · ") || "—"}
                        className="block text-xs text-muted-foreground"
                        touch={false}
                      />
                    </span>
                    {on && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
