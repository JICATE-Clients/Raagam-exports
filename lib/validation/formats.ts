import { z } from "zod";
import { isGstinChecksumValid } from "./gstin";
import { isAadhaarChecksumValid } from "./aadhaar";

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
/** ESIC **employer** code — 17 digits. This is the factory's number, not a person's. */
export const ESI_RE = /^[0-9]{17}$/;
/**
 * ESIC **Insurance Number** ("IP number") — 10 digits, carried by the employee.
 *
 * Separate from ESI_RE and easy to conflate: an employee record holds the
 * 10-digit IP number, so validating `employees.esi_no` with the 17-digit
 * employer rule would reject every correctly-typed value and leave the record
 * unsaveable (client 2026-07-28).
 */
export const ESI_IP_RE = /^[0-9]{10}$/;

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
export const MICR_RE = /^[0-9]{9}$/;
export const BANK_ACCT_RE = /^[0-9]{9,18}$/;

export const PINCODE_IN_RE = /^[1-9][0-9]{5}$/;
export const MOBILE_IN_RE = /^[6-9][0-9]{9}$/;
export const LANDLINE_IN_RE = /^0?[0-9]{2,5}[- ]?[0-9]{6,8}$/;
// E.164-ish. Deliberately looser than MOBILE_IN_RE: customers, consignees, notify
// parties, brands and Foreign bank branches are routinely non-Indian, so the
// India-only 10-digit rule would reject valid numbers. Used for the Mobile /
// WhatsApp pair that replaced the legacy `fax` column (0353).
export const PHONE_INTL_RE = /^\+?[0-9]{7,15}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const WEBSITE_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/;
export const ISD_RE = /^\+?[0-9]{1,4}$/;

export const HSN_RE = /^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/;
export const GST_STATE_RE = /^(0[1-9]|[1-2][0-9]|3[0-8])$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;

