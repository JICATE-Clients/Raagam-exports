/**
 * Vectors for `lib/orders/amendments/price-modes.ts` — what happens to the
 * rates already typed when the operator changes Price Type.
 *
 * ## Why this is vectored
 *
 * These values are what a garment is invoiced at. The old behaviour was to keep
 * the old rates out of the grid and print a block telling the operator to put
 * the mode back; the new behaviour CARRIES THEM ACROSS, which means a function
 * now decides which typed number applies to which cell. Getting that wrong is
 * not a layout bug — it re-prices an order, and it does it silently, because
 * every cell still shows a plausible figure.
 *
 * ## The two that would survive a careless rewrite
 *
 * 1. **Narrowing with disagreement must produce NOTHING.** Collapsing WHITE's
 *    5.20 and 5.75 into one cell has no right answer; picking either discards a
 *    rate the operator typed and averaging invents one nobody agreed. Blank is
 *    the only honest output, and the grid already draws it as unpriced. §3.
 *
 * 2. **An exact match keeps its own blank.** A declared cell the operator left
 *    empty is an answer about that cell; inheriting a neighbour's rate into it
 *    fills a gap they left on purpose. §5.
 *
 * Run: `npm run check:price-modes`.
 */
import {
  adoptedPrice,
  reshapeRates,
  type RateCell,
} from "../lib/orders/amendments/price-modes.ts";

let failed = 0;

