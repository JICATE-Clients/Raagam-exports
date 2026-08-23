/**
 * Vectors for `lib/orders/process-chain/**` — a trim chained through
 * Dyeing -> Printing -> Engraving, and the Grey-to-Processed lifecycle.
 *
 * ## THE SUITE IS BUILT AROUND FOUR PAIRS THAT DISAGREE
 *
 * A vector set built from tidy chains passes against almost any implementation,
 * because on a chain where nothing is lost every plausible rule gives the same
 * answer. So each of the four rules this module actually adds is asserted with a
 * pair of vectors that a WRONG implementation would split:
 *
 *  1. **`qty_in` feeds the next stage, not `qty_out`.** Send 1,000, get 960
 *     back. A `qty_out`-based cascade lets the printer be given 1,000 — 40
 *     buttons that no longer exist — and every figure below is built on them.
 *     The pair is "forward 960 (ok)" vs "forward 1,000 (refused)", identical in
 *     every respect except which column the ceiling reads.
 *
 *  2. **The requirement is measured at the TERMINAL stage only.** Three chained
 *     rows each independently reading `covered` against one requirement is the
 *     expensive failure: the merchandiser sees the order satisfied three times
 *     over by one lot of goods. The pair is a middle stage with plenty back
 *     (`in_progress`, NOT `covered`) vs the terminal stage of the same chain.
 *
 *  3. **A partial middle stage does not block, it lowers the ceiling.** Dye
 *     returns come in lots; a rule that waited for the whole lot would stop a
 *     print run that could legitimately start on what has arrived. Asserted as a
 *     number (600 available of 1,000 sent), not as a boolean.
 *
 *  4. **`out_at_process` outranks `issued_to_production` while anything is still
 *     at a processor.** Ranking by furthest state would paint a row with a
 *     running CGST s.143 deadline as finished. Two vectors with the same issued
 *     quantity and different `atVendor`.
 *
 * ## AND FOR THE STRUCTURAL REFUSALS
 *
 * A cycle, a dangling link, a chain that changes material and a chain that
 * re-colours are each asserted, because each is a case the DATABASE cannot
 * catch: 0459's FK sees one individually-valid link at a time and its CHECK only
 * catches a row pointing at itself.
 *
 * Runs under `tsx` for the reason `check-process-return.mts` gives: the modules
 * import `@/lib/...`, and Node's ESM resolver reads neither the alias nor the
 * missing extension.
 *
 *     npx --yes tsx scripts/check-process-chain.mts
 */
import {
  chainSaveRefusal,
  chainVerdicts,
  dispatchCeiling,
  greyCoverage,
  isRefusal,
  qtyOutRefusal,
  readChain,
  type ChainIndex,
  type ChainRow,
} from "@/lib/orders/process-chain/chain";
import { lifecycleOf, greyShortfall } from "@/lib/orders/process-chain/lifecycle";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

