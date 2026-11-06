import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * THE OVERVIEW KIT — one look for every "at a glance" screen (user 2026-11-05: "the analytics
 * page of the purchase module under Purchase Store Overview looks much user friendly … do like
 * proper UI layout for all analytics pages"; plan https://claude.ai/artifact/87etHN8WiMGTnSiK2JLVQh).
 *
 * Born in Purchase ▸ Purchase Store ▸ Overview (`components/purchase/inventory/inventory-visuals.tsx`,
 * approved mock-up 2026-11-04) and moved here so that screen and the eight Analytics boards draw
 * from the SAME parts — a change to the strip or a card changes every one of them at once:
 *
 *   Strip        one card, 4–5 cells, each with a glowing MOOD line (normal · look · problem · good)
 *   VizCard      a white card whose hairline head asks the question it answers
 *   GlowBars     ranked bars, colour fixed by the thing (an item class, a buyer), value printed
 *   Tape         one whole split into parts (age, owner, status) with a legend of the figures
 *   NeedsDoing   three cells — dot, count, one line, and a "→" to the screen that clears it
 *   Dot          the small glowing status dot
 *
 * Server-safe (no hooks), so a server page renders it directly; a client screen imports it too.
 * Colour is never the only signal: every coloured mark has its word or figure beside it.
 */

export type Mood = "normal" | "look" | "problem" | "good" | "quiet";

export const MOOD_COLOUR: Record<Mood, string> = {
  normal: "var(--primary)",
  look: "var(--warning)",
  problem: "var(--danger)",
  good: "var(--success)",
  quiet: "var(--border-strong)",
};

const SHADOW = "shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-16px_rgba(3,123,184,.25)]";

/** A glowing status dot — the colour lights its own halo (`currentColor`). */
export function Dot({ colour, className }: { colour: string; className?: string }) {
  return (
    <i
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full shadow-[0_0_6px_1px_currentColor]", className)}
      style={{ background: colour, color: colour }}
    />
  );
}

/** One card: a white ground, a hairline head saying the question. */
export function VizCard({
  title,
  question,
  lead,
  right,
  children,
  className,
  padded = false,
}: {
  title: string;
  question?: string;
  /**
   * A control that IS the card's subject, drawn where the title would be — the
   * title stays as a screen-reader heading. Store Overview's store tabs (user
   * 2026-11-06: "move as title"): the store picked is what the card shows.
   */
  lead?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Pad the body. Off by default: Store Overview's bodies lay out their own padding. */
  padded?: boolean;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface", SHADOW, className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3.5 py-2">
        {lead ? (
          <div className="min-w-0">
            <h2 className="sr-only">{title}</h2>
            {lead}
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold">{title}</h2>
            {question ? <p className="text-xs text-muted-foreground">{question}</p> : null}
          </div>
        )}
        {right}
      </div>
      {padded ? <div className="px-3.5 py-3">{children}</div> : children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Strip
// ---------------------------------------------------------------------------

export type StripCell = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  mood?: Mood;
  /** A colour of its own instead of the mood's — Store Overview's yarn cell is the yarn blue. */
  accent?: string;
  /** Opens what the number counts. */
  href?: string;
};

/** `compact` — the module overviews' smaller figures (user 2026-11-06: "compact the font"); Store Overview and the boards keep the default. */
export function Strip({ cells, compact = false }: { cells: StripCell[]; compact?: boolean }) {
  return (
    <dl className={cn("grid grid-cols-2 rounded-xl border border-border bg-surface", SHADOW, cells.length >= 5 ? "md:grid-cols-5" : "md:grid-cols-4")}>
      {cells.map((c, i) => {
        const colour = c.accent ?? MOOD_COLOUR[c.mood ?? "normal"];
        const body = (
          <>
            <span aria-hidden className="absolute inset-x-3.5 top-0 h-0.5 rounded-b-sm" style={{ background: colour, boxShadow: `0 0 10px 1px ${colour}` }} />
            <dt className="text-xs text-muted-foreground">{c.label}</dt>
            <dd className={cn("mt-0.5 font-bold tabular-nums tracking-tight", compact ? "text-base" : "text-xl")}>{c.value}</dd>
            {c.hint ? (
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                {c.mood && c.mood !== "normal" ? <Dot colour={colour} /> : null}
                <span className="min-w-0">{c.hint}</span>
              </div>
            ) : null}
          </>
        );
        const cls = cn("relative block min-w-0 px-3.5", compact ? "py-2" : "py-2.5", i > 0 && "md:border-l md:border-border");
        return c.href ? (
          <Link key={c.label} href={c.href} className={cn(cls, "rounded-xl hover:bg-surface-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
            {body}
          </Link>
        ) : (
          <div key={c.label} className={cls}>
            {body}
          </div>
        );
      })}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// GlowBars
// ---------------------------------------------------------------------------

export type GlowBar = { key: string; label: string; value: number; colour: string; href?: string; display?: string };

export function GlowBars({ rows, format, empty = "Nothing here yet." }: { rows: GlowBar[]; format: (v: number) => string; empty?: string }) {
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length || max === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const text = r.display ?? format(r.value);
        return (
          <div key={r.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_6.5rem] items-center gap-2.5" title={`${r.label} · ${text}`}>
            {r.href ? (
              <Link href={r.href} className="min-w-0 text-[12.5px] hover:text-primary hover:underline">
                <Truncated text={r.label} className="block" />
              </Link>
            ) : (
              <Truncated text={r.label} className="block min-w-0 text-[12.5px]" />
            )}
            <div className="h-3 rounded-r bg-surface-muted">
              <div
                className="h-full rounded-r"
                style={{ width: `${Math.max(1.5, (Math.abs(r.value) / max) * 100)}%`, background: r.colour, boxShadow: `0 0 10px -1px ${r.colour}` }}
              />
            </div>
            <span className="text-right text-[12.5px] font-semibold tabular-nums">{text}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tape
// ---------------------------------------------------------------------------

export type TapePart = { label: string; value: number; colour: string };

export function Tape({ parts, format, note }: { parts: TapePart[]; format: (v: number) => string; note?: ReactNode }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex h-4 gap-0.5">
        {total > 0 ? (
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <div
                key={p.label}
                className="rounded"
                title={`${p.label} · ${format(p.value)}`}
                style={{ flex: p.value, background: p.colour, color: p.colour, boxShadow: "0 0 12px -2px currentColor" }}
              />
            ))
        ) : (
          <div className="flex-1 rounded bg-surface-muted" />
        )}
      </div>
      <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(parts.length, 4)}, minmax(0, 1fr))` }}>
        {parts.map((p) => (
          <div key={p.label} className="min-w-0 text-[11.5px] text-muted-foreground">
            <span className="inline-flex max-w-full items-center gap-1.5">
              <Dot colour={p.colour} />
              <Truncated text={p.label} className="block min-w-0" />
            </span>
            <b className="block text-sm text-foreground tabular-nums">{format(p.value)}</b>
          </div>
        ))}
      </div>
      {note ? <p className="mt-2 text-[11.5px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** A row of coloured words — the key to a picture. */
export function Legend({ items }: { items: { label: string; colour: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <Dot colour={i.colour} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NeedsDoing
// ---------------------------------------------------------------------------

export type NeedCell = {
  title: string;
  mood: Mood;
  /** "3 lots", "None". */
  count: string;
  /** One line naming the items; cut with a reveal. */
  text: string;
  href?: string;
  linkText?: string;
  /** A button instead of (or beside) the link — Store Overview's "Assign a bin". */
  action?: ReactNode;
};

export function NeedsDoing({ cells, question = "Each line opens the screen that clears it", compact = false }: { cells: NeedCell[]; question?: string; compact?: boolean }) {
  const cell = "min-w-0 border-border px-3.5 py-2.5 md:border-l md:first:border-l-0 max-md:border-t max-md:first:border-t-0";
  return (
    <VizCard title="What needs doing?" question={question}>
      <div className={cn("grid", cells.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {cells.map((c) => {
          const colour = MOOD_COLOUR[c.mood];
          return (
            <div key={c.title} className={cell}>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: colour }}>
                <Dot colour={colour} />
                {c.title}
              </span>
              <div className={cn("font-bold", compact ? "text-[15px]" : "text-lg")}>{c.count}</div>
              <Truncated text={c.text} className="block text-xs text-muted-foreground" />
              {c.action}
              {c.href ? (
                <Link href={c.href} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  {c.linkText ?? "Open"}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </VizCard>
  );
}

// ---------------------------------------------------------------------------
// Fixed colours
// ---------------------------------------------------------------------------

/* ITEM CLASS → COLOUR, FIXED BY THE CLASS, never by its rank on screen (a filter that drops Yarn
   must not repaint Sewing). Blue is the app's primary; the rest are the dataviz reference
   palette's categorical slots, validated against white (Store Overview, 2026-11-04). */
const CLASS_COLOURS: [prefix: string, colour: string][] = [
  ["YARN", "#037bb8"],
  ["FABRIC", "#1baf7a"],
  ["SEWING", "#eb6834"],
  ["PACK", "#6250d6"],
];
export function classColour(itemClass: string): string {
  const u = itemClass.toUpperCase();
  return CLASS_COLOURS.find(([p]) => u.startsWith(p))?.[1] ?? "#8a94a3";
}

/* A BUYER OR VENDOR KEEPS ITS COLOUR on every board and through every filter: the colour is
   chosen from its NAME, not its rank, so dropping one buyer never repaints another. Five
   categorical slots (--viz-1..5); two names may share one, which the label beside it settles. */
const NAME_COLOURS = ["var(--viz-1)", "var(--viz-3)", "var(--viz-2)", "var(--viz-5)", "var(--viz-4)"];
export function nameColour(name: string): string {
  let h = 0;
  for (const ch of name.trim().toUpperCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLOURS[h % NAME_COLOURS.length];
}