function check(what: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok    ${what}`);
  } else {
    failed++;
    console.error(`FAIL  ${what}\n      expected ${e}\n      actual   ${a}`);
  }
}

const S = "size-s";
const M = "size-m";
const L = "size-l";

const rate = (combo: string, size_id: string | null, price: string): RateCell => ({
  combo,
  size_id,
  price,
});

// -- 1. WIDENING IS LOSSLESS ------------------------------------------------
//
// A blank axis on the source means "all of them", so one rate covers many
// cells. These are the three transitions the client's screenshot is about:
// Size-wise -> Color-wise Size-wise, with S = 4 already typed.
const SIZEWISE = [rate("", S, "4"), rate("", M, "6"), rate("", L, "8")];
check("a size rate reaches every colour of that size",
  adoptedPrice({ combo: "WHITE", size_id: S }, SIZEWISE), "4");
check("...and the OTHER colour gets it too",
  adoptedPrice({ combo: "RED", size_id: S }, SIZEWISE), "4");
check("...and a different size takes its own rate",
  adoptedPrice({ combo: "WHITE", size_id: M }, SIZEWISE), "6");

const COLOURWISE = [rate("WHITE", null, "5.20"), rate("RED", null, "5.60")];
check("a colour rate reaches every size of that colour",
  adoptedPrice({ combo: "WHITE", size_id: L }, COLOURWISE), "5.20");
check("a colour rate does not leak to another colour",
  adoptedPrice({ combo: "RED", size_id: L }, COLOURWISE), "5.60");

const STYLEWISE = [rate("", null, "7.00")];
check("one style rate fills every cell",
  adoptedPrice({ combo: "GREY MELANGE", size_id: M }, STYLEWISE), "7.00");

// Case and padding are not disagreements — the combo axis is compared the way
// the rest of the tab compares it.
check("a lower-cased combo still matches",
  adoptedPrice({ combo: "white", size_id: S }, [rate(" WHITE ", null, "5.20")]), "5.20");

// -- 2. NARROWING WHEN THE SOURCES AGREE ------------------------------------
//
// Color-wise Size-wise -> Color-wise. Every size of WHITE reads the same, so
// the colour plainly costs that.
const UNIFORM_WHITE = [rate("WHITE", S, "5.20"), rate("WHITE", M, "5.20"), rate("WHITE", L, "5.20")];
check("sizes that agree collapse to their shared rate",
  adoptedPrice({ combo: "WHITE", size_id: null }, UNIFORM_WHITE), "5.20");
check("...and to Style-wise as well",
  adoptedPrice({ combo: "", size_id: null }, UNIFORM_WHITE), "5.20");

// -- 3. NARROWING WHEN THEY DISAGREE PRODUCES NOTHING -----------------------
//
// THE ONE THAT MATTERS. Picking either would discard a rate the operator typed;
// averaging would invent one nobody agreed. Blank is what the grid already
// draws as "not priced yet", and Save already refuses on it.
const MIXED_WHITE = [rate("WHITE", S, "5.20"), rate("WHITE", M, "5.75")];
check("sizes that disagree collapse to nothing",
  adoptedPrice({ combo: "WHITE", size_id: null }, MIXED_WHITE), "");
check("two colours that disagree collapse to nothing",
  adoptedPrice({ combo: "", size_id: null }, [rate("WHITE", null, "5.20"), rate("RED", null, "5.60")]), "");
// Same number written differently is the same number to a person and a
// different string to a Set — trimmed before comparing, so it stays one answer.
check("the same rate typed with padding is still one answer",
  adoptedPrice({ combo: "WHITE", size_id: null }, [rate("WHITE", S, " 5.20"), rate("WHITE", M, "5.20 ")]), "5.20");

// -- 4. BLANK SOURCES ARE IGNORED, NOT COUNTED ------------------------------
//
// A half-filled grid is this tab's normal state. If an unanswered rate counted
// as a disagreement, one empty cell would suppress a carry-over that was
// otherwise unanimous, and the operator would watch a price they DID type
// vanish because of one they had not.
check("an unpriced sibling does not block the carry-over",
  adoptedPrice({ combo: "WHITE", size_id: null }, [rate("WHITE", S, "5.20"), rate("WHITE", M, "")]), "5.20");
check("nothing priced at all is nothing to inherit",
  adoptedPrice({ combo: "WHITE", size_id: null }, [rate("WHITE", S, ""), rate("WHITE", M, "")]), "");
check("no sources at all is blank, not a crash",
  adoptedPrice({ combo: "WHITE", size_id: S }, []), "");

// -- 5. RESHAPING A WHOLE STYLE ---------------------------------------------
const keyed = (combo: string, size_id: string | null, price: string, key: string) => ({
  combo, size_id, price, key,
});

{
  // Size-wise -> Color-wise Size-wise, two colours over two sizes.
  const existing = [keyed("", S, "4", "k1"), keyed("", M, "6", "k2")];
  const wanted = [
    { combo: "WHITE", size_id: S }, { combo: "WHITE", size_id: M },
    { combo: "RED", size_id: S },   { combo: "RED", size_id: M },
  ];
  check("every wanted cell gets a row, in order",
    reshapeRates(wanted, existing).map((r) => `${r.combo}/${r.size_id}=${r.price}`),
    ["WHITE/size-s=4", "WHITE/size-m=6", "RED/size-s=4", "RED/size-m=6"]);
  // NOTHING IS LEFT OVER — the count is the wanted count, never wanted + the
  // old rows. That is the whole defect being fixed: a row that keeps a stale
  // price_type drops out of the grid, is still saved, and still blocks
  // `orderValue` from behind a warning telling the operator to undo themselves.
  check("...and nothing survives beside them", reshapeRates(wanted, existing).length, 4);
  check("a cell with no row of its own has no key to keep",
    reshapeRates(wanted, existing).map((r) => r.key), [null, null, null, null]);
}

{
  // A cell that already existed keeps its identity, so the box the operator is
  // in is not remounted underneath them.
  const existing = [keyed("WHITE", S, "5.20", "keep-me"), keyed("WHITE", M, "5.75", "k2")];
  const out = reshapeRates([{ combo: "WHITE", size_id: S }], existing);
  check("an exact match keeps its key", out[0].key, "keep-me");
  check("...and its price", out[0].price, "5.20");
}

{
  // AN EXACT MATCH KEEPS ITS OWN BLANK. WHITE/L is declared and deliberately
  // empty, and a size-wise 8 sits beside it that WOULD otherwise reach it.
  // The row's own value wins: inheriting would fill a gap the operator left on
  // purpose. The RED line is the contrast — no row of its own, so it inherits.
  //
  // (This pair was written the other way round first and the vector failed
  // against correct code: it expected RED/L to pick up WHITE's 5.20, which is
  // precisely the colour-to-colour leak §1 asserts must not happen.)
  const existing = [
    keyed("WHITE", S, "5.20", "a"),
    keyed("WHITE", M, "5.20", "b"),
    keyed("WHITE", L, "", "c"),
    keyed("", L, "8", "d"),
  ];
  check("a declared cell left blank stays blank",
    reshapeRates([{ combo: "WHITE", size_id: L }], existing)[0].price, "");
  check("...while a cell with NO row of its own inherits the size rate",
    reshapeRates([{ combo: "RED", size_id: L }], existing)[0].price, "8");
}

console.log(
  failed === 0 ? "\nOK - every price-mode vector holds." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
