// Verification vectors for Upload Buyer PO (doc/order/digitalisation-plan.md §2):
// lib/orders/po-import/match.ts, seed.ts and the request body in request.ts.
//
//     npx --yes tsx scripts/check-po-import-match.mts
//     npm run check:po-import
//
// ## MADE TO FAIL BEFORE IT WAS TRUSTED (2026-10-01)
//
// Run once against a mutated `match.ts` whose `only()` returned the FIRST
// candidate instead of refusing an ambiguous match — the exact bug that would
// put the wrong customer on an order silently. The "ambiguous" vectors below
// failed under that mutation and pass without it.
//
// No API key is needed and no request is sent: the request BODY is built and
// its shape asserted, which is the part a model change or SDK change breaks.

import {
  coreName,
  matchCountry,
  matchCurrency,
  matchCustomer,
  matchSize,
  matchStyle,
  normDate,
  normName,
  sizeKey,
} from "../lib/orders/po-import/match";
import { autoMatch, buildPoSeed, draftTotals, storedFromDraft, unresolved, type PoMasters } from "../lib/orders/po-import/seed";
import { isPoImportPath, poFileKind, poImportPath, type PoDraft } from "../lib/orders/po-import/types";
import { poReadRequest, PO_READER_MODEL } from "../lib/orders/po-import/request";

