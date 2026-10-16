"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { SubDetailSheet } from "@/components/orders/sub-detail-sheet";
import type { SheetOrigin } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * "Copy from…" — ONE chooser for every screen that copies another record in
 * (user 2026-10-16: "copy from … add search option … more user friendly for
 * choosing it"). Find it, look inside it, then copy it:
 *
 * - **Find.** A search box that has the cursor when the sheet opens. EVERY word
 *   must match one of the row's fields, so "aarsan polo" narrows by customer
 *   AND style — the one-phrase match `BomCopySheet` had found nothing for that.
 *   An optional `ToggleGroup` of filters (This customer · Approved) with counts,
 *   and optional groups that keep the caller's order inside each heading.
 * - **Look.** Choosing a row SELECTS it and opens its preview underneath — what
 *   will come across, and what it replaces. `loadPreview` runs once per pick and
 *   its answer is handed to `onCopy`, so copying needs no second fetch.
 * - **Copy.** Only the footer's filled Copy button (or Enter on the selected
 *   row) copies. Sample Costing used to copy on the FIRST click, overwriting the
 *   figures on screen with nothing to stop a slip; a click now only selects.
 *
 * NO HIDDEN CAP. Sample Costing's list was `.slice(0, 30)` with nothing saying
 * so, which made every older costing uncopyable. The list scrolls instead.
 *
 * KEYBOARD. Tab lands on fields only (AGENTS.md), and a row is a button, not a
 * field — so the way in is ↓ from the search box, ↑ ↓ between rows (each one
 * previews as it is reached), ↑ off the first row back to the box, Enter copies
 * the selected row. Every key claimed here calls `preventDefault`, which is what
 * the global listener in keyboard-nav-provider.tsx stands down for. Enter IN THE
 * SEARCH BOX does nothing, so a stray Enter cannot overwrite anything.
 *
 * All state lives HERE, so a caller adds no hook — which matters on the
 * Sample Costing screen, whose editor sits below an early return (AGENTS.md
 * "Hooks above every early return").
 */

export type CopyFilter<T> = { key: string; label: string; test: (item: T) => boolean };
export type CopyGroup<T> = { label: string; test: (item: T) => boolean };
export type PreviewResult<P> = { ok: true; data: P } | { ok: false; error: string };

type PreviewState<P> =
  | { id: string; state: "loading" }
  | { id: string; state: "ready"; data: P | undefined }
  | { id: string; state: "error"; error: string };

