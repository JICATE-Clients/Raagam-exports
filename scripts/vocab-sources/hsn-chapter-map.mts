// WHICH HSN CHAPTERS BELONG TO WHICH ITEM CLASS.
//
// This table is the entire safety property of the miner, so it is a declared
// literal and never a heuristic. `name-vocabularies.ts` explains why at length:
// the 2026-07-28 bug was a fibre vocabulary reachable from a screen that never
// asked for one, and a chapter filed under the wrong class is that same bug
// arriving through the back door — COTTON offered under PACKING ACCESSORIES,
// this time with an official-looking HSN reference beside it.
//
// ── LONGEST PREFIX WINS ────────────────────────────────────────────────────
//
// A prefix is matched against the HSN code, and the LONGEST declared prefix
// decides the class. That is what lets a chapter be split at its natural seam
// without listing every sub-heading:
//
//   YARN   declares "52"    -> 5201 cotton, 5205 cotton yarn, 5207 yarn for retail
//   FABRIC declares "5208"  -> 5208/5209/... woven cotton fabric, taken back off YARN
//
// Chapters 52, 54 and 55 all have that seam — fibre and yarn at the low
// headings, woven fabric at the high ones — and all three are handled by the
// same two lines rather than by fourteen. Ties are impossible: two classes
// cannot declare the same prefix (asserted below).
//
// ── DELIBERATE OVERLAP IS A SEPARATE TABLE ─────────────────────────────────
//
// Longest-prefix-wins gives each code exactly ONE class, which is right almost
// everywhere and wrong for the handful of goods that genuinely are two things.
// 5204 is COTTON SEWING THREAD: a yarn to the spinner and a trim to the cutting
// room, and both masters should be able to offer it. Those cases go in
// HSN_ALSO_CLASSES and nowhere else, so "which codes are double-counted?" is
// answered by reading eight lines instead of by tracing the matcher.
//
// Overlap is safe in a way that misfiling is not: `check-name-suggest.mts`
// compares every class against its OWN words, so a name present in two
// vocabularies leaks nothing. A name present in the wrong one leaks everything.

/** An HSN code prefix: a 2-digit chapter, or a 4/6/8-digit heading. */
export type HsnPrefix = string;

/**
 * Item class code -> the HSN prefixes whose descriptions name its goods.
 *
 * Codes are the seven in `ITEM_CLASS_NAMES` / `CATEGORY_NAMES_BY_ITEM_CLASS`:
 * YARN, FABRIC, SEW, PACK, GAR, GEN, CAP.
 */
