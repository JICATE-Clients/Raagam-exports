/**
 * Multi-process chaining — one trim item taken through Dyeing -> Printing ->
 * Engraving, one colour batch at a time.
 *
 * doc/file.md §6. This module is the RULES half of that section and nothing
 * else: what stage follows what, which quantity feeds the next stage, which
 * transitions are legal, and what refuses. Client-safe on purpose — the Save
 * button reads it as the operator types and the server action reads it again
 * before writing, the split `bom-ceiling.ts` already uses.
 *
 * ## WHAT THIS DELIBERATELY DOES NOT DO
 *
 * §6 reads as six new things. Five of them are already built, and re-deriving
 * any of them here would produce a second answer to a question that already has
 * one — the worst outcome available to this file:
 *
 *   - **The colour-wise rollup.** `colourSplits` (material-bom/requirement.ts)
 *     collapses per-panel rows onto trim colour, and `bomCeilingForOrder`
 *     (purchase/bom-ceiling-service.ts) groups them by `(item_id,
 *     item_color_id)`, clears each colour's MOQ, then sums BACK to the material
 *     because "a PO line names an item and not a colour". That two-step IS §6's
 *     "grouping dyed colourways to facilitate bulk undyed procurement". This
 *     file CONSUMES its output (`greyCoverage`) and computes none of it.
 *   - **The challan.** `createDcFromBom` + `dc_line_items.mba_process_row_uid`
 *     (0446), one challan per consignment.
 *   - **The stock legs.** `post_dc_stock` (0447 · 0448) transfers material store
 *     -> ST-PROC on dispatch and back on return, so an MRS physically cannot
 *     issue buttons that are sitting at a dyer.
 *   - **The shortfall verdict.** `processVerdict`
 *     (material-bom/process-return.ts), measured against the REQUIREMENT and not
 *     against what was sent. `chainVerdict` below delegates to it rather than
 *     restating it — with one correction stated there.
 *   - **The one-year job-work clock.** `jobWorkAgeing`, same file.
 *
 * ## THE STAGE NUMBER IS DERIVED, NOT STORED
 *
 * 0459 adds `prev_row_uid` and no ordinal. The number an operator reads as
 * "Stage 2 of 3" is DEPTH in the link graph, computed here, and both the screen
 * and the server read it from this one function. A stored ordinal would be a
 * second statement of the same fact, free to disagree with the links — and when
 * it disagreed the operator would see "Stage 2" beside arithmetic drawn from a
 * different row. Same rule the Balance cell on this screen already states about
 * itself.
 *
 * ## THE QUANTITY THAT FEEDS THE NEXT STAGE IS `qty_in`, NEVER `qty_out`
 *
 * This is the whole arithmetic of the feature and it is easy to get backwards.
 * Send 1,000 greige buttons to the dyer and 960 come back: the printer can be
 * given 960. Chaining off `qty_out` would let the BOM plan a print run on 40
 * buttons that no longer exist, and every figure downstream — the requirement
 * cover, the challan, the ITC-04 filing — would be built on them.
 *
 * Dye loss and shrinkage are normal, expected and estimated rather than
 * measured (see `process-return.ts`), so this is not an edge case; it is what
 * every ordinary job looks like.
 *
 * ## A CHAIN IS A TREE. FAN-OUT IS LEGAL, FAN-IN IS NOT.
 *
 * 1,000 buttons come back navy, 400 go on to be engraved and 600 do not. That is
 * ordinary, so a stage may have several successors and the ceiling is shared
 * between them: each may forward at most `prev.qty_in` less what its siblings
 * have already forwarded.
 *
 * Fan-IN is refused by the shape — one `prev_row_uid` per row. Two dye lots
 * merging into one print run would make "how much came back to feed this"
 * unanswerable without a second quantity column, and an unanswerable number here
 * is a number somebody sends a lorry on.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * The rule `requirement.ts` and `process-return.ts` both record. Every branch
 * that cannot answer returns a `Refusal` carrying the SENTENCE the screen
 * prints. A ceiling of 0 appears in exactly one place below and means "nothing
 * has come back yet to forward", which is a fact and not a failure to compute
 * one.
 */

