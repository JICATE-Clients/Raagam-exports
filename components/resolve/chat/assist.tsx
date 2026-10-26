import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClipboardList,
  KeyRound,
  Laptop,
  MessageSquareWarning,
  ShoppingCart,
  Sparkles,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssistLane } from "@/lib/resolve/assist-types";

/**
 * RAAGAM ASSIST — the one face of Resolve Hub's chats (user 2026-10-26:
 * "colourful … as Raagam name agent"). Report a Problem (`ReportChat`) and
 * Need IT help (`ServiceChat`) both speak through these pieces, so the name,
 * the avatar, the bubbles and the colour of each kind of request are declared
 * once and cannot drift between the two.
 *
 * The four route colours are IDENTITY, not status — amber is "a broken thing",
 * not "warning" — so they live here rather than in `statusTone`.
 */
export const AGENT_NAME = "Raagam Assist";

export type AssistRoute = AssistLane;

export const ROUTE_LOOK: Record<
  AssistRoute,
  { label: string; sub: string; icon: LucideIcon; tile: string; ring: string; dot: string }
> = {
  fix: {
    label: "Fix something",
    sub: "Machine, power, water, building, safety",
    icon: Wrench,
    tile: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
    ring: "hover:border-amber-400 focus-visible:border-amber-500",
    dot: "bg-amber-500",
  },
  it: {
    label: "IT help",
    sub: "Computer, printer, network, ERP, email",
    icon: Laptop,
    tile: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300",
    ring: "hover:border-sky-400 focus-visible:border-sky-500",
    dot: "bg-sky-500",
  },
  concern: {
    label: "Raise a concern",
    sub: "Pay, people, work — you can stay anonymous",
    icon: MessageSquareWarning,
    tile: "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-300",
    ring: "hover:border-violet-400 focus-visible:border-violet-500",
    dot: "bg-violet-500",
  },
  buy: {
    label: "Buy something",
    sub: "Consumables, PPE, tools, office",
    icon: ShoppingCart,
    tile: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300",
    ring: "hover:border-emerald-400 focus-visible:border-emerald-500",
    dot: "bg-emerald-500",
  },
};

