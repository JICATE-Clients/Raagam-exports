"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { Truncated } from "@/components/ui/truncated";
import { buyerInitials, buyerTint } from "@/lib/ui/buyer-glow";
import { cn } from "@/lib/utils";

/**
 * A SAMPLE COSTING CARD (user 2026-10-21, "Card Glow Styles" option 1 with the
 * duotone action row — screenshot 2026-10-21 095215: "apply this").
 *
 * White card, and the only colour is the BUYER'S (`buyerTint`): a soft shadow
 * of it under the card that deepens and lifts on hover, a hint of it in the
 * border, the avatar's wash and the "Start costing →" link. Top line: the
 * number in a chip, then what the card is waiting on. Then the buyer, the
 * style, the figures once there is a sheet, and the five actions in ONE fixed
 * row — Approve · Reject · Report · Revise · Delete — so every card's icons
 * line up down the grid. An action that does not apply to this card stays,
 * greyed, with its reason in the tooltip (AGENTS "Row actions"); only a
 * missing PERMISSION removes one (`del` null).
 */

/** One footer action: what a click does, or why it cannot. */
export type CardAction = { onClick: () => void; reason?: string | null };

export function CostingCard({
  code,
  buyer,
  sub,
  mark,
  start,
  figures,
  onOpen,
  approve,
  reject,
  report,
  revise,
  del,
  isPending = false,
}: {
  code: string;
  buyer: string | null;
  sub: string;
  /** The state icon at the top right (a tooltip names it). */
  mark: ReactNode;
  /** A sample with no sheet yet: the top line offers "Start costing →". */
  start?: boolean;
  /** Quoted · Margin · Date — omitted while there is nothing to show. */
  figures?: { label: string; value: string }[];
  onOpen?: () => void;
  approve: CardAction;
  reject: CardAction;
  report: CardAction;
  revise: CardAction;
  /** null = no delete permission, so no bin. */
  del: (CardAction & { onClick: () => void }) | null;
  isPending?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const tint = buyerTint(buyer);
  return (
    <div
      style={{ "--ink": tint.ink, "--glow": tint.glow } as CSSProperties}
      className={cn(
        "group flex min-w-0 flex-col rounded-2xl border bg-surface",
        "border-[color-mix(in_srgb,var(--ink)_22%,var(--border))]",
        "shadow-[0_14px_30px_-14px_color-mix(in_srgb,var(--glow)_80%,transparent)]",
        "transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]",
        "hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--ink)_50%,var(--border))] hover:shadow-[0_22px_40px_-14px_var(--glow)]",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex w-full flex-1 flex-col gap-2 rounded-t-2xl px-3 pb-2 pt-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <div className="flex w-full items-center gap-2">
          <span className="shrink-0 rounded-md border border-border bg-surface px-1.5 py-px font-mono text-xs font-medium text-foreground">
            {code}
          </span>
          {start && (
            <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold text-[var(--ink)] transition-[gap] group-hover:gap-2.5 dark:text-[color-mix(in_srgb,var(--ink)_55%,white)]">
              Start costing <span aria-hidden="true">→</span>
            </span>
          )}
          <span className={cn("flex shrink-0", !start && "ml-auto")}>{mark}</span>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--glow)_18%,var(--surface))] text-[11.5px] font-bold text-[var(--ink)] dark:text-[color-mix(in_srgb,var(--ink)_55%,white)]"
          >
            {buyerInitials(buyer)}
          </span>
          <span className="grid min-w-0 flex-1">
            <Truncated className="text-sm font-semibold leading-tight text-foreground" touch={false}>
              {buyer ?? "—"}
            </Truncated>
            <Truncated className="font-mono text-xs leading-snug text-muted-foreground" touch={false}>
              {sub}
            </Truncated>
          </span>
        </div>
        {figures && figures.length > 0 && (
          <dl className="grid w-full grid-cols-[1.2fr_1fr_1.2fr] gap-1.5">
            {figures.map((f) => (
              <div key={f.label} className="grid min-w-0 gap-px">
                <dt className="text-[10.5px] font-bold uppercase leading-tight tracking-wider text-muted-foreground">{f.label}</dt>
                {/* truncate-reveal: exempt -- a figure (money, %, a date) fits a 15rem card; a tap opens the costing */}
                <dd className="truncate text-sm font-bold leading-tight tabular-nums text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </button>
      <div className="mx-3 flex min-h-10 items-center justify-between gap-1 border-t border-[color-mix(in_srgb,var(--ink)_15%,var(--border))] py-1">
        {confirming && del ? (
          <>
            <span className="text-xs text-muted-foreground">Delete this costing?</span>
            <span className="flex gap-1">
              <button type="button" className="h-7 rounded-control px-2 text-xs font-semibold text-muted-foreground hover:bg-surface-muted" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                className="h-7 rounded-control bg-danger px-2 text-xs font-semibold text-white disabled:opacity-60"
                onClick={() => {
                  setConfirming(false);
                  del.onClick();
                }}
              >
                {isPending ? "…" : "Delete"}
              </button>
            </span>
          </>
        ) : (
          <>
            <Act label="Customer Approved" action={approve} tone="text-success hover:bg-success/10" icon={ICON.ok} />
            <Act label="Customer Rejected" action={reject} tone="text-danger hover:bg-danger/10" icon={ICON.no} />
            {/* Every icon carries its own colour (user 2026-10-21, screenshot 152304):
                Reports was ink-black and Delete grey, the two the eye skipped. Violet
                is the one hue not already saying approve / reject / revise. */}
            <Act label="Reports" action={report} tone="text-violet-600 hover:bg-violet-500/10 dark:text-violet-400" icon={ICON.doc} />
            <Act label="Raise Revise" action={revise} tone="text-info hover:bg-info/10" icon={ICON.redo} />
            {del && (
              <Act
                label="Delete"
                action={{ reason: del.reason, onClick: () => setConfirming(true) }}
                tone="text-danger hover:bg-danger/10"
                icon={ICON.bin}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Act({ label, action, tone, icon }: { label: string; action: CardAction; tone: string; icon: ReactNode }) {
  const blocked = !!action.reason;
  return (
    <Tooltip label={action.reason ?? label} touch={blocked}>
      {/* button-shape: exempt -- a 34×30 duotone icon tile in the card's action row, the approved mock-up's shape */}
      <button
        type="button"
        aria-label={blocked ? `${label} — ${action.reason}` : label}
        aria-disabled={blocked || undefined}
        onClick={blocked ? undefined : action.onClick}
        className={cn(
          "inline-flex h-[30px] w-[34px] items-center justify-center rounded-[10px] transition-[background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // A blocked action keeps its OWN colour, faded (user 2026-10-21, screenshot
          // 152705: grey here read as "no colour"). The fade, the not-allowed cursor
          // and the tooltip's reason still say it cannot be used; only hover is dropped.
          blocked
            ? cn(tone.split(" ").filter((c) => !c.includes("hover:")).join(" "), "cursor-not-allowed opacity-45")
            : cn(tone, "hover:-translate-y-px active:scale-95"),
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/* THE DUOTONE SET (option E of the same mock-up): a soft filled shape under a
   crisp stroke, both in the button's own colour. */
const FILL = { fill: "currentColor", fillOpacity: 0.16, stroke: "none" } as const;
function Duo({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const DOC = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z";
const ICON = {
  ok: (
    <Duo>
      <circle cx="12" cy="12" r="10" {...FILL} />
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.8 2.8L16.5 9" />
    </Duo>
  ),
  no: (
    <Duo>
      <circle cx="12" cy="12" r="10" {...FILL} />
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </Duo>
  ),
  doc: (
    <Duo>
      <path d={DOC} {...FILL} />
      <path d={DOC} />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8" />
    </Duo>
  ),
  redo: (
    <Duo>
      <circle cx="12" cy="12" r="10" {...FILL} />
      <path d="M7.5 12a4.5 4.5 0 1 0 1.3-3.2L7.5 10" />
      <path d="M7.5 7v3h3" />
    </Duo>
  ),
  bin: (
    <Duo>
      <path d="M5 6h14l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z" {...FILL} />
      <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
    </Duo>
  ),
};