import {
  isRefusal,
  type Refusal,
} from "@/lib/orders/material-bom/requirement";
import {
  processVerdict,
  type ProcessVerdict,
} from "@/lib/orders/material-bom/process-return";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * One Processes row, as much of it as the chain rules need.
 *
 * `row_uid` and `prev_row_uid` are the 0446/0459 anchors — never `id`, which
 * `writeChildren` re-mints on every save, and never the screen's render `key`,
 * which is minted fresh on every load.
 */
export type ChainRow = {
  row_uid: string;
  item_id: string | null;
  process_id: string | null;
  /** The colourway this stage PRODUCES. NULL = grey — a real value, not missing. */
  item_color_id: string | null;
  /** The stage whose RETURN feeds this one. NULL = a head, fed by grey stock. */
  prev_row_uid: string | null;
  qty_out: number | null;
  qty_in: number | null;
};

/** One row's place in the graph, all of it derived. */
export type ChainStage = {
  row_uid: string;
  /** 1-based DEPTH. Derived here and stored nowhere — see the header. */
  stage_no: number;
  prev_row_uid: string | null;
  /** Every stage drawing from this one. Several is legal (fan-out). */
  next_row_uids: string[];
  /** The head this stage descends from. Equal to `row_uid` on a head. */
  root_row_uid: string;
  /**
   * The colour in force here: this row's own, or the nearest upstream one.
   * NULL all the way up means the batch is still grey at this stage, which is
   * exactly what a chain that has not reached its dye step looks like.
   */
  effective_color_id: string | null;
  /** Nothing draws from this row. The finished-goods stage of its branch. */
  terminal: boolean;
};

export type ChainIndex = {
  /** Keyed by `row_uid`. */
  stages: Map<string, ChainStage>;
  /** `row_uid`s, roots first then depth-first — the order a chain reads in. */
  order: string[];
  /** The heads, in input order. Each is one colour batch drawn from grey stock. */
  roots: string[];
};

/**
 * Read the links into a graph, refusing anything that cannot be walked.
 *
 * Called with EVERY process row of one amendment. Passing a subset would make a
 * link to a row outside the subset look dangling and refuse a correct BOM.
 *
 * The refusals here are all structural, and each names the failure it prevents:
 *
 *  - **a dangling link** — the successor would silently read as a head and draw
 *    its input from grey stock instead of from the stage above it. The DB refuses
 *    this too (0459's FK); this is the same rule where the operator can read it,
 *    before the save.
 *  - **a cycle** — the walk would not terminate, and there is no first stage.
 *  - **a chain that changes material** — Dyeing a button and Printing a label is
 *    two jobs, not one chain, and the quantity cascade between them is arithmetic
 *    over two different things.
 *  - **a chain that re-colours** — once Dyeing has made the batch navy, a later
 *    stage naming red is either a typo or an over-dye nobody has priced. Refused
 *    rather than guessed, because the colour is what the requirement matches on.
 */
