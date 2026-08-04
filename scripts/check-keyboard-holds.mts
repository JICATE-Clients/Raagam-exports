// Verification vectors for `keyFills` (lib/focus.ts) — the rule that decides
// which keys a HELD field still answers.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-keyboard-holds.mts
//
// Exits non-zero on the first mismatch so it can gate a commit if wanted. Listed
// in tsconfig `exclude` alongside check-gstin.mts, for the same reason: node's
// type stripping needs the `.ts` extension on the import and the app's tsconfig
// forbids it.
//
// WHY THIS FILE EXISTS. The mandatory-field hold shipped on 2026-08-04 refusing
// every movement key on a blank required field — including the keys that FILL
// one. On Item Class the operator could press ↓ to open the list and ↓ to walk
// down it, and then **Enter did nothing**: the value could not be chosen at all,
// and the field could not be left either, so the only way through the form was
// the mouse. Type checking cannot see that, a build cannot see that, and it
// reached the client. These vectors can.
//
// The rule in one line: A HOLD REFUSES MOVEMENT AND NEVER REFUSES CHOOSING.

import { keyFills, keyMovesBackward, type FillProbe } from "../lib/focus.ts";

/** The controls a held field can actually be. */
const TEXT: FillProbe = { tag: "INPUT", role: null, ariaExpanded: null, fieldTrigger: false };
const PICKER_SHUT: FillProbe = { tag: "INPUT", role: "combobox", ariaExpanded: "false", fieldTrigger: false };
const PICKER_OPEN: FillProbe = { tag: "INPUT", role: "combobox", ariaExpanded: "true", fieldTrigger: false };
const TRIGGER: FillProbe = { tag: "BUTTON", role: null, ariaExpanded: null, fieldTrigger: true };
const NATIVE_SELECT: FillProbe = { tag: "SELECT", role: null, ariaExpanded: null, fieldTrigger: false };
const TEXTAREA: FillProbe = { tag: "TEXTAREA", role: null, ariaExpanded: null, fieldTrigger: false };

let failures = 0;
function check(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} — expected ${expected ? "FILLS (allowed)" : "MOVES (refused)"}`);
  }
}

console.log("\nTHE REPORTED BUG — choosing a value on a held picker");
check("closed picker: ↓ opens the list", keyFills(PICKER_SHUT, "ArrowDown"), true);
check("open picker:   ↓ moves the highlight", keyFills(PICKER_OPEN, "ArrowDown"), true);
check("open picker:   ↑ moves the highlight", keyFills(PICKER_OPEN, "ArrowUp"), true);
check("open picker:   Enter PICKS", keyFills(PICKER_OPEN, "Enter"), true);
check("dialog trigger: ↓ opens the dialog", keyFills(TRIGGER, "ArrowDown"), true);
check("native select: ↓ changes the value", keyFills(NATIVE_SELECT, "ArrowDown"), true);
check("native select: ↑ changes the value", keyFills(NATIVE_SELECT, "ArrowUp"), true);

console.log("\nTHE HOLD STILL HOLDS — movement is still refused");
check("closed picker: Enter is 'next field'", keyFills(PICKER_SHUT, "Enter"), false);
check("closed picker: ↑ is 'field above'", keyFills(PICKER_SHUT, "ArrowUp"), false);
check("open picker:   Tab leaves WITHOUT choosing", keyFills(PICKER_OPEN, "Tab"), false);
check("closed picker: Tab", keyFills(PICKER_SHUT, "Tab"), false);
check("native select: Tab", keyFills(NATIVE_SELECT, "Tab"), false);
check("native select: Enter", keyFills(NATIVE_SELECT, "Enter"), false);
check("text field: Tab", keyFills(TEXT, "Tab"), false);
check("text field: Enter", keyFills(TEXT, "Enter"), false);
check("text field: ↓", keyFills(TEXT, "ArrowDown"), false);
check("text field: ↑", keyFills(TEXT, "ArrowUp"), false);
check("textarea: ↓ (no list to open)", keyFills(TEXTAREA, "ArrowDown"), false);

console.log("\nTab is in NO branch — an open list is not an escape hatch");
for (const [name, probe] of Object.entries({
  TEXT, PICKER_SHUT, PICKER_OPEN, TRIGGER, NATIVE_SELECT, TEXTAREA,
})) {
  check(`${name}: Tab refused`, keyFills(probe, "Tab"), false);
}

console.log("\n←/→ are never a FILL — the hold handles them by caret position");
for (const [name, probe] of Object.entries({ TEXT, PICKER_OPEN, NATIVE_SELECT })) {
  check(`${name}: ← refused here`, keyFills(probe, "ArrowLeft"), false);
  check(`${name}: → refused here`, keyFills(probe, "ArrowRight"), false);
}

// ===========================================================================
// DIRECTION — which keys may leave a REQUIRED hold (client 2026-08-04)
// ===========================================================================
//
// The second half of the same rule, and it shipped with no coverage at all:
// forward keys refuse under either marker, backward keys are allowed out of a
// `data-required-empty` and still refused out of a `data-dup-error`. A duplicate
// guards a value that is WRONG, so leaving in any direction leaves it wrong; a
// blank field is not made worse by stepping back off it — and the field that
// makes it fillable is routinely the one behind it.

function dir(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} — expected ${expected ? "BACKWARD (may leave)" : "FORWARD (refused)"}`);
  }
}

