import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A labelled form field that owns its own WIDTH.
 *
 * Every control primitive here is `w-full` (input.tsx, select.tsx,
 * combobox.tsx), so a field's width was entirely whatever grid cell it landed
 * in — a 3-character "Mixing %" inherited the same ~490px box as a free-text
 * Name (client 2026-07-24 #3). `Field` makes width a property of the field
 * instead, sized to the data it holds.
 *
 * Spans are of 12 and only apply inside a `<DetailSection cols={12}>`. The
 * classes are a static lookup, never interpolated — Tailwind v4 scans source
 * text, so a computed `sm:col-span-${n}` would produce no CSS at all.
 */
export type FieldSize = "xs" | "sm" | "md" | "lg" | "full";

const SPAN: Record<FieldSize, string> = {
  xs: "sm:col-span-2", // 2-4 chars — %, qty, a small count
  sm: "sm:col-span-3", // short codes — HSN, count, shade
  md: "sm:col-span-4", // the default — most pickers and lookups
  lg: "sm:col-span-6", // long free text — names, addresses
  full: "sm:col-span-12", // stands alone on its row — grids, textareas
};

export function Field({
  label,
  size = "md",
  required,
  hint,
  htmlFor,
  className,
  children,
}: {
  /** Omit for an unlabelled cell that still participates in the span grid. */
  label?: ReactNode;
  size?: FieldSize;
  required?: boolean;
  /** Small helper text under the control. */
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(SPAN[size], "min-w-0", className)}>
      {label != null && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </Label>
      )}
      {children}
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