/** Asserts a value is NOT something — for the wrong answers a plausible
 *  implementation produces. A vector that only states the right answer cannot
 *  say which wrong one it was guarding against. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  const bad = JSON.stringify(actual) === JSON.stringify(forbidden);
  if (bad) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function refused(label: string, actual: unknown, contains: string) {
  if (!isRefusal(actual)) {
    failed++;
    console.error(`FAIL  ${label}\n      expected a refusal, got ${JSON.stringify(actual)}`);
    return;
  }
  if (!actual.refused.toLowerCase().includes(contains.toLowerCase())) {
    failed++;
    console.error(
      `FAIL  ${label}\n      refusal did not mention "${contains}": ${actual.refused}`,
    );
    return;
  }
  console.log(`ok    ${label}`);
}

const BUTTON = "item-button";
const LABEL = "item-label";
const NAVY = "col-navy";
const RED = "col-red";

const row = (o: Partial<ChainRow> & { row_uid: string }): ChainRow => ({
  item_id: BUTTON,
  process_id: "proc",
  item_color_id: null,
  prev_row_uid: null,
  qty_out: null,
  qty_in: null,
  ...o,
});

const index = (rows: ChainRow[]): ChainIndex => {
  const ix = readChain(rows);
  if (isRefusal(ix)) throw new Error(`vector setup produced a refusal: ${ix.refused}`);
  return ix;
};

// ===========================================================================
// 1. Structure
// ===========================================================================
console.log("\n-- structure --");

{
  // Dyeing -> Printing -> Engraving, the spec's own example.
  const rows = [
    row({ row_uid: "dye", item_color_id: NAVY, qty_out: 1000, qty_in: 960 }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 960, qty_in: 950 }),
    row({ row_uid: "engrave", prev_row_uid: "print", qty_out: 950, qty_in: 945 }),
  ];
  const ix = index(rows);
  check(
    "a three-stage chain numbers its stages by depth",
    [...ix.stages.values()].map((s) => [s.row_uid, s.stage_no]),
    [
      ["dye", 1],
      ["print", 2],
      ["engrave", 3],
    ],
  );
  check("only the last stage is terminal", [...ix.stages.values()].map((s) => s.terminal), [
    false,
    false,
    true,
  ]);
  check(
    "the colour set at Dyeing carries down the chain",
    [...ix.stages.values()].map((s) => s.effective_color_id),
    [NAVY, NAVY, NAVY],
  );
  check("the whole chain descends from one head", [...ix.stages.values()].map((s) => s.root_row_uid), [
    "dye",
    "dye",
    "dye",
  ]);
}

{
  // One grey lot, two colour batches: two HEADS, not a fan-out. This is what
  // §6's "one bulk Grey purchase is sliced into multiple colour-wise batches"
  // actually looks like in the row shape.
  const rows = [
    row({ row_uid: "dye-navy", item_color_id: NAVY, qty_out: 600 }),
    row({ row_uid: "dye-red", item_color_id: RED, qty_out: 400 }),
  ];
  const ix = index(rows);
  check("two colour batches are two heads, each at stage 1", ix.roots, ["dye-navy", "dye-red"]);
  check(
    "a head is fed by grey stock, not by another stage",
    dispatchCeiling("dye-navy", rows, ix),
    { source: "grey" },
  );
}

refused(
  "a link to a stage that is not on the BOM is refused",
  readChain([row({ row_uid: "print", prev_row_uid: "gone" })]),
  "no longer on this BOM",
);

refused(
  "a stage set to feed itself is refused",
  readChain([row({ row_uid: "dye", prev_row_uid: "dye" })]),
  "feed itself",
);

refused(
  "a two-stage loop is refused — neither row is ever reached from a head",
  readChain([
    row({ row_uid: "a", prev_row_uid: "b" }),
    row({ row_uid: "b", prev_row_uid: "a" }),
  ]),
  "loop",
);

refused(
  "a chain that changes material is refused — that is two jobs, not one chain",
  readChain([
    row({ row_uid: "dye", qty_in: 900 }),
    row({ row_uid: "print", prev_row_uid: "dye", item_id: LABEL }),
  ]),
  "different material",
);

refused(
  "a later stage may not overwrite a colour an earlier stage set",
  readChain([
    row({ row_uid: "dye", item_color_id: NAVY, qty_in: 900 }),
    row({ row_uid: "print", prev_row_uid: "dye", item_color_id: RED }),
  ]),
  "change a colour",
);

{
  // Grey at stage 1, coloured at stage 2 is the ORDINARY case and must pass —
  // the refusal above must not have been written as "the colour may never
  // change", which would refuse every dye chain that starts undyed.
  const ix = readChain([
    row({ row_uid: "wash", qty_in: 900 }),
    row({ row_uid: "dye", prev_row_uid: "wash", item_color_id: NAVY }),
  ]);
  refute("a grey stage followed by a dye stage is NOT refused", isRefusal(ix), true);
}

// ===========================================================================
// 2. THE CASCADE — `qty_in` feeds the next stage, never `qty_out`
// ===========================================================================
console.log("\n-- the cascade --");

{
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 960 }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 960 }),
  ];
  const ix = index(rows);
  check(
    "the ceiling on a later stage is what CAME BACK, not what went out",
    dispatchCeiling("print", rows, ix),
    { source: "stage", ceiling: 960, fedBy: 960, takenBySiblings: 0 },
  );
  refute(
    "the ceiling is NOT what the stage above sent out",
    (dispatchCeiling("print", rows, ix) as { ceiling?: number }).ceiling,
    1000,
  );
  check("forwarding exactly what came back is allowed", qtyOutRefusal("print", rows, ix), null);
}

{
  // The pair. Same chain, one digit different, and only a `qty_in`-based rule
  // splits them.
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 960 }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 1000 }),
  ];
  refused(
    "forwarding the 40 that never came back is refused, and says the number",
    qtyOutRefusal("print", rows, index(rows)),
    "960",
  );
}

{
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: null }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 500 }),
  ];
  refused(
    "a stage cannot send before anything has come back to it",
    qtyOutRefusal("print", rows, index(rows)),
    "come back",
  );
}

{
  // A HEAD IS NEVER REFUSED HERE. Its ceiling is stock, checked when the challan
  // is posted — refusing on this screen would block a BOM written months before
  // the greige is bought, which is the ordinary case.
  const rows = [row({ row_uid: "dye", qty_out: 1_000_000 })];
  check("a head's quantity is not judged by the chain", qtyOutRefusal("dye", rows, index(rows)), null);
}

{
  // FAN-OUT: 960 back from the dyer, 400 go on to engraving, 560 do not. The
  // ceiling is shared, and the second branch sees what the first took.
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 960 }),
    row({ row_uid: "engrave", prev_row_uid: "dye", qty_out: 400 }),
    row({ row_uid: "emboss", prev_row_uid: "dye", qty_out: 0 }),
  ];
  const ix = index(rows);
  check(
    "a sibling branch may take only what its siblings have left",
    dispatchCeiling("emboss", rows, ix),
    { source: "stage", ceiling: 560, fedBy: 960, takenBySiblings: 400 },
  );
  check("the branch that took 400 is within its own ceiling", qtyOutRefusal("engrave", rows, ix), null);
}

{
  // Two branches that between them exceed the return. Each is individually
  // plausible; only their sum is wrong, so the ceiling shrinks and the second
  // branch is the one refused.
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 900 }),
    row({ row_uid: "engrave", prev_row_uid: "dye", qty_out: 600 }),
    row({ row_uid: "emboss", prev_row_uid: "dye", qty_out: 500 }),
  ];
  const ix = index(rows);
  check(
    "a sibling's ceiling shrinks by what the other branch has taken",
    dispatchCeiling("emboss", rows, ix),
    { source: "stage", ceiling: 300, fedBy: 900, takenBySiblings: 600 },
  );
  refused(
    "and the branch that overruns the shared return is refused, naming what is left",
    qtyOutRefusal("emboss", rows, ix),
    "300",
  );
}

{
  // A NEGATIVE ceiling is a different failure and must not be clamped to 0: the
  // siblings ALONE have already forwarded more than came back, so the row being
  // looked at is healthy and the row beside it is the one describing goods that
  // do not exist. A clamp would show "0 available" here and say nothing.
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 500 }),
    row({ row_uid: "engrave", prev_row_uid: "dye", qty_out: 800 }),
    row({ row_uid: "emboss", prev_row_uid: "dye", qty_out: 0 }),
  ];
  const ceiling = dispatchCeiling("emboss", rows, index(rows));
  refused(
    "a ceiling below zero is reported, not clamped",
    ceiling,
    "only 500 came back",
  );
  refute("it is NOT quietly turned into a ceiling of 0", (ceiling as { ceiling?: number }).ceiling, 0);
}

// ===========================================================================
// 3. A HALF-RECEIVED MIDDLE STAGE — lowers the ceiling, never blocks
// ===========================================================================
console.log("\n-- a half-received middle stage --");

{
  // 1,000 at the dyer, 600 back so far. The printer can start on 600.
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 600 }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 600 }),
  ];
  const ix = index(rows);
  check(
    "600 of 1,000 back means 600 available — not 0, and not 1,000",
    dispatchCeiling("print", rows, ix),
    { source: "stage", ceiling: 600, fedBy: 600, takenBySiblings: 0 },
  );
  check("starting the next stage on what has arrived is allowed", qtyOutRefusal("print", rows, ix), null);

  check(
    "the middle stage still shows what is at its own vendor",
    lifecycleOf({
      stage: ix.stages.get("dye")!,
      qty_out: 1000,
      qty_in: 600,
      challanCode: "DC-0007",
      dispatchPosted: true,
      greyOnHand: null,
      issuedQty: null,
    }),
    {
      state: "out_at_process",
      atVendor: 400,
      returned: 600,
      challan: "DC-0007",
      next: "Record the return against challan DC-0007",
    },
  );
}

// ===========================================================================
// 4. THE VERDICT — the requirement is read at the TERMINAL stage only
// ===========================================================================
console.log("\n-- the verdict --");

{
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 980 }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 980, qty_in: 970 }),
    row({ row_uid: "engrave", prev_row_uid: "print", qty_out: 970, qty_in: 960 }),
  ];
  const need = new Map([[BUTTON, 940]]);
  const v = chainVerdicts(rows, index(rows), need);

  check("a middle stage reports work in progress, with what it is holding", v.get("dye"), {
    kind: "in_progress",
    returned: 980,
    atVendor: 20,
    stagesRemaining: 2,
  });
  refute(
    "a middle stage does NOT report the order covered — 980 dyed buttons are not 940 finished ones",
    (v.get("dye") as { kind: string }).kind,
    "terminal",
  );
  check("the terminal stage is the one measured against the requirement", v.get("engrave"), {
    kind: "terminal",
    verdict: { state: "covered", issuable: 960, atVendor: 10 },
  });
}

{
  // The same chain against a tighter requirement: short, and by the amount the
  // LAST stage returned — not the amount the first one did.
  const rows = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 980 }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 980, qty_in: 950 }),
  ];
  const v = chainVerdicts(rows, index(rows), new Map([[BUTTON, 970]]));
  check("shortfall is measured on the finished goods", v.get("print"), {
    kind: "terminal",
    verdict: { state: "short", issuable: 950, atVendor: 30, shortfall: 20 },
  });
}

// ===========================================================================
// 5. A SAVE MAY NOT DEFEAT THE DISPATCH RULE
// ===========================================================================
console.log("\n-- what a save may not do --");

{
  const saved = [
    row({ row_uid: "dye", qty_out: 1000, qty_in: 960 }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 960 }),
  ];
  const dispatched = new Set(["print"]);

  check(
    "an unchanged chain saves",
    chainSaveRefusal(saved, saved, dispatched),
    null,
  );

  refused(
    "the PREDECESSOR of a dispatched stage cannot be dropped — that would make it a head fed by grey",
    chainSaveRefusal(saved.filter((r) => r.row_uid !== "dye"), saved, dispatched),
    "cannot be removed",
  );

  refused(
    "a dispatched stage cannot be re-pointed at a different source",
    chainSaveRefusal(
      [
        ...saved.filter((r) => r.row_uid !== "print"),
        row({ row_uid: "print", prev_row_uid: null, qty_out: 960 }),
      ],
      saved,
      dispatched,
    ),
    "cannot be changed",
  );

  check(
    "dropping the predecessor of a stage that has NOT been dispatched is allowed",
    chainSaveRefusal(saved.filter((r) => r.row_uid !== "dye"), saved, new Set<string>()),
    null,
  );
}

// ===========================================================================
// 6. GREY AGAINST COLOUR — a reconciliation, not a second rollup
// ===========================================================================
console.log("\n-- grey against colour --");

{
  const heads = [
    row({ row_uid: "dye-navy", item_color_id: NAVY, qty_out: 600 }),
    row({ row_uid: "dye-red", item_color_id: RED, qty_out: 300 }),
  ];
  check(
    "the bulk grey figure is the sum of the colour batches, and each colour is checked",
    greyCoverage(
      [
        { item_color_id: NAVY, qty: 600 },
        { item_color_id: RED, qty: 400 },
      ],
      heads,
    ),
    {
      greyPlanned: 900,
      greyRequired: 1000,
      perColour: [
        { item_color_id: NAVY, required: 600, planned: 600, shortBy: 0 },
        { item_color_id: RED, required: 400, planned: 300, shortBy: 100 },
      ],
      unplanned: [],
      stray: [],
    },
  );
}

{
  const cov = greyCoverage(
    [
      { item_color_id: NAVY, qty: 600 },
      { item_color_id: RED, qty: 400 },
    ],
    [row({ row_uid: "dye-navy", item_color_id: NAVY, qty_out: 600 })],
  );
  check(
    "a colour the order needs with no chain head is named — the grey is bought and nothing dyes it",
    isRefusal(cov) ? cov : cov.unplanned,
    [RED],
  );
}

{
  const cov = greyCoverage(
    [{ item_color_id: NAVY, qty: 600 }],
    [
      row({ row_uid: "dye-navy", item_color_id: NAVY, qty_out: 600 }),
      row({ row_uid: "dye-red", item_color_id: RED, qty_out: 400 }),
    ],
  );
  check(
    "a dye job for a colour no line needs is named too",
    isRefusal(cov) ? cov : cov.stray,
    [RED],
  );
}

refused(
  "a non-head passed as a head is refused — only stage 1 draws from grey",
  greyCoverage([{ item_color_id: NAVY, qty: 100 }], [row({ row_uid: "print", prev_row_uid: "dye" })]),
  "first stage",
);

refused(
  "an unanswered requirement is not treated as zero",
  greyCoverage([{ item_color_id: NAVY, qty: NaN }], []),
  "not been worked out",
);

// ===========================================================================
// 7. THE FOUR LIFECYCLE STATES
// ===========================================================================
console.log("\n-- the lifecycle --");

const head = index([row({ row_uid: "dye" })]).stages.get("dye")!;
/** A genuine MIDDLE stage — one with a stage above it AND one below. A two-row
 *  chain's second row is terminal, and using it here would have asserted the
 *  terminal branch twice while claiming to test the middle one. */
