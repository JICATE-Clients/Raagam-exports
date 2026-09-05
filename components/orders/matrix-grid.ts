/**
 * THE ONE LOOK EVERY SIZE-ACROSS GRID ON THE GARMENT ORDER WEARS.
 *
 * Two tabs draw the same shape — an identity column on the left, the order's
 * size run across the top, a value in every square, a band underneath. They are
 * Quantities ▸ Assort (the assortment matrix, 0414/0473) and Prices (the rate
 * matrix, 2026-08-21). The client asked on 2026-09-02 for the second to look
 * like the first, and the honest way to answer that is a shared declaration
 * rather than a second copy of the same class strings: two hand-written looks
 * agree on the day they are written and drift on every day after.
 *
 * ## WHAT LIVES HERE AND WHAT DOES NOT
 *
 * The BANDS and the COLUMN RULE live here — they are what "looks the same"
 * means. The TRACK does not: Assort carries Ctns / Inners / Pcs-Pack columns and
 * a sticky Qty edge that the rate grid has no question for, so each grid builds
 * its own `gridTemplateColumns` out of these widths. A shared track would be a
 * shared set of columns, which is a different and wrong claim.
 *
 * ## THE ROW HEIGHT IS A PARAMETER, AND THAT IS THE WHOLE POINT
 *
 * `matrixCell()` takes its own min-height because the two grids were tuned to
 * different ones by the same client, three weeks apart: Assort's cells are
 * `min-h-9` (36px) and the rate cells are 26px, bought explicitly on 2026-08-21
 * ("reduc ethe field size make it compact") when 21 rows of ~860px became 3 of
 * ~124px. Making Prices "look like Assort" must not quietly hand that back —
 * the client asked for the FRAME, and the frame is the ruling, the bands, the
 * sticky identity and the size tokens. A hard-coded `min-h-9` in here would
 * reverse a ruling by copying a class name.
 */

/**
 * A SIZE COLUMN IS SIZED FOR WHAT IS IN IT, NOT FOR ITS TITLE (client
 * 2026-08-20: "make those size as breathable dynamically, it's this stack size
 * in assortment").
 *
 * A FLAT WIDTH IS THE MISTAKE, whichever value it takes: it has to be right for
 * the WIDEST label, so every short one wastes the difference. 72px suits
 * "12-18M" and spends 30px of nothing on "S"; 42px suits "S" and crushes
 * "12-18M". Sized per label, seventeen kidswear sizes come to ~800px instead of
 * ~1,220.
 *
 * BOTH INPUTS COUNT. An earlier cut measured the LABEL only — `XS` floored to 3
 * characters gave 42px — while the cell holds a full `<Input>`, whose padding
 * and border take ~26px of that before a digit is drawn. So a column titled with
 * a short size and filled with a two-digit value had about 16px for the number.
 * `digits` is measured from the DATA in that column (including whatever the band
 * underneath states), so a run of 2s stays tight and a column holding 1200 opens
 * up on its own — which is what "dynamically" asks for.
 *
 * 26px of chrome, not 18.4: that figure was calibrated when the cell was a bare
 * figure. An `<Input>` is a different container and needs its own.
 */
export const sizeColPx = (label: string, digits: number) =>
  Math.round(
    Math.max(
      Math.min(6, Math.max(2, label.length)),
      Math.min(7, Math.max(2, digits)),
    ) * 7.8 + 26,
  );

/**
 * px for a column of TEXT — the same job `sizeColPx` does for the size run,
 * for the columns either side of it (an identity, a rate, a value edge, a row
 * label).
 *
 * A FIXED WIDTH IS THE MISTAKE, whichever value it takes. The Prices identity
 * was 176px flat, which is right for "All colours & sizes" and spends ~120px of
 * nothing on "WHITE" (client 2026-09-02).
 *
 * **`min` IS WHAT THE HEADER NEEDS, NOT WHAT THE VALUE NEEDS.** A measured
 * column that clips its own title is the one failure worse than a wide one, and
 * a title is the thing the measurement never sees — it is chrome, not data.
 * `max` stops one long name taking the row; `Truncated` reveals the rest.
 *
 * ~6.9px per character at the grids' 12.5px semibold, plus `pad` for the cell's
 * own padding and borders. Calibrated for the CONTAINER like `sizeColPx`, not
 * for the glyphs: a bare figure and an `<Input>` are different boxes.
 */
