import Link from "next/link";
import type { StageRow } from "@/lib/dashboard/types";
import { fmtCompactNumber } from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";
import { toneGrad } from "./tone";

/** The order a garment moves through the factory. The route is drawn in this order whatever
 *  order the service returns the stages in. */
const ROUTE: { key: string; short: string; group: string }[] = [
  { key: "yarn", short: "Yarn issued", group: "Store" },
  { key: "knitting", short: "Knitting", group: "Knit" },
  { key: "fabric", short: "Fabric issued", group: "Store" },
  { key: "cutting", short: "Cutting", group: "Make" },
  { key: "sewing", short: "Sewing", group: "Make" },
  { key: "packing", short: "Packing", group: "Make" },
  { key: "packing-lists", short: "Packing lists", group: "Ship" },
  { key: "shipment", short: "Shipment", group: "Ship" },
];
const PIECE_STAGES = ["cutting", "sewing", "packing"];

/**
 * "WHERE IS PRODUCTION RIGHT NOW?" — THE GARMENT ROUTE (user 2026-11-03, plan
 * https://claude.ai/artifact/3vUk4Cth5KjKYAELNGgEiU "The production card", option A + C:
 * "okay do by recommend"). The card it replaces drew piles for three stages and a word list
 * ("None", "Idle", "Clear") for the other five — two pictures, mostly zeros, for one journey.
 *
 * A: ALL EIGHT STAGES ON ONE LINE, in the order a garment moves. A stage with work in the
 * period is a lit circle with its figure; the line fills from the first lit stage to the
 * last; Packing lights green (made). The stuck stage — the biggest drop in pieces from one
 * making stage to the next — turns amber, with one sentence saying where to go.
 *
 * C: WHEN NOTHING IS RECORDED, SAY SO. Eight zeros is not a picture. The card says "No
 * production recorded this week" and offers the two things that help: enter production, or
 * look at a wider period.
 *
 * A stage that is not tracked keeps its place as a dashed circle and says so; nothing is
 * invented. Server-rendered; motion is the `dash-*` CSS in globals.css.
 */
export function ProductionFlow({
  stages,
  period,
  widerHref,
}: {
  stages: StageRow[];
  /** "today" / "this week" / … — for the empty sentence. */
  period: string;
  /** A link to the next wider period, offered when nothing is recorded; null at Month or Custom. */
  widerHref: { href: string; label: string } | null;
}) {
  const nodes = ROUTE.map((r) => {
    const s = stages.find((x) => x.key === r.key);
    const d = s?.data.ok ? s.data.value : null;
    // The figure on the circle is the headline's number ("1.2K pcs" → "1.2K", "4 running" → "4").
    const fig = d ? d.headline.split(" ")[0] : null;
    const on = !!fig && fig !== "0";
    const pieces = d?.pieces?.good ?? null;
    return { ...r, stage: s, d, fig, on, pieces };
  }).filter((n) => n.stage);

  const anyOn = nodes.some((n) => n.on);

  // The stuck stage, among the making stages only (they count the same unit).
  const making = nodes.filter((n) => PIECE_STAGES.includes(n.key));
  let stuckKey: string | null = null;
  let gap = 0;
  let stuckNext = "";
  for (let i = 0; i < making.length - 1; i++) {
    const a = making[i].pieces;
    const b = making[i + 1].pieces;
    if (a == null || b == null) continue;
    if (a - b > gap) {
      gap = a - b;
      stuckKey = making[i].key;
      stuckNext = making[i + 1].short;
    }
  }
  const maxPieces = Math.max(1, ...making.map((n) => n.pieces ?? 0));
  if (gap < maxPieces * 0.1) stuckKey = null;

  if (!anyOn) {
    return (
      <div className="flex h-full min-h-0 items-center gap-4 px-4 py-3">
        {/* A still spool: nothing is moving, and the card says so instead of drawing zeros. */}
        <span
          aria-hidden
          className="relative grid size-16 shrink-0 place-items-center rounded-full bg-[var(--glass-track)] after:absolute after:inset-2 after:rounded-full after:border-[3px] after:border-dashed after:border-primary/35"
        >
          <span className="size-5 rounded-full bg-surface" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-heading">No production recorded {period}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            No cutting, sewing or packing entries, and no yarn or fabric issued. When work is entered, the route appears here.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href="/production" className="rounded-control border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-primary hover:bg-surface-muted">
              Enter production ›
            </Link>
            {widerHref && (
              <Link href={widerHref.href} className="rounded-control border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-primary hover:bg-surface-muted">
                {widerHref.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const first = nodes.findIndex((n) => n.on);
  const last = nodes.length - 1 - [...nodes].reverse().findIndex((n) => n.on);
  const step = 100 / nodes.length; // each node sits in the middle of its column
  const lineLeft = step * first + step / 2;
  const lineWidth = step * (last - first);

  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-2 px-3 py-2">
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}>
        {/* The route: a faint rail end to end, filled where work has reached. */}
        <span aria-hidden className="absolute top-[19px] h-[3px] rounded-full bg-[var(--glass-track)]" style={{ left: `${step / 2}%`, right: `${step / 2}%` }} />
        {lineWidth > 0 && (
          <span aria-hidden className="dash-grow absolute top-[19px] h-[3px] rounded-full" style={{ left: `${lineLeft}%`, width: `${lineWidth}%`, background: toneGrad("primary", 90) }}>
            {/* Work moving along the lit part of the route — only when there is a lit part. */}
            <span className="dash-travel absolute -top-[3px] size-2.5 rounded-[3px] bg-surface shadow-[0_0_0_2px_var(--primary)]" style={{ ["--dash-speed" as string]: "3s" }} />
          </span>
        )}
        {nodes.map((n, i) => {
          const stuck = n.key === stuckKey;
          const made = n.key === "packing" && n.on;
          const tracked = !!n.d;
          return (
            <div
              key={n.key}
              className="relative flex min-w-0 flex-col items-center gap-0.5 text-center"
              title={n.d ? `${n.stage!.name}: ${n.d.headline} · ${n.d.sub}` : `${n.stage!.name}: not tracked`}
            >
              {stuck && <span aria-hidden className="dash-ripple absolute top-0 size-10 rounded-full border-2 border-[var(--warning)]" />}
              <span
                className={cn(
                  "dash-rise relative z-[1] grid size-10 place-items-center rounded-full border-2 text-[11px] font-bold tabular-nums",
                  !tracked && "border-dashed border-border bg-surface text-muted-foreground",
                  tracked && !n.on && "border-[var(--glass-track)] bg-surface text-muted-foreground",
                  n.on && "border-transparent text-white shadow-[0_6px_14px_-6px_var(--primary)]",
                )}
                style={{
                  ...(n.on ? { background: toneGrad(stuck ? "warning" : made ? "success" : "primary") } : {}),
                  animationDelay: `${i * 70}ms`,
                }}
              >
                {tracked ? n.fig : "—"}
              </span>
              <span className="w-full truncate text-[11px] font-medium leading-tight text-foreground">{n.short}</span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{tracked ? n.group : "not tracked"}</span>
            </div>
          );
        })}
      </div>
      <p className={cn("text-[11.5px] leading-snug", stuckKey ? "text-muted-foreground" : "text-muted-foreground")}>
        {stuckKey ? (
          <>
            <b className="text-warning">{nodes.find((n) => n.key === stuckKey)?.short} is holding the most work:</b>{" "}
            {fmtCompactNumber(gap)} pcs not yet at {stuckNext}.
          </>
        ) : (
          `Work is moving along the route ${period}.`
        )}
      </p>
    </div>
  );
}
