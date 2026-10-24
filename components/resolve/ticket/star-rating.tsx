"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"] as const;

/**
 * 1–5 STARS AS A REAL RADIO GROUP.
 *
 * Five `sr-only` radios under five star glyphs, so the keyboard needs no code of
 * its own: Tab lands on the group (a radio is a field), ← → ↑ ↓ move the
 * choice natively (`ownsArrowKeys` in lib/focus.ts stands down for radios), and
 * a screen reader announces "3 stars, Good, 3 of 5". Hand-rolled star buttons
 * would be off the Tab path and need their own arrow handling — the per-control
 * keyboard patch the contract forbids.
 */
export function StarRating({
  value,
  onChange,
  name,
  disabled = false,
}: {
  value: number;
  onChange: (stars: number) => void;
  name: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Rating" className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const lit = n <= value;
          return (
            <label
              key={n}
              className={cn(
                "cursor-pointer rounded-md p-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={name}
                value={n}
                checked={value === n}
                disabled={disabled}
                onChange={() => onChange(n)}
                className="sr-only"
                aria-label={`${n} star${n === 1 ? "" : "s"}, ${WORDS[n]}`}
              />
              <Star
                aria-hidden
                className={cn("h-7 w-7", lit ? "fill-warning text-warning" : "text-muted-foreground")}
              />
            </label>
          );
        })}
      </div>
      <span className="text-sm text-muted-foreground">{WORDS[value] ?? ""}</span>
    </div>
  );
}
