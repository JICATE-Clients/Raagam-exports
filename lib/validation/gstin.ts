// ============================================================================
// GSTIN decoding — everything a GST number tells you WITHOUT calling anything.
//
// A GSTIN is self-describing, not an opaque key. Of its 15 characters, 10 *are*
// the entity's PAN, 2 are the state code, and 1 is a mod-36 check digit:
//
//     33      ABCDE1234F   1     Z     7
//     ^state  ^PAN         ^reg  ^def  ^checksum
//
// So state, PAN, constitution and intra/inter-state supply are all derivable
// offline, for free, with no provider and no network. Only the *registry* facts
// (legal name, trade name, filing status) need a lookup — see lib/integration/gstin.
//
// Deliberately dependency-free (it carries its own shape regex rather than
// importing GSTIN_RE) so the import stays one-directional: formats.ts -> gstin.ts.
// That also lets a plain `node --experimental-strip-types` script exercise it.
// ============================================================================

/** Same rule as GSTIN_RE in ./formats — duplicated to keep this module standalone. */
const GSTIN_SHAPE_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Positional value alphabet for the mod-36 check digit. */
const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * GST state codes. 01–38 are the states/UTs; 97 and 99 are the two special
 * codes that appear on real registrations. Note this range is WIDER than
 * GST_STATE_RE in ./formats (which caps at 38) — that regex governs hand-typed
 * codes in the State master and is intentionally left alone.
 */
export const GST_STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

/**
 * Alternate spellings a hand-typed State master row might carry, keyed by GST
 * state code. Only ever consulted AFTER the code match fails — it exists because
 * `public.states` ships unseeded and its rows get typed by whoever set the
 * system up ("Tamilnadu", "Orissa", "Pondicherry").
 *
 * Lived as a private const in vendor-master-screen.tsx and again in
 * consignee-master-screen.tsx, and the two had already drifted — consignee knew
 * three spellings, vendor knew seven, so the same State master resolved on one
 * screen and not the other. One copy, here, beside the state names it aliases.
 */
export const GST_STATE_ALIASES: Record<string, string[]> = {
  "05": ["Uttaranchal"],
  "07": ["NCT of Delhi", "New Delhi"],
  "21": ["Orissa"],
  "25": ["Daman and Diu"],
  "26": ["Dadra & Nagar Haveli", "Daman & Diu", "Dadra and Nagar Haveli"],
  "33": ["Tamilnadu"],
  "34": ["Pondicherry"],
  "35": ["Andaman and Nicobar", "Andamans"],
};

/** The shape of a State-master row this module can match against. */
export interface GstStateOption {
  id: string;
  code?: string | null;
  name: string;
}

/**
 * The State-master row a GSTIN's state code points at, or null.
 *
 * `public.states.code` IS the GST state code, so that is the primary match and
 * the only exact one. The name/alias ladder below it is a fallback for rows that
 * were typed before anyone filled the code in; it normalises away case,
 * punctuation and spacing ("Dadra & Nagar Haveli" vs "DADRA AND NAGAR HAVELI").
 *
 * Never creates a State row — an unmatched code simply yields null and the
 * caller offers nothing.
 */
export function matchGstinState<T extends GstStateOption>(
  decoded: Pick<GstinDecoded, "stateCode" | "stateName"> | null | undefined,
  states: readonly T[],
): T | null {
  if (!decoded) return null;
  const byCode = states.find(
    (s) => (s.code ?? "").trim().padStart(2, "0") === decoded.stateCode,
  );
  if (byCode) return byCode;
  if (!decoded.stateName) return null;
  // "&" becomes "AND" BEFORE the strip, not after it. Our canonical names use
  // the ampersand ("Jammu & Kashmir", "Dadra & Nagar Haveli and Daman & Diu")
  // and a hand-typed State row is at least as likely to spell it out; dropping
  // "&" as punctuation would leave "JAMMUKASHMIR" against "JAMMUANDKASHMIR" and
  // silently fail to match the state the operator did type.
  const norm = (v: string) => v.toUpperCase().replace(/&/g, "AND").replace(/[^A-Z]/g, "");
  const wanted = new Set(
    [decoded.stateName, ...(GST_STATE_ALIASES[decoded.stateCode] ?? [])].map(norm),
  );
  return states.find((s) => wanted.has(norm(s.name))) ?? null;
}

