import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { ROUTE_LOOK } from "@/components/resolve/chat/assist";
import type { AssistLane } from "@/lib/resolve/assist-types";
import type { ClockTone } from "@/lib/resolve/inbox-types";
import { cn } from "@/lib/utils";
import { LANE_STEPS, type StepState } from "./inbox-flow";

/** The lane's coloured icon — the same tile Raagam Assist drew when the
 *  ticket was raised, so a ticket keeps one face from raising to closing. */
export function LaneTile({ lane, size = "sm" }: { lane: AssistLane; size?: "sm" | "md" }) {
  const look = ROUTE_LOOK[lane];
  const Icon = look.icon;
  return (
    <span
      className={cn(
        "flex flex-none items-center justify-center",
        size === "md" ? "size-9 rounded-lg" : "size-7 rounded-md",
        look.tile,
      )}
      aria-hidden="true"
    >
      <Icon className={size === "md" ? "size-[18px]" : "size-[15px]"} />
    </span>
  );
}

export const CLOCK_TEXT: Record<ClockTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-danger",
  idle: "text-muted-foreground font-normal",
};

export function Clock({ tone, children }: { tone: ClockTone; children: ReactNode }) {
  return <span className={cn("whitespace-nowrap text-xs font-semibold tabular-nums", CLOCK_TEXT[tone])}>{children}</span>;
}

/**
 * A TAP CHIP — the inbox's whole vocabulary of reasons and answers. Pressed
 * shows a tick as well as the fill, so the state never rests on colour alone.
 */
export function Chip({
  pressed,
  onClick,
  children,
  tone = "plain",
  disabled = false,
}: {
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: "plain" | "note";
  disabled?: boolean;
}) {
  return (
    // button-shape: exempt -- a pill-shaped tap answer, not an action button
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={cn(
        "inline-flex min-h-8 flex-none items-center gap-1 rounded-full border px-3 py-1 text-left text-[13px] transition-colors",
        "focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        pressed
          ? "border-foreground bg-foreground text-background"
          : tone === "note"
            ? "border-transparent bg-warning-soft text-foreground hover:border-warning"
            : "border-border bg-surface text-foreground hover:border-primary hover:text-primary",
      )}
    >
      {pressed && <Check className="size-3.5" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Where the ticket is in its life — said once, in place of a status pill. */
export function StepChain({ lane, state }: { lane: AssistLane; state: StepState }) {
  if (state.stopped) {
    return <p className="text-xs font-semibold text-muted-foreground">{state.stopped}</p>;
  }
  const steps = LANE_STEPS[lane];
  return (
    <ol className="flex items-center overflow-x-auto text-xs" aria-label="Progress">
      {steps.map((name, i) => {
        const done = i < state.index;
        const now = i === state.index;
        return (
          <li key={name} className="flex flex-none items-center">
            {i > 0 && <span className={cn("mx-1.5 h-px w-4", i <= state.index ? "bg-success" : "bg-border")} />}
            <span
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap",
                done && "text-muted-foreground",
                now && "font-semibold text-foreground",
                !done && !now && "text-muted-foreground/70",
              )}
              aria-current={now ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border-[1.5px] bg-surface",
                  done && "border-success bg-success text-white",
                  now && (state.held ? "border-warning ring-2 ring-warning-soft" : "border-primary ring-2 ring-primary-soft"),
                  !done && !now && "border-border",
                )}
                aria-hidden="true"
              >
                {done ? (
                  <Check className="size-2.5" />
                ) : now ? (
                  <span className={cn("size-1.5 rounded-full", state.held ? "bg-warning" : "bg-primary")} />
                ) : null}
              </span>
              {now && state.held ? `${name} · on hold` : name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