export function CopySourceChooser<T, P = undefined>({
  open,
  onClose,
  title,
  intro,
  items,
  getId,
  searchText,
  searchPlaceholder = "Search…",
  filters,
  groups,
  renderRow,
  loadPreview,
  renderPreview,
  onCopy,
  copyLabel,
  emptyHint,
  isPending = false,
  origin,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One muted line under the title: what a copy brings and what it keeps. */
  intro?: ReactNode;
  /** In the order they should be listed — the chooser never re-sorts. */
  items: T[];
  getId: (item: T) => string;
  /** The values a search word may match. */
  searchText: (item: T) => (string | null | undefined)[];
  searchPlaceholder?: string;
  /** "All" is always first and is where the sheet opens. */
  filters?: CopyFilter<T>[];
  /** Headings, in order. An item no group claims is listed last, unheaded. */
  groups?: CopyGroup<T>[];
  renderRow: (item: T) => ReactNode;
  loadPreview?: (id: string) => Promise<PreviewResult<P>>;
  /** Drawn under the selected row once its preview is in. */
  renderPreview?: (item: T, data: P | undefined) => ReactNode;
  onCopy: (id: string, data: P | undefined) => void;
  /** The Copy button's words for the selected item ("Copy from SCT/26-27/0041"). */
  copyLabel?: (item: T) => string;
  /** Shown when there is nothing to copy from at all. */
  emptyHint: string;
  isPending?: boolean;
  origin?: SheetOrigin | null;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [preview, setPreview] = useState<PreviewState<P> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // EVERY OPEN STARTS CLEAN. `Sheet` keeps its content mounted while closed
  // (opacity-0 + inert), so the last visit's search and pick would otherwise be
  // waiting. Adjusting state on a prop change during render, per React's docs.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQ("");
      setFilter("all");
      setPreview(null);
    }
  }

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched = words.length
    ? items.filter((it) => {
        const hay = searchText(it).map((v) => (v ?? "").toLowerCase());
        return words.every((w) => hay.some((h) => h.includes(w)));
      })
    : items;
  const active = filters?.find((f) => f.key === filter);
  const shown = active ? matched.filter(active.test) : matched;

  const sections: { label: string | null; rows: T[] }[] = [];
  if (groups?.length) {
    const claimed = new Set<T>();
    for (const g of groups) {
      const rows = shown.filter((it) => !claimed.has(it) && g.test(it));
      rows.forEach((r) => claimed.add(r));
      if (rows.length) sections.push({ label: g.label, rows });
    }
    const rest = shown.filter((it) => !claimed.has(it));
    if (rest.length) sections.push({ label: sections.length ? "Others" : null, rows: rest });
    // One heading over the whole list says nothing.
    if (sections.length === 1) sections[0].label = null;
  } else if (shown.length) {
    sections.push({ label: null, rows: shown });
  }
  const order = sections.flatMap((s) => s.rows);

  // A pick the search or filter has since hidden is no pick — derived, so the
  // Copy button can never act on a row the operator cannot see.
  const selected = preview ? (order.find((it) => getId(it) === preview.id) ?? null) : null;
  const ready = selected && preview?.state === "ready" ? preview : null;

  function choose(id: string) {
    if (preview?.id === id) return;
    if (!loadPreview) {
      setPreview({ id, state: "ready", data: undefined });
      return;
    }
    setPreview({ id, state: "loading" });
    loadPreview(id).then((res) =>
      // Only the LAST pick may land: a fast ↓↓↓ fires three loads, and a slow
      // first answer must not preview a row the cursor has already left.
      setPreview((cur) =>
        cur?.id !== id ? cur : res.ok ? { id, state: "ready", data: res.data } : { id, state: "error", error: res.error },
      ),
    );
  }

  function copy() {
    if (!ready || isPending) return;
    onCopy(ready.id, ready.data);
  }

  function focusRow(id: string) {
    // After the render that draws the preview, so the row is where it will stay.
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-copy-id="${CSS.escape(id)}"]`)?.focus(),
    );
  }

  function step(to: number) {
    const it = order[to];
    if (!it) return;
    const id = getId(it);
    choose(id);
    focusRow(id);
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && order.length) {
      e.preventDefault();
      step(0);
    } else if (e.key === "Enter") {
      e.preventDefault();
    }
  }

  function onRowKey(e: KeyboardEvent<HTMLButtonElement>, index: number, id: string) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index === 0) {
        setPreview(null);
        searchRef.current?.focus();
      } else step(index - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (preview?.id === id) copy();
      else choose(id);
    }
  }

  const counts = (f: CopyFilter<T>) => matched.filter(f.test).length;

  return (
    <SubDetailSheet
      open={open}
      onClose={onClose}
      title={title}
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={!ready || isPending} onClick={copy}>
            <Copy className="h-4 w-4" aria-hidden />
            {isPending ? "Copying…" : ready && selected && copyLabel ? copyLabel(selected) : "Copy"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {intro ? <p className="text-xs text-muted-foreground">{intro}</p> : null}

        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input
          ref={searchRef}
          uppercase={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder={searchPlaceholder}
          aria-label={typeof title === "string" ? `Search — ${title}` : "Search"}
        />

        {filters?.length ? (
          <ToggleGroup
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: matched.length },
              ...filters.map((f) => ({ value: f.key, label: f.label, count: counts(f) })),
            ]}
          />
        ) : null}

        {order.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {items.length === 0
              ? emptyHint
              : words.length
                ? `Nothing matches "${q.trim()}".`
                : "Nothing here for this filter."}
          </p>
        ) : (
          <ul ref={listRef} role="listbox" aria-label="Copy from" className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-0.5">
            {sections.map((s) => (
              <li key={s.label ?? "_"} role="presentation" className="space-y-1.5">
                {s.label ? (
                  <p className="px-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </p>
                ) : null}
                <ul role="group" aria-label={s.label ?? undefined} className="space-y-1.5">
                  {s.rows.map((it) => {
                    const id = getId(it);
                    const on = preview?.id === id;
                    const index = order.indexOf(it);
                    return (
                      <li key={id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={on}
                          data-copy-id={id}
                          disabled={isPending}
                          onClick={() => choose(id)}
                          onKeyDown={(e) => onRowKey(e, index, id)}
                          className={cn(
                            "block w-full rounded-control border px-3 py-2 text-left transition-colors disabled:opacity-60",
                            on
                              ? "border-primary bg-primary-soft shadow-[inset_3px_0_0_var(--primary)]"
                              : "border-border hover:border-primary/50 hover:bg-surface-muted",
                          )}
                        >
                          {renderRow(it)}
                          {on && preview ? (
                            <span className="mt-2 block border-t border-dashed border-border pt-2">
                              {preview.state === "loading" ? (
                                <span className="text-xs text-muted-foreground">Loading what&apos;s inside…</span>
                              ) : preview.state === "error" ? (
                                <span className="text-xs text-danger">{preview.error}</span>
                              ) : renderPreview ? (
                                renderPreview(it, preview.data)
                              ) : null}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground">↓ to choose · Enter or Copy to copy · Esc to close</p>
      </div>
    </SubDetailSheet>
  );
}

/** A small count chip for a preview line ("3 fabrics", "Margin 12%"). */
export function PreviewChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] tabular-nums text-foreground">
      {children}
    </span>
  );
}
