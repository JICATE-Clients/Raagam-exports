import { PHONE_INTL_RE, EMAIL_RE } from "./formats";

// ============================================================================
// Contact channels — shared resolution for the Mobile / WhatsApp pair that
// replaced the legacy `fax` column across the 9 master tables (migration 0353).
//
// THE CONVENTION: `whatsapp IS NULL` means "same as mobile".
// It is never stored twice, so the two can never drift apart. Everything that
// reads a WhatsApp number MUST go through effectiveWhatsApp() — a screen that
// reads `row.whatsapp` directly will show a blank for the ~90% of records where
// the WhatsApp number is simply the mobile.
// ============================================================================

/** A record carrying the Mobile / WhatsApp pair. */
export interface ContactPair {
  mobile: string | null;
  whatsapp: string | null;
}

/** Trim to null — empty strings are stored as NULL everywhere in this codebase. */
function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/**
 * The number to actually message. Resolves the `NULL = same as mobile`
 * convention: an explicit WhatsApp number wins, otherwise the mobile stands in.
 */
export function effectiveWhatsApp(r: ContactPair): string | null {
  return clean(r.whatsapp) ?? clean(r.mobile);
}

/**
 * True when the WhatsApp box should show its "Same as mobile" tick. Kept here
 * rather than inline in the component so the form and the link agree on what
 * "mirroring" means.
 */
export function isWhatsAppSameAsMobile(r: ContactPair): boolean {
  return clean(r.whatsapp) === null;
}

/** `tel:` link for a phone number, or null when there's nothing dialable. */
export function telHref(num: string | null | undefined): string | null {
  const v = clean(num);
  if (!v) return null;
  const compact = v.replace(/(?!^\+)\D/g, "");
  return PHONE_INTL_RE.test(compact) ? `tel:${compact}` : null;
}

/** `mailto:` link for an address, or null when it isn't a valid address. */
export function mailtoHref(addr: string | null | undefined): string | null {
  const v = clean(addr);
  if (!v) return null;
  return EMAIL_RE.test(v) ? `mailto:${v}` : null;
}

/**
 * Build a click-to-chat URL. wa.me requires a FULL international number with no
 * '+' and no separators — e.g. https://wa.me/919876543210.
 *
 * @param num      as stored — may be a bare local number ("9876543210"), an
 *                 already-international one ("+6591234567"), or empty/null.
 * @param isdCode  the row's country ISD from `countries.isd_code`. Stored bare
 *                 in this DB ("91"), though ISD_RE also tolerates a leading "+"
 *                 — handle both. Null/undefined when the row has no country.
 * @returns the wa.me URL, or null when no number can be built with confidence.
 *
 * ---------------------------------------------------------------------------
 * TODO(roja): implement. This is the one genuine judgement call in the change —
 * it depends on your customer mix, not on anything the codebase can tell me.
 * Three rules to settle, all inside these ~8 lines:
 *
 *   1. WHEN IS A NUMBER ALREADY INTERNATIONAL?  A leading '+' is unambiguous.
 *      But a bare "6591234567" (Singapore) is indistinguishable by length from
 *      a bare Indian mobile. Trust the '+', the length, or the row's country?
 *
 *   2. WHAT IF `isdCode` IS NULL?  Defaulting to +91 is right for vendors and
 *      bank branches, wrong for a foreign buyer's brand contact. The safe
 *      alternative is returning null — no chip rather than a wrong chip.
 *
 *   3. SHOULD A DOUBTFUL NUMBER LINK AT ALL?  A dead wa.me link is arguably
 *      worse than plain text, because the operator believes they messaged
 *      someone and moves on.
 *
 * My leaning (override freely): trust '+' first, then `isdCode`, then fall back
 * to +91 ONLY when the number is exactly 10 digits starting 6-9 — i.e. it
 * positively looks Indian — and return null otherwise, so an ambiguous number
 * renders as plain text instead of a link that lies.
 *
 * Until this returns a URL the WhatsApp chip simply doesn't render; every other
 * part of the Mobile/WhatsApp pair (entry, validation, storage, "same as
 * mobile") already works.
 * ---------------------------------------------------------------------------
 */
export function whatsappHref(
  num: string | null | undefined,
  isdCode?: string | null,
): string | null {
  const v = clean(num);
  if (!v) return null;
  void isdCode;
  return null;
}
