import { z } from "zod";

// ============================================================================
// Shared master-data format validators (Indian statutory + contact formats).
// Single source of truth consumed by BOTH the server-side Zod schemas
// (authoritative) and the client-side <ValidatedInput> (inline feedback).
// Format-regex only — no checksums/cross-field checks in v1. Every rule
// tolerates null/empty (forms send `field.trim() || null`) and validates a
// value only when it is non-empty.
// ============================================================================

// ---------- regex constants ----------
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
export const AADHAAR_RE = /^[2-9][0-9]{11}$/;
export const CIN_RE = /^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$/;
export const IEC_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const UAN_RE = /^[0-9]{12}$/;
export const ESI_RE = /^[0-9]{17}$/;

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
export const MICR_RE = /^[0-9]{9}$/;
export const BANK_ACCT_RE = /^[0-9]{9,18}$/;

export const PINCODE_IN_RE = /^[1-9][0-9]{5}$/;
export const MOBILE_IN_RE = /^[6-9][0-9]{9}$/;
export const LANDLINE_IN_RE = /^0?[0-9]{2,5}[- ]?[0-9]{6,8}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const WEBSITE_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/;
export const ISD_RE = /^\+?[0-9]{1,4}$/;

export const HSN_RE = /^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/;
export const GST_STATE_RE = /^(0[1-9]|[1-2][0-9]|3[0-8])$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;

/** GST rate slabs applicable in India (garment-relevant: 5 & 12). */
export const GST_RATE_SLABS = [0, 0.25, 3, 5, 12, 18, 28] as const;

// ---------- client-side format metadata ----------
export type FormatKind =
  | "gstin"
  | "pan"
  | "tan"
  | "aadhaar"
  | "cin"
  | "iec"
  | "uan"
  | "esi"
  | "ifsc"
  | "swift"
  | "micr"
  | "account"
  | "pincode"
  | "mobile"
  | "landline"
  | "email"
  | "website"
  | "isd"
  | "hsn"
  | "gst_state"
  | "currency";

/** How the client input should coerce keystrokes before storing/validating. */
export type Transform = "upper" | "digits" | "none";

interface FormatSpec {
  re: RegExp;
  message: string;
  transform: Transform;
  inputMode?: "text" | "numeric" | "tel" | "email";
  maxLength?: number;
  /** Strip these leading tokens before testing (e.g. +91/0 on a mobile). */
  strip?: RegExp;
}

export const FORMATS: Record<FormatKind, FormatSpec> = {
  gstin: { re: GSTIN_RE, message: "Invalid GSTIN (e.g. 33ABCDE1234F1Z5)", transform: "upper", inputMode: "text", maxLength: 15 },
  pan: { re: PAN_RE, message: "Invalid PAN (e.g. ABCDE1234F)", transform: "upper", inputMode: "text", maxLength: 10 },
  tan: { re: TAN_RE, message: "Invalid TAN (e.g. RAJA99999B)", transform: "upper", inputMode: "text", maxLength: 10 },
  aadhaar: { re: AADHAAR_RE, message: "Aadhaar must be 12 digits", transform: "digits", inputMode: "numeric", maxLength: 12 },
  cin: { re: CIN_RE, message: "Invalid CIN (21 characters)", transform: "upper", inputMode: "text", maxLength: 21 },
  iec: { re: IEC_RE, message: "Invalid IEC (10 characters)", transform: "upper", inputMode: "text", maxLength: 10 },
  uan: { re: UAN_RE, message: "UAN must be 12 digits", transform: "digits", inputMode: "numeric", maxLength: 12 },
  esi: { re: ESI_RE, message: "ESI number must be 17 digits", transform: "digits", inputMode: "numeric", maxLength: 17 },
  ifsc: { re: IFSC_RE, message: "Invalid IFSC (e.g. HDFC0001234)", transform: "upper", inputMode: "text", maxLength: 11 },
  swift: { re: SWIFT_RE, message: "Invalid SWIFT/BIC (8 or 11 characters)", transform: "upper", inputMode: "text", maxLength: 11 },
  micr: { re: MICR_RE, message: "MICR must be 9 digits", transform: "digits", inputMode: "numeric", maxLength: 9 },
  account: { re: BANK_ACCT_RE, message: "Account number must be 9–18 digits", transform: "digits", inputMode: "numeric", maxLength: 18 },
  pincode: { re: PINCODE_IN_RE, message: "Enter a 6-digit PIN code", transform: "digits", inputMode: "numeric", maxLength: 6 },
  mobile: { re: MOBILE_IN_RE, message: "Enter a 10-digit mobile (starting 6–9)", transform: "digits", inputMode: "numeric", maxLength: 10, strip: /^(\+?91|0)/ },
  landline: { re: LANDLINE_IN_RE, message: "Enter a valid landline number", transform: "none", inputMode: "tel", maxLength: 15 },
  email: { re: EMAIL_RE, message: "Enter a valid email address", transform: "none", inputMode: "email" },
  website: { re: WEBSITE_RE, message: "Enter a valid website URL", transform: "none", inputMode: "text" },
  isd: { re: ISD_RE, message: "Enter a valid ISD code (e.g. +91)", transform: "none", inputMode: "tel", maxLength: 5 },
  hsn: { re: HSN_RE, message: "HSN/SAC must be 4, 6 or 8 digits", transform: "digits", inputMode: "numeric", maxLength: 8 },
  gst_state: { re: GST_STATE_RE, message: "Enter a 2-digit GST state code (01–38)", transform: "digits", inputMode: "numeric", maxLength: 2 },
  currency: { re: CURRENCY_RE, message: "Enter a 3-letter ISO currency code (e.g. INR)", transform: "upper", inputMode: "text", maxLength: 3 },
};

/** Apply a format's keystroke transform (uppercase / digits-only). */
export function applyTransform(kind: FormatKind, raw: string): string {
  const t = FORMATS[kind].transform;
  if (t === "upper") return raw.toUpperCase();
  if (t === "digits") return raw.replace(/\D/g, "");
  return raw;
}

/**
 * Validate a value against a format. Returns an error message, or null when the
 * value is valid OR empty (empty is always allowed — required-ness is separate).
 */
export function validateFormat(kind: FormatKind, value: string | null | undefined): string | null {
  const spec = FORMATS[kind];
  const v = (value ?? "").trim();
  if (!v) return null;
  const normalized = spec.strip ? v.replace(spec.strip, "") : v;
  return spec.re.test(normalized) ? null : spec.message;
}

// ---------- server-side Zod helpers ----------
/**
 * An optional, null-tolerant text field constrained to a format. Empty/null
 * pass; a present value must match `re`. Mirrors the `nullableText` idiom.
 */
export function nullableFormat(re: RegExp, message: string) {
  return z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => !v || re.test(v), { message });
}

/** A required text field constrained to a format. */
export function requiredFormat(re: RegExp, message: string) {
  return z.string().trim().min(1, message).regex(re, message);
}

/** GST slab whitelist (percentage), null-tolerant. */
export function gstRate() {
  return z.coerce
    .number()
    .refine((v) => (GST_RATE_SLABS as readonly number[]).includes(v), {
      message: "GST rate must be one of 0, 0.25, 3, 5, 12, 18, 28",
    })
    .nullable()
    .default(null);
}
