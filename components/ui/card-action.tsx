"use client";

import { createContext, useState, type ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  CircleCheck,
  CircleX,
  Eye,
  FileText,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A CARD'S ACTION ICON — EVERY CARD, ONE SHAPE (user 2026-10-23, screenshot
 * 2026-10-21 152304: "ellam place layum card kku globle aa intha mari icon venum").
 *
 * The Sample Costing card's duotone row — a soft filled shape under a crisp stroke,
 * each action in its OWN colour, in a 34×30 tile — drawn once here so
 * `CostingCard`, `MobileCardList`'s footer and any `RowIconAction` placed in a card
 * footer are the same buttons. Before this the costing card had them and every
 * other card drew plain grey lucide icons or words.
 *
 * A blocked action keeps its own colour, faded, with the reason in the tooltip
 * (AGENTS "Row actions": greyed, saying why; only a missing PERMISSION hides one).
 */

/** Set by a card's footer: a `RowIconAction` inside it draws as a `CardAction`. */
export const CardActionContext = createContext(false);

export type CardTone = "success" | "danger" | "info" | "violet" | "primary" | "teal" | "warning";

/* Static literals (Tailwind scans source text). */
const TONE: Record<CardTone, string> = {
  success: "text-success hover:bg-success/10",
  danger: "text-danger hover:bg-danger/10",
  info: "text-info hover:bg-info/10",
  violet: "text-violet-600 hover:bg-violet-500/10 dark:text-violet-400",
  primary: "text-primary hover:bg-primary/10",
  teal: "text-teal-600 hover:bg-teal-500/10 dark:text-teal-400",
  warning: "text-warning hover:bg-warning/10",
};

