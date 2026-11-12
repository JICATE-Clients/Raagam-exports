import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Truncated } from "@/components/ui/truncated";
import { Dot, MOOD_COLOUR, VizCard } from "@/components/viz/kit";
import { WHEN_MOOD, WHEN_WORD, type SayLine, type When } from "@/lib/overview/words";
import { AutoRefresh, WhoSwitch, type Who } from "./who-switch";

/**
 * THE FRAME OF EVERY MODULE OVERVIEW — the module's landing page (decided 2026-11-04; plan
 * https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW, wave 1 built 2026-11-06).
 *
 * The same rows as Store Overview and the Analytics boards, drawn from the same kit
 * (`components/viz/kit.tsx`), with the two rows the "easy to understand" plan added:
 *
 *   1. title row — the module, Mine · Everyone, "as of"        (OverviewHeader)
 *   2. the sentence — what is wrong, how many, the worst by name (Say)
 *   3. the strip — every figure with its "out of"               (kit Strip)
 *   4. the picture — the module's work drawn
 *   5. three question cards                                      (kit VizCard, WhenList)
 *   6. what needs doing — at most three                          (kit NeedsDoing)
 *
 * An overview is today's work in this module; an Analytics board is a period across modules.
 * Each overview links to its board rather than repeating it.
 */

export function OverviewHeader({
  title,
  question,
  who,
  mine,
  everyone,
  asOf,
}: {
  title: string;
  question: string;
  /** Null hides the switch — a module where nothing is owned by a person. */
  who: Who | null;
  mine: number;
  everyone: number;
  /** The time the figures were read, already formatted ("10:42"). */
  asOf: string;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={question}
        back={false}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground" title="The page reads its figures again every five minutes">
              as of {asOf}
            </span>
            {who ? (
              <Suspense fallback={null}>
                <WhoSwitch value={who} mine={mine} everyone={everyone} />
              </Suspense>
            ) : null}
          </div>
        }
      />
      <AutoRefresh />
    </>
  );
}

/** `?who=` → the word, defaulting to Mine only when the operator owns something here. */
export function whoOf(raw: string | undefined, mine: number): Who {
  if (raw === "mine" || raw === "everyone") return raw;
  return mine > 0 ? "mine" : "everyone";
}

/**
 * THE SENTENCE (rule 1). Two to four lines, each a plain statement with its own dot, the
 * worst item named, and where a line has a fix, the link to it. When every line is good the
 * block turns into "All caught up" (rule 10) — an empty box reads as broken.
 */
export function Say({ lines, done }: { lines: SayLine[]; done?: string }) {
  const allGood = lines.length > 0 && lines.every((l) => l.mood === "good");
  return (
    <section
      aria-label="In short"
      className="rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-16px_rgba(3,123,184,.25)]"
    >
      {allGood ? (
        <p className="mb-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-success">
          <CircleCheck className="size-4" aria-hidden />
          All caught up
        </p>
      ) : null}
      <ul className="space-y-1">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
            <Dot colour={MOOD_COLOUR[l.mood]} className="mt-[6px]" />
            <span className="min-w-0">
              {l.text}
              {l.href ? (
                <>
                  {" "}
                  <Link href={l.href} className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
                    {l.linkText ?? "Open"}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {done ? <p className="mt-2 text-xs text-muted-foreground">{done}</p> : null}
    </section>
  );
}

export type WhenItem = { key: string; when: When; name: string; code?: string; note: string; href?: string };

/**
 * A QUESTION CARD THAT GROUPS BY TIME (rule 4) — Late · Today · This week · Later · No date.
 * Each row: the name big, the code small under it (rule 5), and what is owed on the right.
 * At most `max` rows; the rest are counted, never silently dropped.
 */
export function WhenList({
  title,
  question,
  items,
  empty,
  max = 6,
  more,
  grouped = true,
}: {
  title: string;
  question: string;
  items: WhenItem[];
  empty: string;
  max?: number;
  /** False for a list that is not about time — the Late / This week headings are left out. */
  grouped?: boolean;
  /** Where "and n more" goes. */
  more?: string;
}) {
  const order: When[] = ["late", "today", "week", "later", "undated"];
  const sorted = [...items].sort((a, b) => order.indexOf(a.when) - order.indexOf(b.when));
  const shown = sorted.slice(0, max);
  const rest = sorted.length - shown.length;
  return (
    <VizCard title={title} question={question}>
      <div className="px-3.5 py-2.5">
        {shown.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
        <ul className="space-y-1">
          {shown.map((it, i) => {
            const head = grouped && (i === 0 || shown[i - 1].when !== it.when);
            const colour = MOOD_COLOUR[WHEN_MOOD[it.when]];
            const name = <Truncated text={it.name} className="block text-[12.5px] font-semibold" />;
            return (
              <li key={it.key}>
                {head ? (
                  <span className="mt-1.5 mb-0.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: colour }}>
                    <Dot colour={colour} />
                    {WHEN_WORD[it.when]}
                  </span>
                ) : null}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-b border-dashed border-border pb-1 last:border-b-0">
                  <div className="min-w-0">
                    {it.href ? (
                      <Link href={it.href} className="block hover:text-primary hover:underline">
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                    {it.code ? <Truncated text={it.code} className="block text-[11px] text-muted-foreground" /> : null}
                  </div>
                  <span className="text-right text-[12px] text-muted-foreground tabular-nums">{it.note}</span>
                </div>
              </li>
            );
          })}
        </ul>
        {rest > 0 ? (
          more ? (
            <Link href={more} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              and {rest} more <ArrowRight className="size-3" aria-hidden />
            </Link>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">and {rest} more</p>
          )
        ) : null}
      </div>
    </VizCard>
  );
}

/** The quiet line at the foot: where to go for the deeper view (Analytics, Store Overview). */
export function MoreLinks({ links }: { links: { href: string; label: string }[] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
      <span>See also</span>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          {l.label}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      ))}
    </p>
  );
}

export function Row3({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-2.5 lg:grid-cols-3">{children}</div>;
}