const mid = (() => {
  const ix = index([
    row({ row_uid: "dye", qty_in: 900 }),
    row({ row_uid: "print", prev_row_uid: "dye", qty_out: 900, qty_in: 900 }),
    row({ row_uid: "engrave", prev_row_uid: "print" }),
  ]);
  return ix.stages.get("print")!;
})();

const base = {
  qty_out: null as number | null,
  qty_in: null as number | null,
  challanCode: null as string | null,
  dispatchPosted: false,
  greyOnHand: null as number | null,
  issuedQty: null as number | null,
};

check(
  "an unread stock figure is `planned`, never 0 on hand",
  lifecycleOf({ ...base, stage: head }),
  { state: "planned", next: "Read stock for this material, or send it out" },
);

check(
  "§6 state 1 — grey on hand and nothing sent yet",
  lifecycleOf({ ...base, stage: head, greyOnHand: 1000 }),
  { state: "grey_purchased", onHand: 1000, next: "Raise a Delivery Challan to send it out" },
);

check(
  "no grey at all is `awaiting_grey`, which sends a buyer after it",
  lifecycleOf({ ...base, stage: head, greyOnHand: 0 }),
  {
    state: "awaiting_grey",
    onHand: 0,
    shortBy: 0,
    next: "Buy the grey stock this chain starts from",
  },
);