let pass = 0;
let fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.error(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`);
  }
}

// ---------------------------------------------------------------- names
eq("normName punctuation + &", normName("Asmara & Co., Ltd."), "ASMARA AND CO LTD");
eq("coreName drops legal words", coreName("The Oxbow Pvt. Ltd"), "OXBOW");

const customers = [
  { id: "c-asm", code: "ASM", name: "ASMARA", inactive: false },
  { id: "c-oxb", code: "OXB", name: "OXBOW", inactive: false },
  { id: "c-old", code: null, name: "OLDCO", inactive: true },
  { id: "c-tx1", code: null, name: "RIVER TEXTILES", inactive: false },
  { id: "c-tx2", code: null, name: "RIVER TEXTILES EXPORTS", inactive: false },
];
eq("customer exact", matchCustomer("asmara", customers)?.id, "c-asm");
eq("customer by code", matchCustomer("OXB", customers)?.id, "c-oxb");
eq("customer core (legal words)", matchCustomer("Asmara Limited", customers)?.id, "c-asm");
eq("customer contains, unique", matchCustomer("OXBOW CLOTHING", customers)?.id, "c-oxb");
eq("customer ambiguous contains → null", matchCustomer("RIVER", customers), null);
eq("customer inactive never matched", matchCustomer("OLDCO", customers), null);
eq("customer too short to contain → null", matchCustomer("OX", customers), null);
eq("customer blank → null", matchCustomer("  ", customers), null);

// ---------------------------------------------------------------- sizes
eq("sizeKey 2XL", sizeKey("2XL"), "XXL");
eq("sizeKey 3xl", sizeKey("3xl"), "XXXL");
eq("sizeKey Medium", sizeKey("Medium"), "M");
eq("sizeKey X-Large", sizeKey("X-Large"), "XL");
eq("sizeKey 6-7Y kept", sizeKey("6-7Y"), "67Y");
const sizes = [
  { id: "s-s", name: "S" },
  { id: "s-m", name: "M" },
  { id: "s-l", name: "L" },
  { id: "s-xxl", name: "XXL" },
  { id: "s-32", name: "32" },
];
eq("size 2xl → XXL", matchSize("2xl", sizes)?.id, "s-xxl");
eq("size 32", matchSize("32", sizes)?.id, "s-32");
eq("size XL unmatched", matchSize("XL", sizes), null);
eq("size ambiguous → null", matchSize("S", [...sizes, { id: "s-s2", name: "Small" }]), null);

// ---------------------------------------------------------------- currency / country / style
const currencies = [
  { code: "USD", name: "US DOLLAR", symbol: "$" },
  { code: "EUR", name: "EURO", symbol: "€" },
  { code: "INR", name: "INDIAN RUPEE", symbol: "₹" },
];
eq("currency code", matchCurrency("usd", currencies), "USD");
eq("currency symbol", matchCurrency("€", currencies), "EUR");
eq("currency Rs", matchCurrency("Rs", currencies), "INR");
eq("currency by name", matchCurrency("US Dollar", currencies), "USD");
eq("currency unknown → null", matchCurrency("XYZ", currencies), null);
const countries = [
  { id: "k-us", code: "US", name: "UNITED STATES", inactive: false },
  { id: "k-uk", code: "GB", name: "UNITED KINGDOM", inactive: false },
];
eq("country by name", matchCountry("United States", countries)?.id, "k-us");
eq("country partial → null (no guess)", matchCountry("UNITED", countries), null);
const styles = [
  { id: "st-1", code: "AS-101", name: "BASIC TEE", article_no: "ART9", blocked: false },
  { id: "st-2", code: "AS-102", name: "POLO", article_no: null, blocked: true },
];
eq("style by code", matchStyle("as-101", styles)?.id, "st-1");
eq("style by article", matchStyle("ART9", styles)?.id, "st-1");
eq("style blocked never matched", matchStyle("AS-102", styles), null);

// ---------------------------------------------------------------- dates
eq("date ok", normDate("2026-11-06"), "2026-11-06");
eq("date impossible", normDate("2026-02-30"), null);
eq("date not ISO", normDate("06/11/2026"), null);
eq("date six-digit year", normDate("202611-06-01"), null);
eq("date out of range", normDate("1999-01-01"), null);

// ---------------------------------------------------------------- paths
const p = poImportPath("11111111-1111-1111-1111-111111111111", "f", "Buyer PO.PDF");
eq("path shape", p, "po-imports/11111111-1111-1111-1111-111111111111/f.pdf");
eq("path in own folder", isPoImportPath("11111111-1111-1111-1111-111111111111", p), true);
eq("path in another folder refused", isPoImportPath("22222222-2222-2222-2222-222222222222", p), false);
eq("path traversal refused", isPoImportPath("x", "po-imports/x/../y/f.pdf"), false);
eq("kind xlsx by ext", poFileKind("po.xlsx", null), "xlsx");
eq("kind refuses doc", poFileKind("po.docx", "application/msword"), null);

// ---------------------------------------------------------------- seed
const draft: PoDraft = {
  header: {
    customer_name: "Asmara Ltd",
    po_no: "Po-123/a",
    po_date: "2026-10-01",
    delivery_date: null,
    currency: "$",
    season: "ss27",
    ship_mode: "SEA",
    country: "United States",
  },
  lines: [
    { style_ref_no: "as-101", description: "crew tee", colour: "navy", sizes: [{ size: "S", qty: 100 }, { size: "M", qty: 200 }, { size: "XL", qty: 50 }], unit_price: 4.5, delivery_date: "2026-12-01" },
    { style_ref_no: "AS-101", description: null, colour: "white", sizes: [{ size: "S", qty: 80 }, { size: "M", qty: 120 }], unit_price: 4.5, delivery_date: "2026-12-01" },
    { style_ref_no: "B-7", description: "jogger", colour: "black", sizes: [{ size: "32", qty: 300 }], unit_price: 9, delivery_date: "2026-11-20" },
    { style_ref_no: "B-7", description: null, colour: "grey", sizes: [{ size: "32", qty: 100 }], unit_price: 9.25, delivery_date: "2026-12-15" },
  ],
  stated_total_qty: 950,
  stated_total_value: 6100,
  uncertain: ["header.po_date"],
  notes: null,
};
const masters: PoMasters = { customers, sizes, currencies, countries, styles };
const stored = autoMatch(storedFromDraft(draft), masters);
eq("auto customer", stored.customer_id, "c-asm");
eq("auto currency", stored.currency_code, "USD");
eq("auto country", stored.country_id, "k-us");
eq("auto size map", stored.size_map, { S: "s-s", M: "s-m", XL: null, "32": "s-32" });
eq("auto style map", stored.style_map, { "AS-101": "st-1", "B-7": null });
eq("unresolved names the unmatched size", unresolved(stored), ['Size "XL" matches no size']);
eq("totals", draftTotals(draft), { qty: 950, value: 6100 });

const kept = autoMatch({ ...stored, customer_id: "c-oxb" }, masters);
eq("reviewer's customer choice is never re-matched", kept.customer_id, "c-oxb");

const { header, seed } = buildPoSeed(stored, masters);
eq("header po_no kept as typed", header.po_no, "Po-123/a");
eq("header season caps", header.season, "SS27");
eq("header delivery = earliest line date when PO header has none", header.delivery_date, "2026-11-20");
eq("header currency", header.currency_code, "USD");
eq("two styles", seed.styles.map((s) => [s.style_ref_no, s.po_qty, s.style_id]), [["AS-101", 550, "st-1"], ["B-7", 400, null]]);
eq("style description from first line, caps", seed.styles[0].style_description, "CREW TEE");
eq("style sizes exclude unmatched", seed.styleSizes!.map((s) => [s.style_ref_no, s.size_id]), [["AS-101", "s-s"], ["AS-101", "s-m"], ["B-7", "s-32"]]);
eq("combos per colour", seed.combos.map((c) => [c.style_ref_no, c.combo]), [["AS-101", "NAVY"], ["AS-101", "WHITE"], ["B-7", "BLACK"], ["B-7", "GREY"]]);
eq("one price → Style-wise; two → Color-wise", seed.priceDetails.map((x) => [x.style_ref_no, x.price_type, x.combo, x.price]), [
  ["AS-101", "Style-wise", null, 4.5],
  ["B-7", "Color-wise", "BLACK", 9],
  ["B-7", "Color-wise", "GREY", 9.25],
]);
eq("quantity rows per (style, date)", seed.quantities.map((q) => [q.style_ref_no, q.delivery_date, q.po_qty]), [["AS-101", "2026-12-01", 550], ["B-7", "2026-11-20", 300], ["B-7", "2026-12-15", 100]]);
eq("po qty keeps unmatched-size pieces; cells carry matched only", seed.quantities[0].assort_lines.map((l) => [l.combo, l.sizes.reduce((a, z) => a + z.qty, 0)]), [["NAVY", 300], ["WHITE", 200]]);
eq("quantity row inherits header PO (po_no blank)", seed.quantities.every((q) => q.po_no === null), true);
eq("country carried to quantities", seed.quantities.every((q) => q.country_id === "k-us"), true);
eq("nothing invented for tabs the PO cannot fill", [seed.dyeings.length, seed.prints.length, seed.taActivities!.length], [0, 0, 0]);

// ---------------------------------------------------------------- request shape (no key, no call)
const pdfReq = poReadRequest({ kind: "pdf", base64: "AAAA" });
eq("model", pdfReq.model, PO_READER_MODEL);
eq("model is the skill default", PO_READER_MODEL, "claude-opus-5-5");
eq("fallbacks default form + its header", [pdfReq.fallbacks, pdfReq.betas], ["default", ["server-side-fallback-2026-07-01"]]);
eq("structured output format", (pdfReq.output_config.format as { type: string }).type, "json_schema");
eq("pdf → document block first", (pdfReq.messages[0].content as { type: string }[]).map((b) => b.type), ["document", "text"]);
const xlsReq = poReadRequest({ kind: "text", text: "a,b", fileName: "po.xlsx" });
eq("spreadsheet → one text block naming the file", (xlsReq.messages[0].content as { type: string; text?: string }[]).map((b) => [b.type, b.text?.includes('"po.xlsx"')]), [["text", true]]);
eq("no thinking override (thinking cannot be disabled on this model)", "thinking" in pdfReq, false);

console.log(`check:po-import — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
