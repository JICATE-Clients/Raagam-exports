"use client";

import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { AREAS, RATINGS, scoreOf, scoreWord, type AreaKey, type Rating, type Ratings } from "@/lib/hr/performance-types";

/**
 * HR ▸ Performance & Growth (0773) — pieces the screens share: the four-area
 * rating block and the score badge.
 */

const RATING_WORD: Record<Rating, string> = { below: "Below", meets: "Meets", exceeds: "Exceeds" };

/** Four areas, each Below · Meets · Exceeds. Read-only when `onChange` is absent. */
export function RatingsBlock({
  name,
  value,
  onChange,
}: {
  /** Unique per block on the page (the radios' group name). */
  name: string;
  value: Ratings;
  onChange?: (key: AreaKey, v: Rating) => void;
}) {
  return (
    <div className="divide-y divide-border rounded-control border border-border">
      {AREAS.map((a) => (
        <div key={a.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="text-sm">{a.label}</span>
          {onChange ? (
            <Segmented<Rating | "">
              name={`${name}-${a.key}`}
              value={value[a.key] ?? ""}
              onChange={(v) => v && onChange(a.key, v)}
              options={RATINGS}
            />
          ) : (
            <span
              className={cn(
                "text-sm font-medium",
                value[a.key] === "exceeds" ? "text-success" : value[a.key] === "below" ? "text-danger" : "text-foreground",
              )}
            >
              {value[a.key] ? RATING_WORD[value[a.key] as Rating] : "—"}
            </span>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-sm font-medium">Score</span>
        <ScoreBadge score={scoreOf(value)} />
      </div>
    </div>
  );
}

/** "62.5 / 100 · Good" with the colour of its band. */
export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "text-sm font-medium tabular-nums",
        score >= 75 ? "text-success" : score >= 50 ? "text-foreground" : "text-danger",
      )}
    >
      {score % 1 === 0 ? score : score.toFixed(1)} / 100
      <span className="ml-1 font-normal text-muted-foreground">· {scoreWord(score)}</span>
    </span>
  );
}