/** Constitution of the entity, encoded in the 4th character of the PAN. */
export const PAN_CONSTITUTION: Record<string, string> = {
  A: "Association of Persons",
  B: "Body of Individuals",
  C: "Company",
  E: "LLP",
  F: "Firm / LLP",
  G: "Government",
  H: "Hindu Undivided Family",
  J: "Artificial Juridical Person",
  L: "Local Authority",
  P: "Proprietor / Individual",
  T: "Trust",
};

/**
 * The expected 15th character for a 14-character GSTIN prefix.
 *
 * Mod-36: each character's alphabet index is multiplied by an alternating
 * factor (1, 2, 1, 2 … starting at 1), and the quotient AND remainder of that
 * product over 36 are both added to a running sum. The check digit is the
 * alphabet character at (36 - sum % 36) % 36.
 *
 * Returns null if the prefix is the wrong length or carries an off-alphabet
 * character — callers treat that as "cannot verify", not "invalid".
 */
export function gstinCheckDigit(first14: string): string | null {
  if (first14.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARSET.indexOf(first14[i]);
    if (value < 0) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36];
}

/** Normalize a typed/pasted GSTIN: strip all whitespace, uppercase. */
export function normalizeGstin(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * True when the check digit matches. This is what catches the single most
 * common data-entry error — a GSTIN transcribed off an invoice with one
 * character wrong still passes the shape regex, but not this.
 */
export function isGstinChecksumValid(gstin: string | null | undefined): boolean {
  const v = normalizeGstin(gstin);
  if (v.length !== 15) return false;
  return gstinCheckDigit(v.slice(0, 14)) === v[14];
}

export interface GstinDecoded {
  /** Whitespace-stripped, uppercased. */
  gstin: string;
  /** Characters 1–2, e.g. "33". */
  stateCode: string;
  /** Resolved from GST_STATE_NAMES; null for a code we don't recognise. */
  stateName: string | null;
  /** Characters 3–12 — the entity's PAN, exactly. */
  pan: string;
  /** 4th character of the PAN, which encodes the constitution. */
  panEntityChar: string;
  /** e.g. "Company"; null when the entity character is unrecognised. */
  constitution: string | null;
  /** Character 13 — which registration this is for that PAN in that state. */
  registrationSerial: string;
  /** Character 14 — "Z" by default for a normal registration. */
  entityCheckChar: string;
  /** Character 15 as typed. */
  checkDigit: string;
  checksumValid: boolean;
  /**
   * Supply type relative to our own company's GSTIN — drives CGST+SGST vs IGST,
   * and the vendor's "With in State" / "Other State" classification.
   * "unknown" when we don't have a usable company GSTIN to compare against.
   */
  supply: "intra" | "inter" | "unknown";
}

/**
 * Decode a GSTIN into everything it implies.
 *
 * Returns null unless the value is a full, correctly SHAPED 15-character GSTIN.
 * A failed checksum still decodes (state and PAN remain readable and worth
 * showing) — callers check `checksumValid` before propagating anything.
 */
export function decodeGstin(
  raw: string | null | undefined,
  opts?: { companyGstin?: string | null },
): GstinDecoded | null {
  const gstin = normalizeGstin(raw);
  if (!GSTIN_SHAPE_RE.test(gstin)) return null;

  const stateCode = gstin.slice(0, 2);
  const pan = gstin.slice(2, 12);
  const panEntityChar = pan[3];

  const companyState = normalizeGstin(opts?.companyGstin).slice(0, 2);
  const supply: GstinDecoded["supply"] = /^[0-9]{2}$/.test(companyState)
    ? companyState === stateCode
      ? "intra"
      : "inter"
    : "unknown";

  return {
    gstin,
    stateCode,
    stateName: GST_STATE_NAMES[stateCode] ?? null,
    pan,
    panEntityChar,
    constitution: PAN_CONSTITUTION[panEntityChar] ?? null,
    registrationSerial: gstin[12],
    entityCheckChar: gstin[13],
    checkDigit: gstin[14],
    checksumValid: gstinCheckDigit(gstin.slice(0, 14)) === gstin[14],
    supply,
  };
}