export function readChain(rows: readonly ChainRow[]): ChainIndex | Refusal {
  const byUid = new Map<string, ChainRow>();
  for (const r of rows) {
    if (!r.row_uid) {
      return { refused: "A process row has no anchor — reopen the BOM and try again" };
    }
    if (byUid.has(r.row_uid)) {
      // Two rows sharing an anchor would each claim the other's challan. The DB
      // refuses it (uq_mba_proc_row_uid); a form can still produce it in memory.
      return { refused: "Two process rows share one anchor — reopen the BOM and try again" };
    }
    byUid.set(r.row_uid, r);
  }

  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (r.prev_row_uid == null) continue;
    if (r.prev_row_uid === r.row_uid) {
      return { refused: `${label(r)} is set to feed itself` };
    }
    const prev = byUid.get(r.prev_row_uid);
    if (!prev) {
      return {
        refused: `${label(r)} follows a stage that is no longer on this BOM — pick the stage it comes after`,
      };
    }
    children.set(r.prev_row_uid, [...(children.get(r.prev_row_uid) ?? []), r.row_uid]);
  }

  const stages = new Map<string, ChainStage>();
  const order: string[] = [];
  const roots = rows.filter((r) => r.prev_row_uid == null).map((r) => r.row_uid);

  /*
   * Depth-first from each head. `seen` is per-walk and `stages` is global, so a
   * row reached twice is impossible here — one `prev_row_uid` per row means one
   * parent — while a CYCLE is a set of rows no walk ever reaches at all. It is
   * caught after the walks rather than during them, which is why the count test
   * below is the cycle detector and not an afterthought.
   */
  const walk = (uid: string, depth: number, rootUid: string, inheritedColour: string | null) => {
    const row = byUid.get(uid)!;
    const colour = row.item_color_id ?? inheritedColour;
    const kids = children.get(uid) ?? [];
    stages.set(uid, {
      row_uid: uid,
      stage_no: depth,
      prev_row_uid: row.prev_row_uid,
      next_row_uids: kids,
      root_row_uid: rootUid,
      effective_color_id: colour,
      terminal: kids.length === 0,
    });
    order.push(uid);
    for (const k of kids) walk(k, depth + 1, rootUid, colour);
  };
  for (const r of roots) walk(r, 1, r, null);

  if (stages.size !== byUid.size) {
    /*
     * Every row not reached from a head is in a cycle — a set of rows each
     * pointing at another member. The FK cannot see this (each link is
     * individually valid) and the self-loop CHECK only catches the length-1
     * case, so this is the only place a two-stage loop is ever refused.
     */
    const stranded = [...byUid.values()].filter((r) => !stages.has(r.row_uid));
    return {
      refused: `${stranded.map(label).join(" and ")} feed each other in a loop — no stage comes first`,
    };
  }

  // The two content rules, applied once the graph is known to be walkable.
  for (const s of stages.values()) {
    if (s.prev_row_uid == null) continue;
    const row = byUid.get(s.row_uid)!;
    const prev = byUid.get(s.prev_row_uid)!;

    if (row.item_id && prev.item_id && row.item_id !== prev.item_id) {
      return {
        refused: `${label(row)} processes a different material from the stage before it — a chain follows one material`,
      };
    }

    const upstream = stages.get(s.prev_row_uid)!.effective_color_id;
    if (row.item_color_id && upstream && row.item_color_id !== upstream) {
      return {
        refused: `${label(row)} would change a colour an earlier stage has already set — start a separate chain instead`,
      };
    }
  }

  return { stages, order, roots };
}

/** What a row is called in a refusal. `sno` is not carried here (it is renumbered
 *  on every save), so the process is the only stable thing to name it by. */
function label(r: ChainRow): string {
  return r.process_id ? "This process stage" : "A process stage";
}

// ---------------------------------------------------------------------------
// The quantity cascade
// ---------------------------------------------------------------------------

/**
 * How much a stage may still send out.
 *
 * A HEAD IS NOT UNLIMITED AND THIS DOES NOT PRETEND TO KNOW ITS LIMIT. Its input
 * is grey stock, governed by `stock_balances` and enforced where it belongs —
 * `apply_stock_movement` raises on a negative balance when the challan is posted
 * (0447). Returning a number here would be inventing one; `{ source: "grey" }`
 * says which rule applies instead.
 */
export type DispatchCeiling =
  | { source: "grey" }
  | {
      source: "stage";
      /** Units this stage may still send. 0 is a real answer: nothing has come
       *  back yet, or the siblings have taken it all. */
      ceiling: number;
      /** What the stage above returned. */
      fedBy: number;
      /** What this stage's siblings have already forwarded out of it. */
      takenBySiblings: number;
    };