export const textColPx = (
  chars: number,
  pad: number,
  min: number,
  max: number,
) => Math.round(Math.min(max, Math.max(min, chars * 6.9 + pad)));

/**
 * ## THE BANDS ARE WHITE, AND THAT IS WHERE THE "BLUE" WENT (client 2026-09-05,
 * Tamil, on Prices: remove the blue background in that table)
 *
 * Both bands were `bg-surface-muted`. That token is `#f1f3f5` — blue is its
 * LARGEST channel (241/243/245), so it is a cool grey, and these two grids are
 * inside the Orders module, which wears `data-skin="raagam"`: a white canvas,
 * green-grey partitions (`--border: #dde5d3`) and green field edges. A cool grey
 * is the one surface on that screen with a hue pulling the other way, and on a
 * three-row matrix the two bands are a third of the box — which is why it read
 * as "the table's background is blue" here and nowhere else, off a token every
 * table in the app shares.
 *
 * ## IT IS THE CLIENT'S OWN 2026-08-27 RULING, REACHING THE LAST TWO TABLES
 *
 * "that inside cell for some sections is grey — make it white too" was answered
 * in `child-grid.tsx`, whose `<thead>` has been white ever since, with the
 * reasoning that survives verbatim here: **the header still separates itself.**
 * `border-border-strong` draws the line — deliberately heavier than the hairline
 * between rows — and the type does the rest (uppercase semibold 10.5px above,
 * bold tabular below, against 12.5px cells). The fill was a third signal saying
 * what those two already said, and under a skin it was saying it in the wrong
 * hue.
 *
 * ## `bg-surface`, NOT `bg-transparent`
 *
 * Both bands are `sticky`. A transparent band lets the cells scroll underneath
 * it and paint through, which is worse than any colour — the fill has to be
 * opaque, it just has to be the SURFACE. `--surface` is `#ffffff` and the skin
 * does not override it.
 *
 * ## `--surface-muted` ITSELF IS NOT THE LEVER, AND HAS BEEN TRIED TWICE
 *
 * app/globals.css records both attempts on the skin's copy of that token —
 * `#f0f8e5` green, refused 2026-09-03 ("remove that green kind of bg color"),
 * and white, which was a two-day regression because 75 components draw it (a
 * DataTable header, two row hovers, three Sheet affordances all went white on
 * white). Retuning it again would move every table header in the app to fix two
 * bands. These two bands are what was reported, so these two bands are what
 * changes.
 */
/**
 * The header band. Sticky to the top of its own scroller, never the page.
 *
 * `z-20` clears the cells; the identity and edge columns raise themselves to
 * `z-30` at their call site because they are sticky on TWO axes at once and a
 * corner has to win against both.
 */
export const MATRIX_HEAD =
  "sticky top-0 z-20 flex min-h-8 items-center justify-center border-b " +
  "border-border-strong bg-surface px-1 text-[10.5px] font-semibold " +
  "uppercase tracking-wide text-muted-foreground";

/** The band underneath — totals on Assort, weights on Prices. */
export const MATRIX_FOOT =
  "sticky bottom-0 z-20 flex min-h-9 items-center justify-center border-t " +
  "border-border-strong bg-surface px-1 text-xs font-bold tabular-nums";

/**
 * One square of the body.
 *
 * THE HAIRLINE IS ON THE CELL, NOT THE ROW, and that is forced rather than
 * chosen: a row in these grids is `display: contents` so its cells can be
 * children of the ONE grid that owns the column track (two rows sizing their
 * own columns is the bug the track exists to prevent), and an element with no
 * box cannot draw a border.
 */
export const matrixCell = (minH = "min-h-9") =>
  `flex ${minH} items-center justify-center border-b border-border px-0.5`;

/**
 * THE SAME TOKEN THE SIZE PICKER DRAWS — mono, tabular, bordered. The size the
 * operator ticked over there is visibly the size they are filling in here, on
 * whichever tab they are filling it.
 *
 * `normal-case tracking-normal` are not redundant: this span sits INSIDE
 * `MATRIX_HEAD`, which is uppercase and letter-spaced, and a size run reading
 * "12-18M" must not come out spaced like a column title.
 */
export const MATRIX_SIZE_TOKEN =
  "rounded border border-border bg-surface px-1.5 py-px font-mono text-[13px] " +
  "font-medium normal-case tracking-normal tabular-nums text-foreground";