check(
  "a LATER stage with nothing sent is never awaiting grey — its input is the stage above",
  lifecycleOf({ ...base, stage: mid, greyOnHand: 0 }),
  { state: "planned", next: "Waiting for the stage before this one to return material" },
);

check(
  "§6 state 2 — out at the processor, and the challan is named",
  lifecycleOf({
    ...base,
    stage: head,
    qty_out: 1000,
    qty_in: 0,
    challanCode: "DC-0002",
    dispatchPosted: true,
  }),
  {
    state: "out_at_process",
    atVendor: 1000,
    returned: 0,
    challan: "DC-0002",
    next: "Record the return against challan DC-0002",
  },
);

check(
  "§6 state 3 — everything back, and a terminal stage says it is issuable",
  lifecycleOf({ ...base, stage: head, qty_out: 1000, qty_in: 1000, challanCode: "DC-0002" }),
  { state: "finished_received", received: 1000, next: "Ready to issue to production" },
);

check(
  "a middle stage fully back is told to send it on, not to issue it",
  lifecycleOf({ ...base, stage: mid, qty_out: 900, qty_in: 900 }),
  { state: "finished_received", received: 900, next: "Send it on to the next process" },
);

check(
  "§6 state 4 — issued, with what is left still stated",
  lifecycleOf({ ...base, stage: head, qty_out: 1000, qty_in: 1000, issuedQty: 700 }),
  { state: "issued_to_production", issued: 700, received: 1000, next: "300 still in stock" },
);