export function dispatchCeiling(
  rowUid: string,
  rows: readonly ChainRow[],
  index: ChainIndex,
): DispatchCeiling | Refusal {
  const stage = index.stages.get(rowUid);
  if (!stage) return { refused: "That process stage is not on this BOM any more" };
  if (stage.prev_row_uid == null) return { source: "grey" };

  const byUid = new Map(rows.map((r) => [r.row_uid, r]));
  const prev = byUid.get(stage.prev_row_uid);
  if (!prev) return { refused: "The stage this one follows is not on this BOM any more" };

  // `qty_in`, NEVER `qty_out` — the header states why this is the whole feature.
  const fedBy = num(prev.qty_in) ?? 0;

  let takenBySiblings = 0;
  for (const sib of index.stages.get(stage.prev_row_uid)!.next_row_uids) {
    if (sib === rowUid) continue;
    takenBySiblings += num(byUid.get(sib)?.qty_out) ?? 0;
  }

  const ceiling = fedBy - takenBySiblings;
  if (ceiling < 0) {
    /*
     * The siblings between them have already forwarded more than came back. A
     * negative ceiling clamped to 0 would hide it: the operator would see "0
     * available" on a healthy-looking row and never learn that the row BESIDE it
     * is the one describing goods that do not exist.
     */
    return {
      refused: `Later stages have sent out ${fmt(takenBySiblings)} but only ${fmt(fedBy)} came back — correct those first`,
    };
  }
  return { source: "stage", ceiling, fedBy, takenBySiblings };
}

/**
 * The refusal the Save button and the server action both read: is this stage
 * sending out more than the stage above it returned?
 *
 * `null` means "nothing to say", which is what a caller composing several checks
 * needs — not `{ refused: "" }`, which reads as an error with no message.
 *
 * A HEAD IS NEVER REFUSED HERE. Its ceiling is stock, and stock is checked when
 * the challan is posted. Refusing on this screen would block a BOM written
 * months before the greige is bought — which is the ordinary case (0446's note
 * on `stock_posted_at`).
 */
export function qtyOutRefusal(
  rowUid: string,
  rows: readonly ChainRow[],
  index: ChainIndex,
): Refusal | null {
  const ceiling = dispatchCeiling(rowUid, rows, index);
  if (isRefusal(ceiling)) return ceiling;
  if (ceiling.source === "grey") return null;

  const out = num(rows.find((r) => r.row_uid === rowUid)?.qty_out) ?? 0;
  if (out <= ceiling.ceiling) return null;

  if (ceiling.fedBy === 0) {
    return {
      refused: "Nothing has come back from the stage before this one yet — record its return first",
    };
  }
  return {
    refused: `Only ${fmt(ceiling.ceiling)} came back from the stage before this one — this stage cannot send ${fmt(out)}`,
  };
}

// ---------------------------------------------------------------------------
// The verdict, corrected for a chain
// ---------------------------------------------------------------------------

/**
 * What a stage amounts to, once its place in the chain is known.
 *
 * ## THE CORRECTION THIS TYPE EXISTS FOR
 *
 * `processVerdict` reads ONE row against the requirement and answers
 * covered/short. That is right for a single-stage job and WRONG for a middle
 * stage, in the expensive direction: 1,000 buttons back from the dyer against a
 * requirement of 940 reads "covered" — and they are undyed-then-dyed buttons
 * that still have to be printed and engraved before anything can be sewn with
 * them. Three chained rows would each independently report "covered" against the
 * same requirement, and a merchandiser reading the grid would see the order
 * satisfied three times over by one lot of goods.
 *
 * So the requirement is measured at the TERMINAL stage only. A middle stage
 * reports `in_progress` and says what it is holding, which is true and useful and
 * is not a claim about the order being covered.
 */
export type ChainStageVerdict =
  | { kind: "terminal"; verdict: ProcessVerdict }
  | {
      kind: "in_progress";
      /** Back from this stage and available to the next one. */
      returned: number;
      /** Still at this stage's processor. */
      atVendor: number;
      /** How many stages remain below this one on the longest branch. */
      stagesRemaining: number;
    };

/**
 * Read every stage of an amendment.
 *
 * `requiredByItem` is the SUM of the stored requirement rows per material — the
 * same `byItem` roll-up `bomCeilingForOrder` builds, and it must be the same
 * roll-up. Passing one slice's figure would compare a whole return against a
 * fraction of the need and report every chain as covered (`processVerdict`
 * records the same trap).
 */
