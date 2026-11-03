import Link from "next/link";
import type { DashboardTone } from "@/lib/dashboard/types";
import { toneGrad } from "./tone";

export type FooterFact = { label: string; value: string; tone?: DashboardTone };

/**
 * EVERY CARD HAS A FOOTER (user 2026-11-03, plan "Getting to 9 out of 10", fix 6): two or
 * three coloured figures, then "Open … ›" to the screen that owns them — so it is plain that
 * a card leads somewhere, and the figures behind the picture are stated once in words.
 * A coloured square says which mark in the picture a figure is.
 */
export function CardFooter({ facts = [], href, cta }: { facts?: FooterFact[]; href?: string; cta?: string }) {
  if (facts.length === 0 && !href) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-[var(--glass-edge)] pt-1.5 text-[11px] text-muted-foreground">
      {facts.map((f) => (
        <span key={f.label} className="inline-flex items-center gap-1 whitespace-nowrap">
          {f.tone && <span className="size-2 rounded-[2px]" style={{ background: toneGrad(f.tone) }} aria-hidden />}
          {f.label} <b className="tabular-nums text-foreground">{f.value}</b>
        </span>
      ))}
      {href && (
        <Link href={href} className="ml-auto whitespace-nowrap font-semibold text-primary hover:underline">
          {cta ?? "Open"} ›
        </Link>
      )}
    </div>
  );
}
