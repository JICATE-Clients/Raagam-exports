"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The Custom period's two dates (user 2026-10-28) — a GET form back to `/`.
 *
 * A client file only because `Input` is one (its required-hold reads React
 * context); it holds no state. `hidden` restates the page's other query
 * values, since a GET submit replaces the whole query string — without them
 * the denied notice and the calendar's chosen day would be dropped.
 */
export function CustomRangeForm({
  from,
  to,
  hidden,
}: {
  from?: string;
  to?: string;
  hidden: [string, string][];
}) {
  return (
    <form method="get" action="/" className="flex flex-wrap items-center gap-2" aria-label="Custom period">
      <input type="hidden" name="range" value="custom" />
      {hidden.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        From
        <Input type="date" name="from" defaultValue={from} required className="w-[9.5rem]" />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        To
        <Input type="date" name="to" defaultValue={to} required className="w-[9.5rem]" />
      </label>
      <Button type="submit" size="sm">
        Apply
      </Button>
    </form>
  );
}
