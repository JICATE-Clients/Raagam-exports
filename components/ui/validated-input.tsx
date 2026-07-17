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
}

/**
 * Drop-in replacement for <Input> that adds format validation. On change it
 * applies the format's transform (uppercase / digits-only); on blur it shows an
 * inline error below the field when the value doesn't match. Keeps the exact
 * value/onChange contract of <Input>, so wiring a field is a one-line swap. The
 * authoritative check still runs server-side via the shared Zod refinements.
 */
export const ValidatedInput = forwardRef<HTMLInputElement, ValidatedInputProps>(
  ({ format, onChange, onBlur, value, className, inputMode, maxLength, ...props }, ref) => {
    const [touched, setTouched] = useState(false);
    const spec = format ? FORMATS[format] : undefined;
    const strVal = value == null ? "" : String(value);
    const error = format && touched ? validateFormat(format, strVal) : null;

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