// Yarn count: 10'S | 2/10'S | 40 DINER (integer counts only; apostrophe-S required).
export const YARN_COUNT_RE = /^(\d+(\/\d+)?'S|\d+ DINER)$/;

/** GST rate slabs applicable in India (garment-relevant: 5 & 12). */
export const GST_RATE_SLABS = [0, 0.25, 3, 5, 12, 18, 28] as const;

// ---------- client-side format metadata ----------
export type FormatKind =
  | "gstin"
  | "gstin_strict"
  | "pan"
  | "tan"
  | "aadhaar"
  | "cin"
  | "iec"
  | "uan"
  | "aadhaar_strict"
  | "esi"
  | "esi_ip"
  | "ifsc"
  | "swift"
  | "micr"
  | "account"
  | "pincode"
  | "mobile"
  | "landline"
  | "phone_intl"
  | "email"
  | "website"
  | "isd"
  | "hsn"
  | "gst_state"
  | "currency"
  | "yarn_count";

/** How the client input should coerce keystrokes before storing/validating. */
export type Transform = "upper" | "digits" | "none" | "phone";

interface FormatSpec {
  re: RegExp;
  message: string;
  transform: Transform;
  inputMode?: "text" | "numeric" | "tel" | "email";
  maxLength?: number;
  /** Strip these leading tokens before testing (e.g. +91/0 on a mobile). */
  strip?: RegExp;
  /**
   * An extra, non-regex rule (e.g. a checksum), run ONLY after `re` passes.
   * Optional: every format that omits it behaves exactly as before.
   */
  check?: (v: string) => boolean;
  /** Message shown when `check` fails; falls back to `message`. */
  checkMessage?: string;
  /**
   * How a value is canonicalised BEFORE being stored (see `normalizeForStore`).
   * Defaults to `applyTransform`, i.e. the same thing the browser does on each
   * keystroke — which is right for most kinds and dangerous for a few.
   *
   * Override when the keystroke transform is LOSSY in a way the shape rule
   * cannot catch. The test is simple: if a character the transform deletes could
   * leave a value that still satisfies `re`, the deletion is silent and the
   * kind needs its own rule. See the comment on `account` for the worked case.
   */
  normalise?: (v: string) => string;
}

/** Strip characters that are unambiguously FORMATTING, never content. */
const stripSeparators = (v: string) => v.replace(/[\s\-.()]/g, "");

export const FORMATS: Record<FormatKind, FormatSpec> = {
  gstin: { re: GSTIN_RE, message: "Invalid GSTIN (e.g. 33ABCDE1234F1Z7)", transform: "upper", inputMode: "text", maxLength: 15 },
  // Same shape rule as `gstin`, PLUS the mod-36 check digit. Deliberately a
  // SEPARATE kind rather than tightening GSTIN_RE: that regex is shared by the
  // customer/consignee/company screens AND by the server Zod schemas via
  // nullableFormat(), so hardening it would silently reject already-saved rows
  // on their next edit. Opt in per field with format="gstin_strict".
  gstin_strict: {
    re: GSTIN_RE,
    message: "Invalid GSTIN (e.g. 33ABCDE1234F1Z7)",
    transform: "upper",
    inputMode: "text",
    maxLength: 15,
    check: isGstinChecksumValid,
    checkMessage: "GSTIN check digit is wrong — re-type the number",
  },
  pan: { re: PAN_RE, message: "Invalid PAN (e.g. ABCDE1234F)", transform: "upper", inputMode: "text", maxLength: 10 },
  tan: { re: TAN_RE, message: "Invalid TAN (e.g. RAJA99999B)", transform: "upper", inputMode: "text", maxLength: 10 },
  aadhaar: { re: AADHAAR_RE, message: "Aadhaar must be 12 digits", transform: "digits", inputMode: "numeric", maxLength: 12 },
  // Shape PLUS the Verhoeff check digit. Separate kind for the same reason
  // `gstin_strict` is separate from `gstin`: Employee Aadhaar has been stored
  // completely unvalidated until now, so an existing record may hold a number
  // that fails the checksum. Hardening `aadhaar` itself would make that employee
  // unsaveable — you could not even correct their phone number without first
  // fixing an Aadhaar you may not have to hand. Screens use `aadhaar` and show
  // the checksum failure as an ADVISORY note; opt in to blocking per field.
  aadhaar_strict: {
    re: AADHAAR_RE,
    message: "Aadhaar must be 12 digits",
    transform: "digits",
    inputMode: "numeric",
    maxLength: 12,
    check: isAadhaarChecksumValid,
    checkMessage: "Aadhaar check digit is wrong — re-type the number",
  },
  cin: { re: CIN_RE, message: "Invalid CIN (21 characters)", transform: "upper", inputMode: "text", maxLength: 21 },
  iec: { re: IEC_RE, message: "Invalid IEC (10 characters)", transform: "upper", inputMode: "text", maxLength: 10 },
  uan: { re: UAN_RE, message: "UAN must be 12 digits", transform: "digits", inputMode: "numeric", maxLength: 12 },
  esi: { re: ESI_RE, message: "ESIC employer code must be 17 digits", transform: "digits", inputMode: "numeric", maxLength: 17 },
  esi_ip: { re: ESI_IP_RE, message: "ESIC insurance number must be 10 digits", transform: "digits", inputMode: "numeric", maxLength: 10 },
  ifsc: { re: IFSC_RE, message: "Invalid IFSC (e.g. HDFC0001234)", transform: "upper", inputMode: "text", maxLength: 11 },
  swift: { re: SWIFT_RE, message: "Invalid SWIFT/BIC (8 or 11 characters)", transform: "upper", inputMode: "text", maxLength: 11 },
  micr: { re: MICR_RE, message: "MICR must be 9 digits", transform: "digits", inputMode: "numeric", maxLength: 9 },
  // THE dangerous kind, and the reason `normalise` exists.
  //
  // Every other digits-only kind has a FIXED length (Aadhaar 12, UAN 12, ESI-IP
  // 10, MICR 9), which makes stripping self-policing: delete something that
  // mattered and the length changes, so `re` fails and the user sees it. This
  // one is a RANGE (9–18), so there is nothing left to catch a bad strip —
  // "SB1234567890" would quietly become "1234567890" and "1234567890/01" would
  // become "123456789001", an account that belongs to nobody. It is then WRITTEN
  // BACK, and this is the number printed on proforma invoices for buyers to wire
  // against (client 2026-07-28).
  //
  // So: strip separators only. A hyphenated "1234-5678-901" still normalises;
  // a letter prefix or a "/01" branch suffix now fails LOUDLY, which is the
  // correct outcome — the operator knows what the real number is, and we do not.
  account: {
    re: BANK_ACCT_RE,
    message: "Account number must be 9–18 digits",
    transform: "digits",
    inputMode: "numeric",
    maxLength: 18,
    normalise: stripSeparators,
  },
  pincode: { re: PINCODE_IN_RE, message: "Enter a 6-digit PIN code", transform: "digits", inputMode: "numeric", maxLength: 6 },
  mobile: { re: MOBILE_IN_RE, message: "Enter a 10-digit mobile (starting 6–9)", transform: "digits", inputMode: "numeric", maxLength: 10, strip: /^(\+?91|0)/ },
  landline: { re: LANDLINE_IN_RE, message: "Enter a valid landline number", transform: "none", inputMode: "tel", maxLength: 15 },
  // Same range problem as `account`, lower stakes: 7–15 digits, so the keystroke
  // transform would fold "…43210 ext 22" into one 15-digit number that still
  // passes. Separators only, so an extension or a note fails visibly instead.
  phone_intl: {
    re: PHONE_INTL_RE,
    message: "Enter a valid phone number (7–15 digits, optional +country code)",
    transform: "phone",
    inputMode: "tel",
    maxLength: 16,
    normalise: stripSeparators,
  },
  email: { re: EMAIL_RE, message: "Enter a valid email address", transform: "none", inputMode: "email" },
  website: { re: WEBSITE_RE, message: "Enter a valid website URL", transform: "none", inputMode: "text" },
  isd: { re: ISD_RE, message: "Enter a valid ISD code (e.g. +91)", transform: "none", inputMode: "tel", maxLength: 5 },
  hsn: { re: HSN_RE, message: "HSN/SAC must be 4, 6 or 8 digits", transform: "digits", inputMode: "numeric", maxLength: 8 },
  gst_state: { re: GST_STATE_RE, message: "Enter a 2-digit GST state code (01–38)", transform: "digits", inputMode: "numeric", maxLength: 2 },
  currency: { re: CURRENCY_RE, message: "Enter a 3-letter ISO currency code (e.g. INR)", transform: "upper", inputMode: "text", maxLength: 3 },
  yarn_count: { re: YARN_COUNT_RE, message: "Use 10'S, 2/10'S or 40 DINER", transform: "upper", inputMode: "text", maxLength: 15 },
};

/** Apply a format's keystroke transform (uppercase / digits-only). */
export function applyTransform(kind: FormatKind, raw: string): string {
  const t = FORMATS[kind].transform;
  if (t === "upper") return raw.toUpperCase();
  if (t === "digits") return raw.replace(/\D/g, "");
  // "phone": keep a LEADING "+" (the only marker that a number is already
  // international) and drop every other non-digit, so a pasted
  // "+91 98765-43210" / "(044) 2345 6789" lands as clean digits.
  if (t === "phone") return raw.replace(/(?!^\+)\D/g, "");
  return raw;
}

/**
 * Canonicalise a value for STORAGE — the server-side counterpart to
 * `applyTransform`, which is for keystrokes.
 *
 * The two differ on purpose. While typing, dropping every non-digit is helpful
 * and instantly visible. On save it is not: the value may predate any
 * validation, and a silent rewrite of somebody's bank account is far worse than
 * a rejection they can act on. Kinds opt out via `normalise` where their
 * keystroke transform would delete content the shape rule cannot then catch.
 */
export function normalizeForStore(kind: FormatKind, raw: string): string {
  const spec = FORMATS[kind];
  return spec.normalise ? spec.normalise(raw) : applyTransform(kind, raw);
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
  if (!spec.re.test(normalized)) return spec.message;
  if (spec.check && !spec.check(normalized)) return spec.checkMessage ?? spec.message;
  return null;
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

/**
 * Server-side twin of `validateFormat` — an optional field constrained to a
 * whole FormatKind rather than a bare regex.
 *
 * Prefer this over `nullableFormat(re, message)` for anything new. Passing the
 * regex alone silently drops the other three things a FormatKind carries: the
 * `strip` prefix rule (so a mobile saved as "+919876543210" fails on the server
 * while passing in the browser), the `check` checksum hook, and the message
 * wording. One kind, one behaviour, both sides.
 *
 * `nullableFormat` is kept because ~40 existing fields use it and re-pointing
 * them all is a separate, riskier change than adding validation where there is
 * none today.
 */
export function nullableKind(kind: FormatKind) {
  return z
    .string()
    .trim()
    // NORMALISE FIRST, then validate. Applying a format to a column that has
    // been free text for its whole life would otherwise reject the data already
    // in it: a PAN stored lowercase, or an account number stored as
    // "1234-5678-901", is the RIGHT value in the wrong shape, and blocking the
    // save would strand the record — the user could not correct a phone number
    // without first re-typing an identifier they may not have to hand.
    //
    // `normalizeForStore`, NOT `applyTransform`. The keystroke transform is
    // deliberately aggressive (digits-only as you type); reusing it here would
    // rewrite stored values rather than reject them, and on a length-RANGE kind
    // the shape rule cannot catch the difference. See the `account` comment.
    .transform((v) => (v == null || v === "" ? v : normalizeForStore(kind, v)))
    .optional()
    .nullable()
    .superRefine((v, ctx) => {
      const err = validateFormat(kind, v);
      if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
    });
}

// ============================================================================
// CAPS
// ============================================================================
/**
 * A text field STORED in capitals (client 2026-07-23, extended app-wide
 * 2026-07-29).
 *
 * Put this in the `*Input` SCHEMA, never only in the server action. The action
 * is not the only write path: `lib/data-io/actions.ts` parses a spreadsheet row
 * with these very schemas and pushes `parsed.data` straight to Postgres, so an
 * action-level `.toUpperCase()` never sees an import. That is how mixed-case
 * rows have been getting in despite ~30 hand-copied uppercase calls.
 *
 * Validate BEFORE transforming — `.min()` cannot be chained after a Zod
 * transform, and a whitespace-only name should fail as empty rather than
 * succeed as "".
 *
 * NOT for email, website, or any `transform: "none"` format kind: those are
 * case-sensitive or case-irrelevant, and shouting them helps nobody. Route
 * those through `nullableKind` / `nullableFormat` instead, which is already
 * what the master screens do by rendering `ValidatedInput`.
 */
export function capsName(message = "Name is required") {
  return z
    .string()
    .trim()
    .min(1, message)
    .transform((s) => s.toUpperCase());
}

/** Optional/nullable counterpart of `capsName` — null and undefined pass through. */
export function capsTextNullable() {
  return z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .optional()
    .nullable();
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
