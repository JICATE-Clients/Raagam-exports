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
  ({ format, requiredMessage, onChange, onBlur, value, className, inputMode, maxLength, required, ...props }, ref) => {
    const [touched, setTouched] = useState(false);
    const spec = format ? FORMATS[format] : undefined;
    const strVal = value == null ? "" : String(value);
    // Empty-but-required wins over a format mismatch (there's nothing to format
    // yet); otherwise fall back to the format check once the field has a value.
    const requiredError =
      required && touched && strVal.trim() === "" ? requiredMessage ?? "Required." : null;
    const error = requiredError ?? (format && touched ? validateFormat(format, strVal) : null);

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

    return (
      <>
        <Input
          ref={ref}
          value={value}
          required={required}
          onChange={handleChange}
          onBlur={handleBlur}
          inputMode={inputMode ?? spec?.inputMode}
          maxLength={maxLength ?? spec?.maxLength}
          aria-invalid={error ? true : undefined}
          className={cn(error && "border-danger", className)}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </>
    );
  },
);
ValidatedInput.displayName = "ValidatedInput";
