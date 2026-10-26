"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * − [ number ] + — the phone-friendly number box Resolve settings use for days,
 * limits and minutes (mobile redesign, 2026-10-26).
 *
 * IT IS A REAL `<input type="number">` UNDERNEATH, and that is the keyboard
 * contract, not a detail: Tab lands on FIELDS (`isFieldLike`), so a stepper
 * drawn as a value between two buttons would be unreachable without a mouse.
 * The − / + are ordinary buttons — off the Tab path by the same rule, which is
 * right: a keyboard operator types the number, a thumb taps the buttons. Wrap
 * it in `<Field required>` and the required hold reaches the input as it does
 * any other.
 *
 * The value is held as TEXT, as every number on these screens is, so a
 * half-typed box is never coerced to 0 under the cursor. `down` / `up` decide
 * the next value — ±1 by default, or a ladder ("15 min → 30 min → 1 h").
 * `words` is the reading shown under the box ("4 h", "3 days").
 */
export function Stepper({
  id,
  value,
  onChange,
  min = 0,
  max,
  down,
  up,
  words,
  ariaLabel,
  invalid,
  className,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  min?: number;
  max?: number;
  /** Next value below / above `n`. Default ±1. */
  down?: (n: number) => number;
  up?: (n: number) => number;
  /** The value read as words, under the box. */
  words?: string;
  ariaLabel?: string;
  invalid?: boolean;
  className?: string;
}) {
  const n = Number(value);
  const ok = value.trim() !== "" && Number.isFinite(n);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, v));
  const step = (dir: -1 | 1) => {
    const base = ok ? n : min;
    const next = dir < 0 ? (down ? down(base) : base - 1) : up ? up(base) : base + 1;
    onChange(String(clamp(next)));
  };
  return (
    <div className={cn("space-y-0.5", className)}>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Less${ariaLabel ? ` — ${ariaLabel}` : ""}`}
          disabled={ok && n <= min}
          onClick={() => step(-1)}
        >
          <Minus aria-hidden />
        </Button>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={String(min)}
          max={max != null ? String(max) : undefined}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className="w-20 text-center tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`More${ariaLabel ? ` — ${ariaLabel}` : ""}`}
          disabled={ok && max != null && n >= max}
          onClick={() => step(1)}
        >
          <Plus aria-hidden />
        </Button>
      </div>
      {words && <p className="text-xs font-medium tabular-nums text-muted-foreground">{words}</p>}
    </div>
  );
}

/** Ladder steps for a minutes box: 5 min … 30 days, the values people mean. */
const MINUTE_LADDER = [
  5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440, 2880, 4320, 5760, 7200, 10080, 14400, 20160, 43200,
];
export const minutesDown = (n: number) => [...MINUTE_LADDER].reverse().find((v) => v < n) ?? 1;
export const minutesUp = (n: number) => MINUTE_LADDER.find((v) => v > n) ?? n;
