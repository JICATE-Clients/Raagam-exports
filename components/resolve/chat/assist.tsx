import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClipboardList,
  KeyRound,
  Laptop,
  MessageSquareWarning,
  ShoppingCart,
  Sparkles,
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
    sub: "Pay, behaviour, conditions — can be anonymous",
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
    <div className="flex max-w-[92%] items-end gap-2">
      <AgentAvatar />
      <div
        className={cn(
          "rounded-[14px_14px_14px_4px] border border-border bg-surface px-3 py-2.5 text-[15px] leading-[21px] shadow-sm",
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
        "max-w-[82%] self-end whitespace-pre-line rounded-[14px_4px_14px_14px] px-3 py-2.5 text-[15px] leading-[21px] text-white shadow-sm",
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
    <div className="flex items-center gap-3 rounded-t-none border-b border-border bg-gradient-to-r from-sky-50 via-cyan-50 to-emerald-50 px-4 py-3 md:rounded-t-2xl dark:from-sky-500/10 dark:via-cyan-500/10 dark:to-emerald-500/10">
      <AgentAvatar size="md" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold leading-5">{AGENT_NAME}</span>
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
export function AssistLayout({ children, replyMinutes }: { children: ReactNode; replyMinutes?: number }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] md:items-start">
      <aside className="hidden flex-col gap-5 rounded-2xl border border-border bg-gradient-to-b from-sky-50 via-cyan-50/60 to-emerald-50 p-5 md:sticky md:top-4 md:flex dark:from-sky-500/10 dark:via-cyan-500/5 dark:to-emerald-500/10">
        <div className="flex flex-col items-start gap-3">
          <AgentAvatar size="lg" />
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold leading-6">{AGENT_NAME}</h2>
            <p className="text-sm leading-5 text-muted-foreground">
              Tell me what happened in your own words. I find the right person, and you can follow it to the end.
            </p>
          </div>
          {replyMinutes ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium text-emerald-800 shadow-sm dark:bg-background/60 dark:text-emerald-300">
              <span className="size-2 rounded-full bg-emerald-600" aria-hidden="true" />
              IT desk replies in about {replyMinutes} min
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">I can help with</span>
          {(Object.keys(ROUTE_LOOK) as AssistRoute[]).map((k) => {
            const r = ROUTE_LOOK[k];
            return (
              <div key={k} className="flex items-center gap-2.5">
                <span className={cn("flex size-8 flex-none items-center justify-center rounded-lg", r.tile)}>
                  <r.icon className="size-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium">{r.label}</span>
              </div>
            );
          })}
        </div>

        <FollowUp className="flex-col items-start gap-2 border-t border-border/70 pt-4" />
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        {children}
        <FollowUp className="justify-center gap-x-6 gap-y-2 md:hidden" />
      </div>
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
      <Link href="/resolve/my-complaints" className={link}>
        <MessageSquareWarning className="size-4" aria-hidden="true" />
        My Complaints
      </Link>
      <Link href="/p/track" className={link}>
        <KeyRound className="size-4" aria-hidden="true" />
        Track an anonymous complaint
      </Link>
    </nav>
  );
}

/**
 * The bar the answers sit in — docked above the phone tab bar (main keeps
 * 4.5rem + inset clear for it), at the panel's foot on a desktop.
 */
export const ANSWER_BAR =
  "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2.5 border-t border-border bg-surface px-3 py-3 md:bottom-0 md:rounded-b-2xl";

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
        "flex min-h-14 items-start gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-surface-muted hover:shadow focus-visible:outline-2 focus-visible:outline-ring",
        ring,
      )}
    >
      {Icon && (
        <span className={cn("flex size-9 flex-none items-center justify-center rounded-lg", tile ?? "bg-primary-soft text-primary")}>
          <Icon className="size-5" aria-hidden="true" />
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