export const HSN_CLASS_CHAPTERS: Record<string, HsnPrefix[]> = {
  /* Fibres, filaments and yarns. The three whole chapters bring in every fibre
   * and yarn heading; FABRIC's entries below carve the woven-fabric headings
   * back out of them by declaring a longer prefix.
   *   50 silk · 51 wool and animal hair · 52 cotton · 53 other vegetable fibres
   *   54 man-made filaments · 55 man-made staple fibres · 5605/5606 metallised
   *   and gimped yarn */
  YARN: ["50", "51", "52", "53", "54", "55", "5605", "5606"],

  /* Woven, knitted and coated fabrics, plus the fabric-adjacent chapters that
   * are nothing but fabric.
   *   5208-5212 woven cotton · 5407-5408 woven man-made filament
   *   5512-5516 woven man-made staple · 5801-5804 pile, terry, tulle, lace
   *   5809-5811 other woven · 59 coated/laminated/technical · 60 knitted */
  FABRIC: [
    "5208", "5209", "5210", "5211", "5212",
    "5407", "5408",
    "5512", "5513", "5514", "5515", "5516",
    "5801", "5802", "5803", "5804", "5809", "5811",
    "59", "60",
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // TODO(you) — the five below are yours to fill in. Candidate prefixes are
  // listed per class; the call is which of them this floor actually buys, and
  // whether a borderline chapter belongs here or nowhere. An empty array is a
  // legitimate answer: it means "mine nothing from HSN for this class", and the
  // hand-written list keeps working exactly as it does today.
  // ─────────────────────────────────────────────────────────────────────────

  /* Trims that go INTO the garment. Candidates:
   *   5204 cotton sewing thread   5401 man-made sewing thread
   *   5508 staple-fibre sewing thread
   *   5806 narrow woven fabric / tape      5807 labels, badges, motifs
   *   5808 braid, trimmings, tassels       5810 embroidery
   *   5607 twine, cordage, rope            5609 articles of yarn/twine
   *   9606 buttons, press-fasteners, snaps 9607 slide fasteners (zippers)
   *   9602 moulded articles                7117 imitation jewellery (motifs)
   * Note 5204 / 5401 / 5508 are also in YARN's chapters — if you want them in
   * BOTH masters, list them here AND in HSN_ALSO_CLASSES below. Listing them
   * here alone MOVES them off YARN, because the longer prefix wins. */
  SEW: [],

  /* Materials the finished garment is packed IN. Candidates:
   *   3923 plastic packing articles (poly bags, PP bags)
   *   3919/3920/3921 plastic film and sheet
   *   4802 uncoated paper   4805 other kraft   4808 corrugated paper
   *   4819 cartons, boxes, cases, bags       4821 paper labels and tags
   *   4823 other paper articles (tissue, butter paper)
   *   4911 other printed matter (stickers, shipping marks)
   *   5607 twine and strap    7317 pins/tacks    8305 clips and fasteners
   *   2811 / 3824 silica gel desiccant
   * 5607 appears under SEW too — same choice as above. */
  PACK: [],

  /* Garment types. Candidates:
   *   61 knitted apparel   62 woven apparel   6505 knitted headgear
   *   6115 hosiery and tights   6117 other knitted accessories
   *   6212 brassieres, girdles, corsetry
   *   63 other made-up textile articles (household, not apparel — probably not) */
  GAR: [],

  /* General stores — bought by the factory, never part of a garment. Candidates:
   *   3402 cleaning preparations    3405 polishes
   *   4820 stationery and registers 9608/9609 pens and pencils
   *   2710 lubricating oils         3208/3209 paints and varnishes
   *   3005/3006 first-aid dressings 3822 lab reagents
   *   3917 plumbing tubes/pipes     8536 electrical switchgear
   *   9403 furniture                6307 mops and cleaning cloths
   *   3926 other plastic articles (very broad — likely too noisy) */
  GEN: [],

  /* Capital goods — machines and assets. Candidates:
   *   8444-8449 textile machinery (extruding, spinning, weaving, knitting)
   *   8451 finishing/pressing machinery   8452 sewing machines
   *   8453 leather machinery
   *   8402 boilers    8414 air compressors    8419 dryers
   *   8471 computers  8501-8504 motors, generators, transformers
   *   8502 generating sets (DG set)         8427/8428 material handling
   *   9024-9032 measuring and testing instruments
   *   8207 tools and dies                   87 vehicles */
  CAP: [],
};

/**
 * Codes that belong to a SECOND class as well as the one the prefix match gives
 * them. Keyed by prefix, valued by the extra class codes.
 *
 * Keep this short and keep every entry justified in a comment. It exists for
 * goods the trade genuinely treats as two things, not as a way to dodge a
 * decision in the table above — if you cannot say in one line why a code is two
 * things, it is one thing and you are unsure which.
 */
export const HSN_ALSO_CLASSES: Record<HsnPrefix, string[]> = {
  // Sewing thread is a yarn to the spinner and a trim to the cutting room, and
  // both masters legitimately carry rows for it (SEW's list already has SEWING
  // THREAD and EMBROIDERY THREAD in it today).
  // 5204: cotton · 5401: man-made filament · 5508: man-made staple
  // TODO(you): uncomment once SEW has its chapters, or delete if you decide
  // sewing thread should live on one master only.
  // "5204": ["SEW"],
  // "5401": ["SEW"],
  // "5508": ["SEW"],
};

/* --------------------------------------------------------------- the matcher */

type Rule = { prefix: HsnPrefix; classCode: string };

/** Flattened once, longest prefix first, so `classesForCode` is a linear scan. */
const RULES: Rule[] = Object.entries(HSN_CLASS_CHAPTERS)
  .flatMap(([classCode, prefixes]) => prefixes.map((prefix) => ({ prefix, classCode })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

/* A prefix claimed by two classes would make the winner depend on object key
 * order, which is exactly the kind of silent misfiling this file exists to
 * prevent. Fail loudly at import instead. */
{
  const seen = new Map<string, string>();
  for (const { prefix, classCode } of RULES) {
    const other = seen.get(prefix);
    if (other) {
      throw new Error(
        `hsn-chapter-map: prefix "${prefix}" is claimed by both ${other} and ${classCode}. ` +
          `A prefix belongs to exactly one class — use HSN_ALSO_CLASSES for deliberate overlap.`,
      );
    }
    seen.set(prefix, classCode);
  }
  for (const [prefix, extras] of Object.entries(HSN_ALSO_CLASSES)) {
    if (!seen.has(prefix)) {
      throw new Error(
        `hsn-chapter-map: HSN_ALSO_CLASSES has "${prefix}", which no class declares in ` +
          `HSN_CLASS_CHAPTERS. An overlap needs a primary class to overlap WITH.`,
      );
    }
    for (const e of extras) {
      if (!(e in HSN_CLASS_CHAPTERS)) {
        throw new Error(`hsn-chapter-map: HSN_ALSO_CLASSES "${prefix}" names unknown class "${e}".`);
      }
    }
  }
}

/**
 * The item classes an HSN code's description may be mined for — [] if none.
 *
 * The primary class is the LONGEST declared prefix that the code starts with,
 * plus anything HSN_ALSO_CLASSES adds for that same prefix. Returning [] for an
 * unclaimed code is the same safety property `categoryNameSeed()` has: silence
 * rather than a guess.
 */
export function classesForCode(code: string): string[] {
  const digits = (code ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const hit = RULES.find((r) => digits.startsWith(r.prefix));
  if (!hit) return [];
  return [hit.classCode, ...(HSN_ALSO_CLASSES[hit.prefix] ?? [])];
}

/** Classes with at least one chapter declared — used to report what was skipped. */
export function minedClasses(): string[] {
  return Object.entries(HSN_CLASS_CHAPTERS)
    .filter(([, prefixes]) => prefixes.length > 0)
    .map(([classCode]) => classCode);
}
