// ============================================================================
// Aadhaar check digit (Verhoeff) — offline, no lookup.
//
// An Aadhaar number's 12th digit is a Verhoeff checksum over the preceding 11.
// Verhoeff is a dihedral-group scheme rather than a weighted sum, which is why
// it catches the two error classes a regex never will: a single mistyped digit,
// and — unlike simple mod-10 schemes — ADJACENT TRANSPOSITIONS ("...4321..." for
// "...4312..."), the most common human keying mistake.
//
// Deliberately dependency-free, mirroring lib/validation/gstin.ts, so the import
// stays one-directional (formats.ts -> aadhaar.ts) and a plain
// `node --experimental-strip-types` script can exercise it.
//
// This does NOT prove an Aadhaar exists or belongs to anyone — only that the
// number is internally consistent. Verifying identity needs UIDAI, which is a
// licensed integration and out of scope.
// ============================================================================

/** Dihedral group D5 multiplication table. */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;

/** Permutation table, applied cyclically by position. */
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

/**
 * Verhoeff checksum over a digit string. Returns 0 for a valid number — the
 * check digit is the last character and is included in the walk.
 *
 * Digits are consumed RIGHT to LEFT; the position index feeds the permutation
 * table modulo 8. Non-digits are rejected by the caller, not here.
 */
export function verhoeffChecksum(digits: string): number {
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    const d = Number(reversed[i]);
    if (!Number.isInteger(d)) return -1;
    c = D[c][P[i % 8][d]];
  }
  return c;
}

/**
 * True when a 12-digit Aadhaar's check digit is consistent.
 *
 * Shape is NOT checked here — that is AADHAAR_RE's job in ./formats, and this
 * runs only after it passes (see the `check` hook on the `aadhaar_strict`
 * format). Anything that is not exactly 12 digits returns false rather than
 * throwing, so a caller that forgets the shape test fails closed.
 */
export function isAadhaarChecksumValid(value: string): boolean {
  const v = (value ?? "").replace(/\s/g, "");
  if (!/^\d{12}$/.test(v)) return false;
  return verhoeffChecksum(v) === 0;
}
