// Verification vectors for the pure rules in lib/focus.ts — `keyFills`, which
// decides which keys a HELD field still answers, and `enterTicks`, which decides
// whether Enter on a tick box ticks it or commits the surface.
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

import {
  autoFilledField,
  enterTicks,
  keyFills,
  keyMovesBackward,
  type FillProbe,
  type TickProbe,
} from "../lib/focus.ts";

/** The controls a held field can actually be. */
const TEXT: FillProbe = { tag: "INPUT", role: null, ariaExpanded: null, fieldTrigger: false, inputType: "text", inGrid: false };
const PICKER_SHUT: FillProbe = { tag: "INPUT", role: "combobox", ariaExpanded: "false", fieldTrigger: false, inputType: "text", inGrid: false };
const PICKER_OPEN: FillProbe = { tag: "INPUT", role: "combobox", ariaExpanded: "true", fieldTrigger: false, inputType: "text", inGrid: false };
const TRIGGER: FillProbe = { tag: "BUTTON", role: null, ariaExpanded: null, fieldTrigger: true, inputType: null, inGrid: false };
const NATIVE_SELECT: FillProbe = { tag: "SELECT", role: null, ariaExpanded: null, fieldTrigger: false, inputType: null, inGrid: false };
const TEXTAREA: FillProbe = { tag: "TEXTAREA", role: null, ariaExpanded: null, fieldTrigger: false, inputType: null, inGrid: false };
/** The two `<input>` families that have no popup and no caret — and that answer
 *  the arrows in OPPOSITE ways. See the block further down. */
const DATE: FillProbe = { tag: "INPUT", role: null, ariaExpanded: null, fieldTrigger: false, inputType: "date", inGrid: false };
const NUMBER: FillProbe = { tag: "INPUT", role: null, ariaExpanded: null, fieldTrigger: false, inputType: "number", inGrid: false };
/** The same date box, in a ChildGrid cell — where the arrows mean something
 *  else entirely. See the block below. */
const DATE_IN_GRID: FillProbe = { ...DATE, inGrid: true };

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
  TEXT, PICKER_SHUT, PICKER_OPEN, TRIGGER, NATIVE_SELECT, TEXTAREA, DATE, DATE_IN_GRID, NUMBER,
})) {
  check(`${name}: Tab refused`, keyFills(probe, "Tab"), false);
}

// ---------------------------------------------------------------------------
// A PLAIN BUTTON FILLS NOTHING — which is why a mandatory control must be a
// `data-field-trigger` and never a bare `<Button>` (0479, Styles Details ▸ Files).
//
// The Files cell on a style row had to be mandatory, and the obvious build was
// the `control` variant of `FileAttachments` — a `<Button data-row-add>` that
// opens the OS file dialog. It cannot carry the rule, and this is the half that
// is invisible until an operator hits it: a held cell refuses every key
// `keyFills` says false to, and on a plain BUTTON that is EVERY key it has.
// Enter on that button IS the click that opens the dialog, so the operator could
// neither attach a file nor leave the cell — the unsatisfiable cage this whole
// file was written for, one control along.
//
// `data-field-trigger` is the fix and the assertions below are the reason it
// works: ↓ still opens the dialog on a held cell, so the hold can be satisfied
// from the keyboard. `TRIGGER` above already covers that direction; what was
// missing is the NEGATIVE — that the same shape without the marker is dead.
const BARE_BUTTON: FillProbe = {
  tag: "BUTTON", role: null, ariaExpanded: null, fieldTrigger: false, inputType: null, inGrid: false,
};
console.log("\nA BARE <button> CAN NEVER HOLD — it has no key that fills");
for (const key of ["Enter", "ArrowDown", "ArrowUp", " ", "Tab"]) {
  check(`bare button: ${key === " " ? "Space" : key} fills nothing`, keyFills(BARE_BUTTON, key), false);
}
check("marked trigger: ↓ DOES fill — the marker is the whole difference", keyFills(TRIGGER, "ArrowDown"), true);

