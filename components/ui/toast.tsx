"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
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
      setTimeout(() => remove(id), 4000);
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
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-md",
              toneClass[t.tone],
            )}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