/** The avatar: Raagam's blue running into the leaf's green. */
export function AgentAvatar({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "size-16" : size === "md" ? "size-10" : "size-7";
  const icon = size === "lg" ? "size-8" : size === "md" ? "size-5" : "size-3.5";
  return (
    <span
      className={cn(
        "flex flex-none items-center justify-center rounded-full bg-gradient-to-br from-sky-600 via-cyan-500 to-emerald-500 text-white shadow-sm ring-2 ring-white dark:ring-background",
        box,
      )}
      aria-hidden="true"
    >
      <Sparkles className={icon} />
    </span>
  );
}

/** A message from Raagam Assist. */
export function Bot({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex max-w-[92%] items-end gap-2 motion-safe:animate-rise">
      <AgentAvatar />
      <div
        className={cn(
          "rounded-[14px_14px_14px_4px] border border-border bg-surface px-3 py-2 text-sm leading-5 shadow-sm",
          muted && "text-muted-foreground",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A message from the person — what they typed or tapped. */
export function Me({ children, tone }: { children: ReactNode; tone?: AssistRoute }) {
  return (
    <div
      className={cn(
        "max-w-[82%] self-end whitespace-pre-line rounded-[14px_4px_14px_14px] px-3 py-2 text-sm font-medium leading-5 text-white shadow-sm motion-safe:animate-rise",
        tone === "fix"
          ? "bg-amber-700"
          : tone === "concern"
            ? "bg-violet-700"
            : tone === "buy"
              ? "bg-emerald-700"
              : "bg-gradient-to-br from-sky-700 to-primary",
      )}
    >
      {children}
    </div>
  );
}

/** The chat panel's top bar — the agent's name and the desk's pace. */
export function AssistHeader({ status, step }: { status: ReactNode; step?: string | null }) {
  return (
    <div className="flex items-center gap-2.5 rounded-t-none border-b border-border bg-gradient-to-r from-sky-50 via-cyan-50 to-emerald-50 px-3.5 py-2 md:rounded-t-2xl dark:from-sky-500/10 dark:via-cyan-500/10 dark:to-emerald-500/10">
      <AgentAvatar size="md" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold leading-5">{AGENT_NAME}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-emerald-600" aria-hidden="true" />
          {status}
        </span>
      </div>
      {step && (
        <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-primary shadow-sm dark:bg-background/60">
          {step}
        </span>
      )}
    </div>
  );
}

/**
 * Two columns on a desktop — who Raagam Assist is on the left, the chat on the
 * right — and one column on a phone, where the chat's own header introduces it
 * and the follow-up links fall below.
 */
/** The chat's page frame — the chat alone, centred (user 2026-10-26: the
 *  intro side panel was removed, "i dont like it"). The follow-up links stay
 *  under the chat on a phone, where the sidebar is out of reach. */
export function AssistLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4">
      {children}
      <FollowUp className="justify-center gap-x-6 gap-y-2 md:hidden" />
    </div>
  );
}

function FollowUp({ className }: { className?: string }) {
  const link = "inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline";
  return (
    <nav aria-label="Follow up" className={cn("flex flex-wrap", className)}>
      <Link href="/resolve/my-reports" className={link}>
        <ClipboardList className="size-4" aria-hidden="true" />
        My Reports
      </Link>
      <Link href="/p/track" className={link}>
        <KeyRound className="size-4" aria-hidden="true" />
        Track an anonymous concern
      </Link>
    </nav>
  );
}

/**
 * The bar the answers sit in — docked above the phone tab bar (main keeps
 * 4.5rem + inset clear for it), at the panel's foot on a desktop.
 */
export const ANSWER_BAR =
  "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2 border-t border-border bg-surface px-3 py-2.5 md:bottom-0 md:rounded-b-2xl";

/** Acronyms that stay in capitals when a stored label is shown softly. */
const KEEP_CAPS = new Set(["ERP", "CCTV", "AC", "IT", "PPE", "UPS", "RO", "PC", "SIM", "ID", "OT", "PF", "ESI"]);

/**
 * A stored catalog label (CAPITALS, by the storage rule) shown in sentence case
 * on a tap answer — "Not stitching right", not a wall of block letters. Display
 * only: the value sent and stored is still the label as it is.
 */
export function softLabel(label: string): string {
  const lower = label.toLowerCase();
  return lower
    .replace(/[a-z][a-z-]*/g, (w) => (KEEP_CAPS.has(w.toUpperCase()) ? w.toUpperCase() : w))
    .replace(/^\s*[a-z]/, (c) => c.toUpperCase())
    .replace(/\bi\b/g, "I")
    .replace(/\bwi-fi\b/g, "Wi-Fi");
}

/**
 * A ONE-LINE TAP ANSWER — the chat's everyday choice: a pill with a small
 * coloured icon. Compact so a whole area's choices fit on one or two rows,
 * and it lifts under the finger so a tap reads as a tap.
 */
export function AnswerPill({
  label,
  onClick,
  icon: Icon,
  tile,
  ring,
  danger = false,
}: {
  label: ReactNode;
  onClick: () => void;
  icon?: LucideIcon;
  tile?: string;
  ring?: string;
  /** A dangerous choice: red tile and a warning glyph, whatever the lane. */
  danger?: boolean;
}) {
  const Glyph = danger ? TriangleAlert : Icon;
  return (
    // button-shape: exempt -- a pill-shaped tap answer, not an action button
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-10 w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-surface py-1.5 pr-2.5 text-left text-[13px] font-medium leading-4 shadow-sm",
        "transition duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-ring",
        Glyph ? "pl-1.5" : "pl-3",
        danger ? "border-red-200 hover:border-red-400 dark:border-red-500/30" : ring,
      )}
    >
      {Glyph && (
        <span
          className={cn(
            "flex size-7 flex-none items-center justify-center rounded-lg",
            danger ? "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300" : tile ?? "bg-primary-soft text-primary",
          )}
          aria-hidden="true"
        >
          <Glyph className="size-3.5" />
        </span>
      )}
      <span className="min-w-0">{label}</span>
    </button>
  );
}

/** A two-line tap answer ("I can't work at all / Everything is stopped"). */
export function AnswerCard({
  title,
  sub,
  onClick,
  icon: Icon,
  tile,
  ring,
}: {
  title: string;
  sub?: string | null;
  onClick: () => void;
  icon?: LucideIcon;
  /** Icon tile colours (ROUTE_LOOK[…].tile or any tinted pair). */
  tile?: string;
  ring?: string;
}) {
  return (
    // button-shape: exempt -- a two-line answer card, not an action button
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-12 items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5 py-2 text-left shadow-sm transition duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring",
        ring,
      )}
    >
      {Icon && (
        <span className={cn("flex size-8 flex-none items-center justify-center rounded-lg", tile ?? "bg-primary-soft text-primary")}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      )}
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold leading-5">{title}</span>
        {sub && <span className="text-xs leading-4 text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}

/** One line of a "here's what I'll send" card — tappable to change it. */
export function ReviewRow({
  label,
  value,
  onEdit,
  plain = false,
}: {
  label: string;
  value: ReactNode;
  onEdit?: () => void;
  /** A label of ours, not a stored value — no capitals. */
  plain?: boolean;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("whitespace-pre-line break-words text-sm font-medium", !plain && "uppercase")}>{value}</span>
      </span>
      {onEdit && <span className="text-[13px] font-semibold text-primary">Change</span>}
    </>
  );
  return onEdit ? (
    <button type="button" onClick={onEdit} className="flex min-h-13 items-center gap-2.5 border-b border-border px-3 py-2 text-left last:border-b-0">
      {body}
    </button>
  ) : (
    <div className="flex min-h-13 items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0">{body}</div>
  );
}

/** A Link drawn as the primary button (a link navigates; a Button would not). */
export const PRIMARY_LINK =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-control bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary-hover";