export function CardAction({
  label,
  icon,
  tone,
  onClick,
  reason,
  disabled = false,
}: {
  /** Tooltip text and aria-label. */
  label: string;
  icon: ReactNode;
  tone: CardTone;
  onClick?: () => void;
  /** Set it and the tile stays, faded, saying why. */
  reason?: string | null;
  /** Busy (a pending save) — not a reason, so no tooltip change. */
  disabled?: boolean;
}) {
  const blocked = !!reason;
  const cls = TONE[tone];
  return (
    <Tooltip label={reason ?? label} touch={blocked}>
      {/* button-shape: exempt -- a 34×30 duotone icon tile in a card's action row, the approved mock-up's shape */}
      <button
        type="button"
        aria-label={blocked ? `${label} — ${reason}` : label}
        aria-disabled={blocked || undefined}
        disabled={disabled}
        onClick={blocked ? undefined : onClick}
        className={cn(
          "inline-flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded-[10px] transition-[background-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
          // A blocked action keeps its OWN colour, faded (user 2026-10-21, screenshot
          // 152705: grey here read as "no colour"); only hover is dropped.
          blocked
            ? cn(cls.split(" ").filter((c) => !c.includes("hover:")).join(" "), "cursor-not-allowed opacity-45")
            : cn(cls, "hover:-translate-y-px active:scale-95"),
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/**
 * The bin with its two-step confirm, in the card's row: the tile swaps for
 * "Delete? Cancel · Delete" — no single-click deletes.
 */
export function CardDeleteAction({
  onConfirm,
  reason,
  isPending = false,
  label = "Delete",
}: {
  onConfirm: () => void;
  reason?: string | null;
  isPending?: boolean;
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming && !reason) {
    return (
      <span className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">{label}?</span>
        <button type="button" className="h-7 rounded-control px-2 text-xs font-semibold text-muted-foreground hover:bg-surface-muted" onClick={() => setConfirming(false)}>
          Cancel
        </button>
        <button
          type="button"
          disabled={isPending}
          className="h-7 rounded-control bg-danger px-2 text-xs font-semibold text-white disabled:opacity-60"
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
        >
          {isPending ? "…" : label}
        </button>
      </span>
    );
  }
  return <CardAction label={label} tone="danger" icon={DUO.bin} reason={reason} onClick={() => setConfirming(true)} />;
}

/* THE DUOTONE SET: a soft filled shape under a crisp stroke, both in the button's colour. */
const FILL = { fill: "currentColor", fillOpacity: 0.16, stroke: "none" } as const;
function Duo({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const DOC = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z";
const EYE = "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z";
const PLANE = "M22 2 11 13M22 2l-7 20-4-9-9-4Z";
const PENCIL = "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z";
export const DUO = {
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
  /* The UNDO arrow in a ringed circle (user 2026-10-23, artifact "Costing Card —
     Duplicates Removed": "tick and undo icon venum") — Raise Revise. */
  redo: (
    <Duo>
      <circle cx="12" cy="12" r="10" {...FILL} />
      <circle cx="12" cy="12" r="10" />
      <path d="M9 8.5 6.5 11 9 13.5" />
      <path d="M6.5 11h7a3.5 3.5 0 0 1 0 7h-2" />
    </Duo>
  ),
  bin: (
    <Duo>
      <path d="M5 6h14l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z" {...FILL} />
      <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
    </Duo>
  ),
  eye: (
    <Duo>
      <path d={EYE} {...FILL} />
      <path d={EYE} />
      <circle cx="12" cy="12" r="3" />
    </Duo>
  ),
  send: (
    <Duo>
      <path d="M22 2l-7 20-4-9-9-4Z" {...FILL} />
      <path d={PLANE} />
    </Duo>
  ),
  edit: (
    <Duo>
      <path d={PENCIL} {...FILL} />
      <path d={PENCIL} />
    </Duo>
  ),
};

/**
 * A lucide icon's duotone twin and its colour, for the call sites that name an icon
 * (`RowIconAction`, `MobileCardList`'s `sendIcon`). An icon with no twin is drawn
 * as itself in the tile, in `fallback`'s colour — never dropped, never guessed.
 */
const TWINS = new Map<LucideIcon, { glyph: ReactNode; tone: CardTone }>([
  [Check, { glyph: DUO.ok, tone: "success" }],
  [CircleCheck, { glyph: DUO.ok, tone: "success" }],
  [CheckCircle2, { glyph: DUO.ok, tone: "success" }],
  [X, { glyph: DUO.no, tone: "danger" }],
  [CircleX, { glyph: DUO.no, tone: "danger" }],
  [XCircle, { glyph: DUO.no, tone: "danger" }],
  [FileText, { glyph: DUO.doc, tone: "violet" }],
  [RotateCcw, { glyph: DUO.redo, tone: "info" }],
  [Trash2, { glyph: DUO.bin, tone: "danger" }],
  [Eye, { glyph: DUO.eye, tone: "teal" }],
  [Send, { glyph: DUO.send, tone: "primary" }],
  [Pencil, { glyph: DUO.edit, tone: "primary" }],
]);

export function duoFor(Icon: LucideIcon | undefined, fallback: CardTone = "primary"): { glyph: ReactNode; tone: CardTone } {
  const twin = Icon ? TWINS.get(Icon) : undefined;
  if (twin) return twin;
  return { glyph: Icon ? <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" /> : null, tone: fallback };
}

/** A caller's colour class (`text-success`, `text-danger` …) read as a tone. */
export function toneFromClass(className: string | undefined, danger = false): CardTone | undefined {
  if (danger) return "danger";
  const c = className ?? "";
  if (/\btext-success\b|emerald|green/.test(c)) return "success";
  if (/\btext-danger\b|red-/.test(c)) return "danger";
  if (/\btext-info\b|sky|blue/.test(c)) return "info";
  if (/\btext-warning\b|amber/.test(c)) return "warning";
  if (/violet|purple/.test(c)) return "violet";
  if (/\btext-primary\b/.test(c)) return "primary";
  return undefined;
}
