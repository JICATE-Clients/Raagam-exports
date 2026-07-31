/**
 * The Country / State a BRAND-NEW party row starts on.
 *
 * Almost every vendor, customer and consignee keyed on this system is Indian and
 * most of them are in our own state, so an empty Country + State box is two
 * pickers the operator opens on every single row to type the same two answers.
 * These two helpers supply that answer at create time; the operator overrides it
 * by picking anything else, exactly as before.
 *
 * Applied on CREATE only. An existing row whose State was left blank is data, not
 * a gap to be filled — back-filling it on open would rewrite history the moment
 * someone opened the row to read it.
 *
 * Neither helper ever CREATES a master row: an unmatched default yields "" and
 * the field simply opens empty, which is what the screens did before.
 */

import type { Country } from "./country-types";
import {
  GST_STATE_NAMES,
  matchGstinState,
  normalizeGstin,
  type GstStateOption,
} from "@/lib/validation/gstin";

/**
 * Tamil Nadu — the fallback home state, used only when the company profile
 * carries no usable GSTIN. The company's own GSTIN is the better answer (it moves
 * if the registration does), so it wins whenever it parses.
 */
export const FALLBACK_HOME_STATE_CODE = "33";

/**
 * India's ISO-ish code as the Country master spells it. Third in the ladder,
 * behind the master's own `default_country` flag and ahead of the name.
 */
const INDIA_CODE = "IND";

/**
 * The Country a new party defaults to.
 *
 * The Country master already carries a `default_country` flag, so that is asked
 * first — a deployment outside India sets the flag and gets the right default
 * without touching this file. "IND" then the name are the fallbacks for the rows
 * that predate the flag being filled in.
 */
export function defaultCountryId(countries: readonly Country[]): string {
  const usable = countries.filter((c) => !c.inactive);
  const pool = usable.length ? usable : countries;
  const flagged = pool.find((c) => c.default_country);
  if (flagged) return flagged.id;
  const byCode = pool.find((c) => (c.code ?? "").trim().toUpperCase() === INDIA_CODE);
  if (byCode) return byCode.id;
  return pool.find((c) => c.name.trim().toUpperCase().replace(/\s/g, "") === "INDIA")?.id ?? "";
}

/**
 * The State a new party defaults to — our own, read out of the company GSTIN.
 *
 * Characters 1–2 of a GSTIN ARE the GST state code, so the company profile's
 * number already says which state we operate from; `matchGstinState` then does
 * the code-first / spelling-fallback match against the State master, which is
 * the same ladder the GSTIN suggestion chips use. That shared match is why a
 * State master row typed "TAMILNADU" resolves as well as "Tamil Nadu".
 */
export function defaultStateId<T extends GstStateOption>(
  states: readonly T[],
  companyGstin?: string | null,
): string {
  const fromCompany = normalizeGstin(companyGstin).slice(0, 2);
  const stateCode = /^[0-9]{2}$/.test(fromCompany) ? fromCompany : FALLBACK_HOME_STATE_CODE;
  return (
    matchGstinState({ stateCode, stateName: GST_STATE_NAMES[stateCode] ?? null }, states)?.id ?? ""
  );
}