// ---------------------------------------------------------------------------
// A DATE BOX'S ARROWS ARE ITS VALUE
// (Orders ▸ Order Management ▸ Order Entry ▸ Order Info, client 2026-09-03).
//
// `<input type="date">` has no popup and no caret. Its entire keyboard
// interface is the four arrows: ↑/↓ step the focused segment, ←/→ move
// between dd, mm and yyyy. `keyFills` knew nothing about the type, so a blank
// MANDATORY date refused ↓ and → while ↑ and ← went through (those two are
// `keyMovesBackward`, allowed out of a required hold). The operator was left
// with a box where ↑ counted up and ↓ would not count down, which is how it
// was reported: "the up down arrow and enter key are not working".
//
// Order Info is where it bites because that section has TWO required dates
// (Date, and Deli.Dt since 2026-08-31) and on a new order both start blank.
//
// THE HOLD LOSES NOTHING BY ALLOWING THEM, which is why this is not a
// softening of the rule. `ownsArrowKeys` already claims the date family, so
// `arrowNavigate` stands down and no arrow moves focus off one of these fields
// in the first place — refusing them protected no departure, it only removed
// the keys that FILL the box. Tab and Enter are the keys that really do leave,
// and they are still refused, so Save stays out of reach until a date is there.
//
// Same argument as the `<select>` branch above, one control along: no popup, so
// the arrows are the value.
console.log("\nA DATE BOX IS FILLED WITH ITS ARROWS — Order Info ▸ Date / Deli.Dt");
for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
  check(`date field: ${key} fills the segment`, keyFills(DATE, key), true);
}
check("date field: Enter still MOVES (refused while blank)", keyFills(DATE, "Enter"), false);
check("date field: Tab still MOVES (refused while blank)", keyFills(DATE, "Tab"), false);

// … AND THE SAME BOX IN A GRID CELL IS BACK TO REFUSING ALL FOUR.
//
// The argument that makes the branch above safe is "no arrow moves focus off
// this field", and inside a `data-grid-row` that is simply untrue: `gridKeyNav`
// (components/masters/child-grid.tsx) claims ↑/↓ for the ROW and ←/→ for the
// COLUMN, so the browser never sees the key and no segment is ever stepped.
// Allowing them there would buy the operator nothing and would let ↑/↓ walk
// straight out of a held cell — the hole `keyFills`'s own note warns about for
// `ownsArrowKeys`, arriving by a different door. A mandatory date cell in a grid
// is filled by typing, and abandoned with Ctrl+Del, exactly as before.
console.log("\nBUT NOT IN A GRID CELL — there the arrows are the row and the column");
for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Tab"]) {
  check(`date cell in a grid: ${key} is movement, not a fill`, keyFills(DATE_IN_GRID, key), false);
}

// `type="number"` IS NOT IN THAT FAMILY, and the contrast is the point. Its
// arrows DO move focus — `ownsArrowKeys` deliberately does not claim it, and
// `atCaretEdge` treats an unreadable caret there as the edge — so refusing them
// refuses a real departure. The native step buttons are not how an operator
// fills a quantity; typing is. Order Info's Excess % is the field in question.
console.log("\nA NUMBER BOX IS NOT — its arrows are movement");
for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Tab"]) {
  check(`number field: ${key} is movement, not a fill`, keyFills(NUMBER, key), false);
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

// ===========================================================================
// THE TICK BOX AT THE END OF A SURFACE (client 2026-08-11)
// ===========================================================================
//
// Not a hold, but the same shape of failure and the same reason it needs
// vectors: a rule that lives in `enterAdvances`, that no type check can see,
// and whose two halves pull against each other.
//
// Enter on a tick box TICKS it — the 2026-07-28 rule, which replaced a checkbox
// that fell through and saved a half-filled form. But Enter off the LAST field
// is the only keyboard route to Save, since Tab never lands on a button. So a
// surface whose last field is a checkbox had no keyboard save at all: on
// Material Attributes ▸ New the trailing blank row's Blocked box is the last
// field, and every Enter route on the screen funnelled into it.
//
// The rule in one line: A TICK BOX TICKS WHILE A FIELD STILL FOLLOWS IT, AND
// COMMITS WHEN NONE DOES. Space is the toggle either way — it is native, it is
// in neither NAV_KEYS nor HOLD_KEYS, and nothing here touches it, which is what
// keeps the last box tickable at all once Enter there means "save".
//
// A RADIO REACHES THIS PROBE TOO (`tickBox` is checkbox|radio) and takes the
// same answer, deliberately: ↑/↓ in a native group already select as they move,
// so Enter-to-select is redundant and a trailing radio is arrived at already
// checked. Carving it out would be a second rule to keep true.
//
// And a surface that cannot commit at all (a list page's filter box — no footer,
// no registered save, no submit button) ticks whatever its shape: there is
// nothing for the other answer to mean there.

