/**
 * Vectors for `lib/orders/budget/copy-from.ts` — Budget ▸ "Copy From".
 *
 * The rule is small and every clause of it is a way to put a WRONG PRICE on an
 * approved budget without anyone noticing, so each clause is pinned by the case
 * that breaks it: the flat charge that becomes per-piece, the dollar rate that
 * becomes rupees, the two processes on one yarn that share a price, the typed
 * rate that gets overwritten, the two earlier rates that get silently averaged
 * into one.
 *
 * Runs under `tsx` for `check-budget-totals.mts`'s reason.
 */
import { copyRatesFrom, type CopyLine } from "../lib/orders/budget/copy-from.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
}

type Row = CopyLine & { key: string };

const line = (over: Partial<Row> = {}): Row => ({
  key: "t1",
  source: "yarn",
  item_id: "y-30s",
  description: null,
  specification: null,
  currency_code: null,
  ex_rate: null,
  rate: null,
  is_foc: false,
  is_import: false,
  ...over,
});
const src = (over: Partial<CopyLine> = {}): CopyLine => {
  const { key: _k, ...rest } = line(over as Partial<Row>);
  void _k;
  return rest;
};

// ---- 1. the plain case -------------------------------------------------------
{
  const r = copyRatesFrom([line()], [src({ rate: 310 })]);
  check("same source + item: a blank rate is filled", r.lines[0].rate, 310);
  check("  …and counted", [r.matched, r.ambiguous], [1, 0]);
  check("  …keyed row survives (the screen maps back by key)", r.lines[0].key, "t1");
}

// ---- 2. identity -------------------------------------------------------------
{
  const r = copyRatesFrom([line({ source: "yarn_process" })], [src({ rate: 310 })]);
  check("source is part of identity: yarn bought ≠ yarn processed", [r.lines[0].rate, r.matched], [null, 0]);
}
{
  const r = copyRatesFrom(
    [line({ key: "a", source: "yarn_process", process_id: "p-dye" }), line({ key: "b", source: "yarn_process", process_id: "p-twist" })],
    [src({ source: "yarn_process", process_id: "p-dye", rate: 120 }), src({ source: "yarn_process", process_id: "p-twist", rate: 18 })],
  );
  check("two processes on ONE yarn keep two prices", r.lines.map((l) => l.rate), [120, 18]);
}
{
  const r = copyRatesFrom(
    [line({ source: "fabric_process", item_id: null, process_id: "p-dye", combo: "navy " })],
    [src({ source: "fabric_process", item_id: null, process_id: "p-dye", combo: "NAVY", rate: 95 })],
  );
  check("colourway compares trimmed + capitalised", r.lines[0].rate, 95);
}
{
  const r = copyRatesFrom(
    [line({ key: "a", source: "cmt", item_id: "c-pieces", style_ref_no: "0097/2627/C" }),
     line({ key: "b", source: "cmt", item_id: "c-pieces", style_ref_no: "0098/2627/C" })],
    [src({ source: "cmt", item_id: "c-pieces", style_ref_no: "0097/2627/C", rate: 14.5 })],
  );
  check("CMT copies onto the SAME style only — another style's labour is not a default", r.lines.map((l) => l.rate), [14.5, null]);
}
{
  const r = copyRatesFrom(
    [line({ source: "expense", item_id: null, cost_head_id: "h-bank", rate_type: "per_unit" })],
    [src({ source: "expense", item_id: null, cost_head_id: "h-bank", rate: 5000, rate_type: "flat" })],
  );
  check("an expense line matches by its cost head", r.lines[0].rate, 5000);
  check("  …and the FLAT travels with it (never 5,000 per piece)", r.lines[0].rate_type, "flat");
}
{
  const r = copyRatesFrom(
    [line({ source: "expense", item_id: null, description: "LAB TESTS" })],
    [src({ source: "expense", item_id: null, description: "LAB TESTS", rate: 1.5 })],
  );
  check("a line with only a description has no identity — never matched", [r.lines[0].rate, r.matched], [null, 0]);
}

// ---- 3. the rate is ONE fact -------------------------------------------------
{
  const r = copyRatesFrom([line()], [src({ rate: 0.8, currency_code: "usd", ex_rate: 84.25 })]);
  check("a USD rate brings its currency and ex_rate (never Rs 0.80)", [r.lines[0].rate, r.lines[0].currency_code, r.lines[0].ex_rate], [0.8, "USD", 84.25]);
}
{
  const r = copyRatesFrom([line()], [src({ rate: 310, currency_code: "INR", ex_rate: 1 })]);
  check("INR arrives in its one stored spelling: both null", [r.lines[0].currency_code, r.lines[0].ex_rate], [null, null]);
}
{
  const r = copyRatesFrom([line({ source: "material", is_foc: false, is_import: false })], [src({ source: "material", rate: 2, is_import: true })]);
  check("is_import is this order's BOM fact — not copied", r.lines[0].is_import, false);
}
{
  const r = copyRatesFrom([line()], [src({ rate: null, is_foc: true })]);
  check("an FOC source carries no price — not a candidate", [r.lines[0].rate, r.lines[0].is_foc, r.matched], [null, false, 0]);
}