console.log("\nFORWARD keys — refused under either hold");
dir("Tab (no shift)", keyMovesBackward("Tab", false), false);
dir("Enter", keyMovesBackward("Enter", false), false);
dir("↓", keyMovesBackward("ArrowDown", false), false);
dir("→", keyMovesBackward("ArrowRight", false), false);

console.log("\nBACKWARD keys — allowed out of a required hold");
dir("Shift+Tab", keyMovesBackward("Tab", true), true);
dir("↑", keyMovesBackward("ArrowUp", false), true);
dir("←", keyMovesBackward("ArrowLeft", false), true);

// THE ONE CASE A CARELESS FIX GETS WRONG. Forward and backward Tab are the same
// `key`; only the modifier tells them apart, so anything classifying on `key`
// alone reads both as forward and the operator is caged again.
console.log("\nTab flips on the MODIFIER alone");
dir("Tab  + shift → backward", keyMovesBackward("Tab", true), true);
dir("Tab  – shift → forward", keyMovesBackward("Tab", false), false);
// The arrows do not care about shift: Shift+↓ is still forward. Selecting text
// with Shift+← is handled earlier, by `atCaretEdge`, not here.
dir("↓ + shift is still forward", keyMovesBackward("ArrowDown", true), false);
dir("↑ + shift is still backward", keyMovesBackward("ArrowUp", true), true);

// The composed outcome, which is what the operator actually meets. `leaves` is
// what `onHold` (keyboard-nav-provider.tsx) decides: backward passes only when
// the field is NOT carrying a duplicate.
console.log("\nComposed: may the cursor leave?");
const leaves = (key: string, shift: boolean, hasDup: boolean) =>
  keyMovesBackward(key, shift) && !hasDup;
for (const [name, [key, shift]] of Object.entries({
  "Shift+Tab": ["Tab", true], "↑": ["ArrowUp", false], "←": ["ArrowLeft", false],
} as Record<string, [string, boolean]>)) {
  dir(`${name} out of a REQUIRED hold — moves`, leaves(key, shift, false), true);
  dir(`${name} out of a DUPLICATE hold — refused`, leaves(key, shift, true), false);
}
for (const [name, [key, shift]] of Object.entries({
  Tab: ["Tab", false], Enter: ["Enter", false], "↓": ["ArrowDown", false],
} as Record<string, [string, boolean]>)) {
  dir(`${name} refused under EITHER hold`, leaves(key, shift, false) || leaves(key, shift, true), false);
}

console.log(failures === 0 ? "\nall good\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