console.log("\nTHE TRAILING TICK BOX — Enter must still reach Save");
function tick(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} — expected ${expected ? "TICKS" : "moves on / COMMITS"}`);
  }
}

/** A tick box on a surface that CAN commit, located on the region axis and
 *  reached by ordinary typing — the case the operator actually meets. */
const box = (hasNextField: boolean): TickProbe => ({
  tickBox: true,
  canSubmit: true,
  hasNextField,
  located: true,
  optIn: false,
});

tick("a field follows it — ticks (the 07-28 rule, unchanged)", enterTicks(box(true)), true);
tick("it is the LAST field — commits", enterTicks(box(false)), false);
// The half that reads as an implementation detail and is the whole point: on
// Material Attributes ▸ New every Enter route funnelled into the trailing star
// row's Blocked box, so the two answers above are the difference between a
// saveable form and a mouse-only one.
tick("a radio takes the same answer — one rule, not two", enterTicks(box(false)), false);

// Anything that is not a tick box never entered this branch: it advances, and
// off the last field the save ladder runs, exactly as before.
tick("a text field is not a tick box", enterTicks({ ...box(false), tickBox: false }), false);

// THE TWO CASES A CARELESS FIX GETS WRONG. Both fail towards TICKING, because a
// commit the operator did not ask for is the 07-28 bug — a half-filled form
// saved by a key that was supposed to tick something.
console.log("\nWhen NOT to read 'nothing follows' as 'commit'");
// `idx === -1` — the box is not on the region axis at all (a `position: fixed`
// control whose `offsetParent` is null drops out of `focusablesIn`). We do not
// KNOW what follows it, and not knowing is not evidence of being last.
tick("not located on the axis — ticks rather than guessing", enterTicks({ ...box(false), located: false }), true);
// `data-focus-optional` — the advance step steps over the marker, so Enter can
// never have ARRIVED here by the typing rhythm; the operator aimed at this box
// with an arrow or the mouse. Committing off it would be a save nobody asked
// for, which is that marker's own footgun with the polarity reversed.
tick("an opt-in box always ticks, last or not", enterTicks({ ...box(false), optIn: true }), true);
tick("an opt-in box with a field after it ticks too", enterTicks({ ...box(true), optIn: true }), true);
// No save to reach — a filter bar, a search palette. Enter there must not fall
// through to the browser (an unclaimed Enter on a box inside a <form> is an
// implicit submit), so it ticks even though nothing follows it.
tick("nothing to commit TO — ticks", enterTicks({ ...box(false), canSubmit: false }), true);
tick("nothing to commit TO, and not a box — untouched", enterTicks({ ...box(false), canSubmit: false, tickBox: false }), false);

// ---------------------------------------------------------------------------
// A FIELD OFF THE TAB PATH MUST NEVER ALSO HOLD THE CURSOR (2026-08-31).
//
// The third way to build an unsatisfiable cage, and the newest. The two above
// are about a hold refusing the keys that FILL a field; this one is about a hold
// on a field Tab can never DELIVER the operator to. `data-focus-optional` takes
// a control off Tab and Enter; `data-required-empty` refuses Tab, Enter, ↓ and →
// while the control is blank. Set both and the operator can neither arrive by
// the route Tab offers nor leave once they get there by some other route — and
// Save stays dead with nothing reachable on screen to fix.
//
// It became reachable on 2026-08-31, when Order Entry's Unit and Date were taken
// off the Tab path (client: "the keyboard tab navigation must completely bypass
// the Entry Date and Location/Unit fields") while both remained mandatory for
// the record. Two independent props would have expressed the cage perfectly
// happily. `autoFilledField` derives both from ONE boolean instead, so the
// broken combination cannot be written down — the same move `keyFills` makes for
// "which keys does a held field still answer", and the same reason it is a pure
// function rather than a rule living in a screen.
//
// VERIFIED BY BEING MADE TO FAIL FIRST: with the body returning
// `{ offTabPath: filled, required: true }` — i.e. requiredness kept
// unconditional, which is what the field declared the day before — the second
// vector below reported
//   FAIL  filled: it is off the Tab path, so it must NOT hold — expected false
// before the fix was written.
console.log("\nAN AUTO-FILLED FIELD — bypassed, or held, never both");
function auto(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} — expected ${expected}`);
  }
}

// The ordinary case: the app filled it in, so the operator has no reason to stop
// on it and Tab steps over.
auto("filled: Tab steps over it", autoFilledField(true).offTabPath, true);
auto("filled: it is off the Tab path, so it must NOT hold", autoFilledField(true).required, false);
// The fallback that makes the feature safe: no default location on the profile
// and no active unit to fall back on. The field is an ordinary mandatory field
// again — reachable, starred, and holding until it is answered.
auto("empty: back on the Tab path", autoFilledField(false).offTabPath, false);
auto("empty: and mandatory again", autoFilledField(false).required, true);
// The invariant itself, stated as the thing that is actually being asserted, so
// a future change to the derivation is checked against the RULE and not against
// the two rows above. Both states, exhaustively — there are only two.
for (const filled of [true, false]) {
  const f = autoFilledField(filled);
  auto(
    `filled=${filled}: never off-the-Tab-path AND holding at once`,
    f.offTabPath && f.required,
    false,
  );
  // And never NEITHER, which is the opposite failure and just as wrong: a
  // mandatory field that is on the Tab path but draws no `*` and does not hold
  // is a field the operator tabs through with nothing saying it is needed.
  auto(
    `filled=${filled}: and never neither — one of the two always applies`,
    f.offTabPath || f.required,
    true,
  );
}

console.log(failures === 0 ? "\nall good\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