export function chainVerdicts(
  rows: readonly ChainRow[],
  index: ChainIndex,
  requiredByItem: ReadonlyMap<string, number>,
): Map<string, ChainStageVerdict | Refusal> {
  const out = new Map<string, ChainStageVerdict | Refusal>();

  for (const r of rows) {
    const stage = index.stages.get(r.row_uid);
    if (!stage) {
      out.set(r.row_uid, { refused: "That process stage is not on this BOM any more" });
      continue;
    }

    if (stage.terminal) {
      const need = r.item_id ? (requiredByItem.get(r.item_id) ?? null) : null;
      // `sent_on` is not this module's business — the one-year clock is read
      // from the CHALLAN's date (`jobWorkAgeing`, and 0446: "the dispatch date
      // IS the challan date"). Passing null here asks `processVerdict` only the
      // question it is being asked.
      const v = processVerdict({ qty_out: r.qty_out, qty_in: r.qty_in, sent_on: null }, need);
      out.set(r.row_uid, isRefusal(v) ? v : { kind: "terminal", verdict: v });
      continue;
    }

    const sent = num(r.qty_out) ?? 0;
    const back = num(r.qty_in) ?? 0;
    out.set(r.row_uid, {
      kind: "in_progress",
      returned: back,
      atVendor: Math.max(sent - back, 0),
      stagesRemaining: depthBelow(r.row_uid, index),
    });
  }

  return out;
}

/** Stages below this one on the LONGEST branch — what "2 more stages to go" means. */
function depthBelow(uid: string, index: ChainIndex): number {
  const kids = index.stages.get(uid)?.next_row_uids ?? [];
  if (kids.length === 0) return 0;
  return 1 + Math.max(...kids.map((k) => depthBelow(k, index)));
}

// ---------------------------------------------------------------------------
// What a save may not do
// ---------------------------------------------------------------------------

/**
 * The chain's half of the dispatched-row rule.
 *
 * `writeChildren` already refuses to drop a row that has a challan against it —
 * "a material already sent out under challan DC-0002 cannot be removed from this
 * BOM". Chaining adds two ways to defeat that without ever touching the
 * dispatched row itself, and both are silent:
 *
 *  - **remove its PREDECESSOR.** The Printing row is at the vendor under a
 *    challan; delete the Dyeing row above it and the Printing row becomes a head
 *    whose input is grey stock. Nothing errors. The DB's NO ACTION FK refuses the
 *    lone delete, but `writeChildren` deletes the whole amendment in one
 *    statement and reinserts — so the FK never sees it, and this check is the
 *    only thing standing there.
 *  - **re-point it.** Change a dispatched row's `prev_row_uid` and the challan
 *    that has already left the building is now described as coming from
 *    somewhere else.
 *
 * Both take the SAVED rows and the INCOMING ones, because both are questions
 * about what changed.
 */
