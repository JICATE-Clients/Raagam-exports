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
      // Pressing Enter on an invalid field must NOT save — the shared
      // `enterAdvances` guard blocks the COMMIT via aria-invalid (live below),
      // and we reveal the message here so the user sees why nothing happened,
      // even if the field hadn't been blurred yet (client 2026-07-24).
      //
      // Enter still MOVES off an invalid field: aria-invalid is live for every
      // required-but-empty box, so refusing to move would cage the operator in
      // the first blank field of every form. Revealing the message on the way
      // past is the point of this handler.
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
          // Live, so `enterAdvances` refuses to COMMIT the instant the value is
          // invalid — before blur. Display (border/message) stays gated on
          // `shownError`.
          aria-invalid={liveError ? true : undefined}
          // The DISPLAY half of the CAPS rule, for `upper` kinds only (GSTIN,
          // PAN, TAN, CIN, IEC, IFSC, SWIFT, currency, yarn_count).
          // `handleChange` above already uppercases keystrokes, but a value
          // loaded from the DB and never re-typed kept whatever case it was
          // saved with — a PAN entered before this field had a format still
          // rendered lowercase. `Input`'s `uppercase` prop carries the CSS
          // text-transform that fixes those without touching stored data.
          //
          // Scoped to `transform === "upper"` on purpose: email and website are
          // `transform: "none"` (formats.ts) because their case is significant
          // or simply not ours to change.
          uppercase={spec?.transform === "upper"}
          className={cn(shownError && "border-danger", className)}
          {...props}
        />
        {shownError && <p className="mt-1 text-xs text-danger">{shownError}</p>}
      </>
    );
  },
);
ValidatedInput.displayName = "ValidatedInput";
