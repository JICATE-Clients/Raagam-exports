# Material BOM screen — handoff, 2026-08-20

Two sessions have been editing `app/(app)/orders/material-bom/mba-master-screen.tsx` at the
same time today. This note is so the next person does not undo work they cannot see the
reason for, and so the layout contract below survives the next change.

---

## 1. Where the two sessions overlap

Both of us edit the **`lineTotals` memo** and the **`LineTotal` type**. That is the only
real collision surface, and it is worth knowing before you touch it.

| | Session A (layout) | Session B (requirement) |
|---|---|---|
| `LineTotal` | added `excessCalc`, `final`, `refusal`, `uom` | added `calc` |
| Reads it | `derivedQtyCell`, `qtyRibbon`, `renderListItem` | the Calculated Qty column |
| Engine | untouched | `baseRequirementFor` / `calcQty` in `lib/orders/material-bom/requirement.ts` |

**If you add a field to `LineTotal`, check all four readers.** Three of them are layout
(the two derived cells, the ribbon under the row, and the left-hand list row) and they will
silently render nothing rather than fail.

**Live as this was written:** `tsc` reports `Cannot find name 'processVerdict'` at
`mba-master-screen.tsx:2129` — an in-progress edit, not a merge problem. Expect the file to
be red intermittently today.

---

## 2. The layout contract (do not break these by accident)

The screen was redesigned this week from a mockup the client picked out of three, then
corrected across five rounds of screenshots (2402 · 2404 · 2406 · 2409 · 2410 · 2414). Each
rule below is a client decision, not a preference.

**THE FIELD ORDER IS FIXED.** All 22 fields keep their legacy sequence; the client restated
this on 2026-08-19. Nothing may be reordered. `FIELD_GROUPS` only decides where the row
BREAKS, and every run is a contiguous slice of that sequence.

**Three runs, each summing to 32**, rendered on `FieldGrid cols={32}`:

| Run | Fields | |
|---|---|---|
| A | 1–6 | what the trim is, and who supplies it |
| B | 7–14 | what it is measured in, and which garments |
| C | 15–22 | the numbers — the client's own section, No. of Items → Purchase Pack |

Change one size and its run must still make 32, or the last field drops to a second line.
**The field width is `32 ÷ fields on the row`** — that is why the run sizes are 6/8/8 and
not something more obviously balanced. Twenty of the 22 fields are `md` (140px); only
Material and Vendor are `xl` (280px), because a slashed spec and a company name are the only
genuinely long values. The evenness is the point (client 2026-08-20).

**Twelve columns cannot hold this.** `xs` is 2 columns, so the house track caps a row at six
fields. `FIELD_TRACK_32` already existed and was unused; it also brings `items-end`, which
matters below.

**ANYTHING ADDED TO A CELL GOES ABOVE THE CONTROL.** The runs are bottom-aligned
(`items-end`, so a wrapped label cannot drop its control below the row). That means the LAST
element in a cell lands on the shared baseline — a note under a control puts the *note* on
the baseline and lifts the control ~20px above every other field on the row. The Style cell's
"Piece / Set" line did exactly this and picking a style knocked the row crooked
(screenshot 2414). Above the control it costs nothing: the cell grows upward from a fixed
bottom edge.

**NO COSMETIC GREYS.** `WEIGHT_CLASS` used to draw `quiet` fields dashed-and-transparent and
`auto` fields grey-filled. The client had both removed (screenshot 2410): a cosmetic grey was
competing with a real one, because a genuinely disabled control (Component before a style is
picked) is also grey. `quiet` now keeps only a 70% LABEL. **Tint is earned by a number** —
the two computed cells are white when empty and `info` / `accent` when populated.

**`ChildGrid` gained `masterDetail` + `renderListItem` + `onOpenRow`**, opt-in and cards-mode
only. Folded rows become a left list, the open row renders on the right **inside the same
`data-grid-body`** — which is what keeps `gridKeyNav`, `tabAlongRow`, the required-holds and
`data-row-remove` working. A hand-rolled two-pane on the screen would lose all four.

- `renderListItem` must be **inert** — text, a dot, a figure. `renderFoldedRow` could not be
  reused because this screen's folded line carries a live Material picker, and nesting that
  in the list button is invalid markup that swallows the click.
- `mdActive = masterDetail && rows.length > 1`. **A list of one is not a list** — on a new
  BOM the pane otherwise stands 268px wide holding "Not filled in".

**`MasterFullScreen` gained `railCollapsed` + `onExpandRail`.** Picking or adding a line
folds the section rail so the fields get its 228px; a "Sections" button at the top of the
content brings it back. Only the desktop grid column goes — the `<nav>` stays in the DOM so
the mobile chip strip, the rail's arrow keys and screen readers still reach the sections.
**Do not derive the collapse from "is any row open"**: an unset `openRowKey` resolves to the
last row, so that reading folds the rail the instant the screen loads.

---

## 3. What no check can see

`tsc`, the five `audit_layout` checks, `--check tab-fields` and the BOM vectors **all passed
green on three separate versions the client called a mess**. Field width, colour and row
count are invisible to every instrument in this repo.

If you change the layout, get a screenshot before reporting it done.

Verification that IS worth running:

```
npx tsc --noEmit -p tsconfig.json
python scripts/audit_layout.py . --check grid-required-mobile      # must be 0
python scripts/audit_layout.py . --check truncate-reveal           # must stay 56 in 51
python scripts/audit_layout.py . --check caps-input                # must be 0
python .claude/skills/raagam-keyboard-contract/scripts/audit_keyboard.py . --check tab-fields
npm run check:bom-requirement
```

`grid-required-mobile` is the one that matters most here: cards mode calls `renderMobileRow`
instead of the `columns.map()` that wraps each cell in `RequiredScope`, so `required` has to
be forwarded by hand or the header draws a `*` with no cursor hold behind it.

The `preserve-manual-memoization` eslint error in this file is **at HEAD** — pre-existing,
not yours.

---

## 4. Proposed next direction (raised, not approved)

The client has asked whether the item editor should stop being a right-hand pane and become
a **full-span screen opened from a list** — the shape Combos ▸ Structure Details already uses.

It is a genuine improvement **only with next / previous line arrows in the overlay header**.
Without them a twenty-line BOM costs forty clicks, and keeping the list in view is the whole
reason the two-pane was chosen in the first place.

Open questions before anyone builds it:

1. Does the list screen show the same columns as today's list pane?
2. Does "+ Add material" open the overlay straight away?
3. What does Escape do with unsaved edits in the overlay?
4. Tab off the last field currently walks to the next line — in an overlay it would have to
   land on "next line" instead, which is `lib/focus.ts` territory.

**This reverses a decision the client made two days ago** (the two-pane was picked from three
treatments). Worth flagging to them as a change of direction rather than a tweak.