export function chainSaveRefusal(
  next: readonly ChainRow[],
  saved: readonly ChainRow[],
  /** `row_uid`s that already carry a `dc_line_items` line — the dispatched set
   *  `writeChildren` reads before its delete. */
  dispatched: ReadonlySet<string>,
): Refusal | null {
  const nextByUid = new Map(next.map((r) => [r.row_uid, r]));
  const savedByUid = new Map(saved.map((r) => [r.row_uid, r]));

  for (const uid of dispatched) {
    const before = savedByUid.get(uid);
    const after = nextByUid.get(uid);
    // A dispatched row missing outright is `writeChildren`'s own refusal, which
    // names the challan. Not restated here — two messages for one fact is how
    // they drift apart.
    if (!before || !after) continue;

    if ((before.prev_row_uid ?? null) !== (after.prev_row_uid ?? null)) {
      return {
        refused:
          "This stage has already been sent out under a challan, so the stage it follows cannot be changed. Cancel the challan first.",
      };
    }
    if (before.prev_row_uid && !nextByUid.has(before.prev_row_uid)) {
      return {
        refused:
          "A stage that has already been sent out draws its material from an earlier stage, which cannot be removed. Cancel the challan first.",
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grey against colour — a reconciliation, NOT a second rollup
// ---------------------------------------------------------------------------

/**
 * Does the chain plan a batch for every colour the requirement asks for?
 *
 * §6's first lifecycle state is "Purchase Requirement (Grey/Raw): grouping dyed
 * colourways to facilitate bulk undyed procurement". That grouping ALREADY
 * EXISTS — `bomCeilingForOrder` keys its `raw` map by `(item_id, item_color_id)`
 * and sums back to the material — so this function computes nothing. It is
 * handed both sides and says whether they agree.
 *
 * That boundary is the point. A second rollup here would be a second answer to
 * "how much navy thread does this order need", and the two would be compared by
 * nobody until they disagreed in a purchase order.
 *
 * The three things it can report are the three ways the plan and the requirement
 * come apart, and the third is the one nothing else catches:
 *
 *  - `short`   — a colour is planned for less than it needs;
 *  - `unplanned` — a colour the requirement names with no chain head at all, so
 *    the grey is bought and nothing ever dyes it;
 *  - `stray`   — a chain head for a colour the requirement never asked for,
 *    which is a dye job somebody is about to pay for on goods no line needs.
 */
export type GreyCoverage = {
  /** Sum of what the heads plan to send. What the bulk grey buy has to cover. */
  greyPlanned: number;
  /** Sum of the requirement across colours, as handed in. */
  greyRequired: number;
  perColour: {
    item_color_id: string | null;
    required: number;
    planned: number;
    /** Positive = planned short of the requirement. */
    shortBy: number;
  }[];
  /** Colours the requirement names that no chain head produces. */
  unplanned: (string | null)[];
  /** Colours a chain head produces that the requirement never named. */
  stray: (string | null)[];
};

export function greyCoverage(
  /** Per-colour requirement for ONE material, rolled up elsewhere. */
  requirement: readonly { item_color_id: string | null; qty: number }[],
  /** The chain HEADS for that material — `index.roots`, resolved to rows. */
  heads: readonly ChainRow[],
): GreyCoverage | Refusal {
  const key = (c: string | null) => c ?? "";

  const req = new Map<string, number>();
  for (const r of requirement) {
    const q = num(r.qty);
    if (q == null || q < 0) {
      // A refused requirement row is not a zero — `bom-ceiling.ts` records the
      // same rule, and treating it as 0 would report every colour as covered.
      return { refused: "The requirement for one colour has not been worked out yet" };
    }
    req.set(key(r.item_color_id), (req.get(key(r.item_color_id)) ?? 0) + q);
  }

  const plan = new Map<string, number>();
  for (const h of heads) {
    if (h.prev_row_uid != null) {
      return { refused: "Only the first stage of a chain draws from grey stock" };
    }
    plan.set(key(h.item_color_id), (plan.get(key(h.item_color_id)) ?? 0) + (num(h.qty_out) ?? 0));
  }

  const colours = [...new Set([...req.keys(), ...plan.keys()])];
  const perColour = colours.map((k) => {
    const required = req.get(k) ?? 0;
    const planned = plan.get(k) ?? 0;
    return {
      item_color_id: k === "" ? null : k,
      required,
      planned,
      shortBy: Math.max(required - planned, 0),
    };
  });

  return {
    greyPlanned: [...plan.values()].reduce((a, b) => a + b, 0),
    greyRequired: [...req.values()].reduce((a, b) => a + b, 0),
    perColour,
    unplanned: colours.filter((k) => req.has(k) && !plan.has(k)).map((k) => (k === "" ? null : k)),
    stray: colours.filter((k) => plan.has(k) && !req.has(k)).map((k) => (k === "" ? null : k)),
  };
}

/** Quantities in a sentence. Trailing zeros off, so "960" and not "960.000". */
function fmt(n: number): string {
  return String(Number(n.toFixed(3)));
}

export { isRefusal };
export type { Refusal };
