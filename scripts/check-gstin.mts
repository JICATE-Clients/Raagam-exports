// Verification vectors for lib/validation/gstin.ts.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-gstin.mts
//
// Exits non-zero on the first mismatch so it can gate a commit if wanted.

import {
  decodeGstin,
  gstinCheckDigit,
  isGstinChecksumValid,
} from "../lib/validation/gstin.ts";

let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

// ---------- checksum ----------
const VALID = [
  "27AAPFU0939F1ZV",
  "29AAGCB7383J1Z4",
  "24AAACC1206D1ZM",
  "33ABCDE1234F1Z7", // corrected form of the example used in our error messages
];
for (const g of VALID) check(`checksum valid: ${g}`, isGstinChecksumValid(g), true);

const INVALID = [
  "33ABCDE1234F1Z5", // the string our own error messages advertise — check digit is 7
  "27AAPFU0939F1ZW", // last character bumped
  "27AAPFU0939F1Z", // 14 chars
  "",
];
for (const g of INVALID) check(`checksum invalid: ${g || "(empty)"}`, isGstinChecksumValid(g), false);

check("check digit of 33ABCDE1234F1Z", gstinCheckDigit("33ABCDE1234F1Z"), "7");
check("check digit of 27AAPFU0939F1Z", gstinCheckDigit("27AAPFU0939F1Z"), "V");
check("check digit rejects short prefix", gstinCheckDigit("27AAPFU"), null);
check("check digit rejects off-alphabet", gstinCheckDigit("27AAPFU0939F1-"), null);

// ---------- normalization ----------
check("lowercase normalizes", isGstinChecksumValid("27aapfu0939f1zv"), true);
check("spaces stripped", isGstinChecksumValid(" 27 AAPFU 0939F1ZV "), true);

// ---------- decode ----------
const d = decodeGstin("27AAPFU0939F1ZV", { companyGstin: "33ABCDE1234F1Z7" });
check("decodes", d !== null, true);
check("stateCode", d?.stateCode, "27");
check("stateName", d?.stateName, "Maharashtra");
check("pan", d?.pan, "AAPFU0939F");
check("panEntityChar", d?.panEntityChar, "F");
check("constitution", d?.constitution, "Firm / LLP");
check("registrationSerial", d?.registrationSerial, "1");
check("entityCheckChar", d?.entityCheckChar, "Z");
check("checkDigit", d?.checkDigit, "V");
check("checksumValid", d?.checksumValid, true);
check("supply vs 33 company", d?.supply, "inter");

check(
  "supply vs 27 company",
  decodeGstin("27AAPFU0939F1ZV", { companyGstin: "27AAPFU0939F1ZV" })?.supply,
  "intra",
);
check("supply with no company gstin", decodeGstin("27AAPFU0939F1ZV")?.supply, "unknown");
check(
  "supply with junk company gstin",
  decodeGstin("27AAPFU0939F1ZV", { companyGstin: "nonsense" })?.supply,
  "unknown",
);

// A bad checksum must still decode — state and PAN stay readable, and the UI
// shows them while suppressing auto-fill.
const bad = decodeGstin("27AAPFU0939F1ZW");
check("bad checksum still decodes", bad !== null, true);
check("bad checksum flagged", bad?.checksumValid, false);
check("bad checksum keeps pan", bad?.pan, "AAPFU0939F");

// Shape gate: anything that isn't a full, well-shaped GSTIN yields null so the
// UI can never half-render a strip.
for (const bad of ["", "27AAPFU0939F1Z", "27AAPFU0939F1ZVX", "ABCDEFGHIJKLMNO", "271APFU0939F1ZV"]) {
  check(`decode rejects: ${bad || "(empty)"}`, decodeGstin(bad), null);
}
check("decode rejects non-Z 14th char", decodeGstin("27AAPFU0939F1AV"), null);

// Constitution spot-checks off the PAN's 4th character.
check("C -> Company", decodeGstin("33AABCU9603R1ZM")?.constitution, "Company");
check("P -> Proprietor", decodeGstin("33ABCPE1234F1Z1")?.constitution, "Proprietor / Individual");

// Unknown state code decodes with a null name rather than throwing.
check("unknown state code", decodeGstin("50ABCDE1234F1Z0")?.stateName, null);

console.log(failed === 0 ? "\nAll GSTIN vectors passed." : `\n${failed} vector(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