// ---- 4. blanks only ----------------------------------------------------------
{
  const r = copyRatesFrom([line({ rate: 330 })], [src({ rate: 310 })]);
  check("a rate typed today is never overwritten", [r.lines[0].rate, r.matched], [330, 0]);
}
{
  const r = copyRatesFrom([line({ rate: 0 })], [src({ rate: 310 })]);
  check("0 is a typed rate (a free-issue line), not a blank", r.lines[0].rate, 0);
}
{
  const r = copyRatesFrom([line({ is_foc: true })], [src({ rate: 310 })]);
  check("an FOC target is already answered", [r.lines[0].rate, r.matched], [null, 0]);
}
{
  const once = copyRatesFrom([line()], [src({ rate: 310 })]);
  const twice = copyRatesFrom(once.lines, [src({ rate: 999 })]);
  check("pressing Copy From twice changes nothing the first press filled", [twice.lines[0].rate, twice.matched], [310, 0]);
}

// ---- 5. two earlier rates ⇒ copy neither, and say so -------------------------
{
  const r = copyRatesFrom([line()], [src({ rate: 310 }), src({ rate: 325 })]);
  check("two different earlier rates: left blank", r.lines[0].rate, null);
  check("  …and counted as ambiguous, not as matched", [r.matched, r.ambiguous], [0, 1]);
}
{
  const r = copyRatesFrom([line()], [src({ rate: 310 }), src({ rate: 310 })]);
  check("two earlier lines that AGREE are not ambiguous", [r.lines[0].rate, r.matched, r.ambiguous], [310, 1, 0]);
}
{
  const r = copyRatesFrom([line()], [src({ rate: 0.8, currency_code: "USD", ex_rate: 84 }), src({ rate: 0.8, currency_code: "USD", ex_rate: 83 })]);
  check("same number at two exchange rates IS two prices", [r.lines[0].rate, r.ambiguous], [null, 1]);
}
{
  const r = copyRatesFrom([line()], [src({ rate: 310 }), src({ rate: 310, currency_code: "INR", ex_rate: 1 })]);
  check("blank and INR are one currency — not ambiguous", [r.lines[0].rate, r.ambiguous], [310, 0]);
}

// ---- 6. specification narrows, never gates -----------------------------------
{
  const r = copyRatesFrom(
    [line({ source: "material", item_id: "zip", specification: "ykk" })],
    [src({ source: "material", item_id: "zip", specification: "YKK", rate: 9 }), src({ source: "material", item_id: "zip", specification: "LOCAL", rate: 3 })],
  );
  check("a matching specification picks its own rate out of two", [r.lines[0].rate, r.ambiguous], [9, 0]);
}
{
  const r = copyRatesFrom(
    [line({ source: "material", item_id: "zip", specification: "YKK ZIP" })],
    [src({ source: "material", item_id: "zip", specification: "YKK", rate: 9 })],
  );
  check("a spelling drift still finds last season's rate (narrows, never gates)", r.lines[0].rate, 9);
  check("  …and keeps the target's own specification", r.lines[0].specification, "YKK ZIP");
}
{
  const r = copyRatesFrom([line({ source: "material", item_id: "zip" })], [src({ source: "material", item_id: "zip", specification: "YKK", rate: 9 })]);
  check("a blank target specification is filled with what the rate was for", r.lines[0].specification, "YKK");
}
{
  const r = copyRatesFrom(
    [line({ source: "material", item_id: "zip" })],
    [src({ source: "material", item_id: "zip", specification: "YKK", rate: 9 }), src({ source: "material", item_id: "zip", specification: "LOCAL", rate: 3 })],
  );
  check("no target specification + two priced specifications = ambiguous", [r.lines[0].rate, r.ambiguous], [null, 1]);
}

// ---- 7. nothing but rate fields move -----------------------------------------
{
  const t = line({ description: "30S COMBED" });
  const r = copyRatesFrom([t], [src({ rate: 310, description: "SOMETHING ELSE" })]);
  check("description is never copied", r.lines[0].description, "30S COMBED");
  check("an unmatched target line comes back as the same object", copyRatesFrom([t], []).lines[0] === t, true);
}

console.log(failed === 0 ? "\nOK — every copy-from vector holds." : `\n${failed} copy-from vector(s) FAILED.`);
if (failed > 0) process.exit(1);
