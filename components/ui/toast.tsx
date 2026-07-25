"use client";

import {
  createContext,
  useCallback,
  useContext,
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
      /*
       * Errors do NOT auto-dismiss. A save that failed and then silently cleared
       * itself after four seconds is the worst case in a data-entry app: the
       * operator moves on believing the record was written. Successes are
       * self-evident from the list updating, so those still expire.
       */
      if (tone !== "error") setTimeout(() => remove(id), 4000);
    },
    [remove],
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
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md",
            toneClass[t.tone],
          )}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {/* Errors persist until dismissed, so they need a way out. */}
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="-mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
