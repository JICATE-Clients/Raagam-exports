"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Input } from "./input";
import {
  validateFormat,
  applyTransform,
  FORMATS,
  type FormatKind,
} from "@/lib/validation/formats";
import { cn } from "@/lib/utils";

interface ValidatedInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Format to validate against; drives inline error + inputMode/maxLength/transform. */
  format?: FormatKind;
  /** Inline error shown on blur when the field is `required` and left empty
   *  (checklist "Required Field Indicators" — validate on leaving the field,
   *  not only on Save). Defaults to "Required." when `required` is set. */
  requiredMessage?: string;
}

/**
 * Drop-in replacement for <Input> that adds format + required validation. On
 * change it applies the format's transform (uppercase / digits-only); on blur it
 * shows an inline error below the field when the value is empty-but-required or
 * doesn't match the format. Keeps the exact value/onChange contract of <Input>,
 * so wiring a field is a one-line swap. The authoritative check still runs
 * server-side via the shared Zod refinements.
 */
export const ValidatedInput = forwardRef<HTMLInputElement, ValidatedInputProps>(
  ({ format, requiredMessage, onChange, onBlur, onKeyDown, value, className, inputMode, maxLength, required, ...props }, ref) => {
    const [touched, setTouched] = useState(false);
    const spec = format ? FORMATS[format] : undefined;
    const strVal = value == null ? "" : String(value);
    // LIVE validity — computed regardless of `touched`. Empty-but-required wins
    // over a format mismatch (nothing to format yet), else the format check.
    const liveError =
      (required && strVal.trim() === "" ? requiredMessage ?? "Required." : null) ??
      (format ? validateFormat(format, strVal) : null);
    // Visible error only once the field has been touched — so the red border and
    // message don't appear while the user is still typing the first value.
    const shownError = touched ? liveError : null;

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      if (format) {
        const t = applyTransform(format, e.target.value);
        if (t !== e.target.value) e.target.value = t;
      }
      onChange?.(e);
    }
    function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
      setTouched(true);
      onBlur?.(e);
    }
    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      // Pressing Enter on an invalid field must NOT advance — the shared
      // enterAdvance guard blocks it via aria-invalid (which is live below), and
      // we reveal the message here so the user sees why focus stayed put, even
      // if the field hadn't been blurred yet (client 2026-07-24).
      if (e.key === "Enter" && liveError) setTouched(true);
      onKeyDown?.(e);
    }

    return (
      <>
        <Input
          ref={ref}
          value={value}
          required={required}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          inputMode={inputMode ?? spec?.inputMode}
          maxLength={maxLength ?? spec?.maxLength}
          // Live, so enterAdvance blocks Enter the instant the value is invalid —
          // before blur. Display (border/message) stays gated on `shownError`.
          aria-invalid={liveError ? true : undefined}
          className={cn(shownError && "border-danger", className)}
          {...props}
        />
        {shownError && <p className="mt-1 text-xs text-danger">{shownError}</p>}
      </>
    );
  },
);
ValidatedInput.displayName = "ValidatedInput";