{
  // THE PAIR. Same issued quantity; only `atVendor` differs. A "furthest state
  // wins" ranking would call the first one finished while 400 units sit at a
  // processor with the CGST s.143 one-year clock running on them.
  const stillOut = lifecycleOf({
    ...base,
    stage: head,
    qty_out: 1000,
    qty_in: 600,
    challanCode: "DC-0009",
    issuedQty: 500,
  });
  refute(
    "material still at a processor is NOT reported as issued to production",
    (stillOut as { state: string }).state,
    "issued_to_production",
  );
  check(
    "it reports what is still out, which is the fact with a statutory deadline on it",
    (stillOut as { state: string; atVendor: number }).atVendor,
    400,
  );
}

refused(
  "more back than went out is refused — it would make the balance read as a credit",
  lifecycleOf({ ...base, stage: head, qty_out: 100, qty_in: 200 }),
  "come back than went out",
);

refused(
  "issuing more than came back is refused",
  lifecycleOf({ ...base, stage: head, qty_out: 100, qty_in: 100, issuedQty: 150 }),
  "issued to production than has come back",
);

refused(
  "a posted dispatch on a row showing nothing sent is refused",
  lifecycleOf({ ...base, stage: head, qty_out: 0, dispatchPosted: true }),
  "shows nothing sent",
);

check(
  "the grey shortfall is a number once both halves are known",
  greyShortfall(1000, 600),
  { shortBy: 400 },
);
refused(
  "and a refusal, never 0, when the stock figure has not been read",
  greyShortfall(1000, null),
  "has not been read",
);

// ---------------------------------------------------------------------------

console.log(failed === 0 ? "\nAll process-chain vectors pass." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
