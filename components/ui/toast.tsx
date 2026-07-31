"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

/**
 * How long each tone stays on screen.
 *
 * Errors used to stay FOREVER, on the reasoning that a failed save which cleared
 * itself would let the operator walk away believing the record was written. The
 * cure turned out to be worse than the disease: every error had to be closed by
 * hand, so the corner filled up with stale failures the operator had already read
 * and dealt with, and clearing them became a chore they did without reading.
 *
 * So errors expire — but on a much longer fuse than a confirmation, and the fuse
 * PAUSES while the toast is hovered or focused (see `ToastItem`). The original
 * worry is answered by the length, not by permanence: 10s is longer than it takes
 * to read one line, and a save failure also leaves the form open with the typed
 * values still in it, which is the real signal that nothing was written.
 */
const TTL_MS: Record<Tone, number> = {
  success: 4000,
  info: 4000,
  error: 10000,
};

interface ToastApi {
  toast: (message: string, tone?: Tone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback(
    (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    [],
  );

  const toast = useCallback(
    (message: string, tone: Tone = "info") => {
      const id = ++counter;
      setToasts((t) => [...t, { id, message, tone }]);
      // The countdown lives on the rendered toast, not here: a timer started at
      // this point cannot be paused when the pointer lands on the toast, and it
      // keeps running against a toast that has already been dismissed by hand.
    },
    [],
  );

  const api: ToastApi = {
    toast,
    success: (m) => toast(m, "success"),
    error: (m) => toast(m, "error"),
  };

  const toneClass: Record<Tone, string> = {
    success: "border-success bg-success-soft text-success",
    error: "border-danger bg-danger-soft text-danger",
    info: "border-info bg-info-soft text-info",
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* z-[200]: must outrank Sheet (z-90/91) and dialog pickers (z-100/101), or a Save
          error fired while one is open renders invisibly behind it. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-xs flex-col gap-2">
        {/*
         * TWO regions, both always mounted. A live region only announces nodes
         * inserted into it while it is already in the accessibility tree, so the
         * previous per-toast `role="status"` on freshly-mounted elements
         * announced unreliably or not at all — every save and every failure was
         * silent to a screen reader. Politeness can't vary per message within one
         * region, hence the split: failures interrupt, confirmations wait.
         */}
        <ToastRegion politeness="polite" toasts={toasts} tones={["success", "info"]} toneClass={toneClass} onDismiss={remove} />
        <ToastRegion politeness="assertive" toasts={toasts} tones={["error"]} toneClass={toneClass} onDismiss={remove} />
      </div>
    </ToastContext.Provider>
  );
}

function ToastRegion({
  politeness,
  toasts,
  tones,
  toneClass,
  onDismiss,
}: {
  politeness: "polite" | "assertive";
  toasts: Toast[];
  tones: Tone[];
  toneClass: Record<Tone, string>;
  onDismiss: (id: number) => void;
}) {
  const mine = toasts.filter((t) => tones.includes(t.tone));
  return (
    <div aria-live={politeness} className="flex flex-col gap-2">
      {mine.map((t) => (
        <ToastItem key={t.id} toast={t} className={toneClass[t.tone]} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/**
 * One toast, owning its own expiry.
 *
 * The timer sits here rather than in `toast()` for two reasons: it is cancelled
 * automatically by the effect cleanup when the toast is dismissed by hand, and it
 * can be PAUSED. `paused` is set while the pointer is over the toast or anything
 * inside it holds focus — an error is often the longest message the app shows, and
 * one that disappears mid-sentence is read as a glitch rather than as a message.
 *
 * Unpausing restarts the full TTL instead of resuming what was left of it. That
 * is deliberate and errs toward the reader: someone who just moved the pointer
 * away gets the whole window again to look back at it, and the alternative
 * (tracking the remaining milliseconds across pauses) buys nothing a reader would
 * notice.
 */
function ToastItem({
  toast,
  className,
  onDismiss,
}: {
  toast: Toast;
  className: string;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const { id, tone } = toast;

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(id), TTL_MS[tone]);
    return () => clearTimeout(timer);
  }, [paused, id, tone, onDismiss]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md",
        className,
      )}
    >
      <span className="min-w-0 flex-1">{toast.message}</span>
      {/* Still worth keeping now that toasts expire: it clears a stack of them
          at once, and it is the only way out for a keyboard user who has paused
          the timer by focusing the toast. */}
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
