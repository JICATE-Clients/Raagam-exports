// SOURCE: English Wiktionary category listings.
//
//   https://en.wiktionary.org/w/api.php?action=query&list=categorymembers&...
//
// FABRIC ONLY, and only from Category:en:Fabrics — 284 members on 2026-08-04
// (one page, no continuation needed), of which 274 survive the filters below.
// This is the narrowest of the three sources and the only one that is genuinely
// a WORD LIST rather than a classification, which makes it both the best at
// weave names and the most dangerous.
//
// ── WHY THIS ONE IS ALLOWED WHEN DATAMUSE IS NOT ───────────────────────────
//
// `name-vocabularies.ts` records that a general-English word source was measured
// and rejected: `viscos` returns VISCOUS and never VISCOSE, `cot*` ranks COTTON
// ninth. That verdict stands, and this file does not overturn it — it sidesteps
// it. The difference is not the corpus, it is WHEN it is consulted:
//
//   Datamuse was proposed as a RUNTIME matcher — it would answer the operator's
//   keystroke, so its ranking WAS the suggestion and its errors were unfixable.
//
//   This is a BUILD-TIME candidate list — nothing here reaches an operator until
//   a human has ticked it, and the app's own matcher does all the ranking against
//   the approved list. A wrong word here costs one glance in review; a wrong word
//   in Datamuse cost a corrected fibre name in production (client 2026-07-28).
//
// So the rule to keep is the one that was actually learned: no external source
// on the keystroke path. Not: no external source.
//
// ── WHAT COMES BACK (measured, all present in the live response) ────────────
//
// Good: DENIM, TWILL, JACQUARD, SEERSUCKER, CORDUROY, POLYVISCOSE, CHAMBRAY,
// FLANNEL, GABARDINE, ORGANZA, POPLIN, SATEEN, TERRY CLOTH, VOILE.
//
// Dropped here:
//   • "Appendix:Fabrics" and any other namespaced page — not a word.
//   • Non-ASCII titles: BARÈGE, ALÉPINE, CÀNEVA, JASPÉ, BARÉGE. A category name
//     is typed by an operator on a shop-floor keyboard, so a word that cannot be
//     typed cannot be a house spelling. This also keeps the CAPS assertion in
//     check-name-suggest.mts honest, since normName() does not fold accents.
//
// Left for the human, deliberately: the archaic tail. ALACHA, ALÉPINE, BOCASINE,
// COGWARE, SAGATHY, SEMPITERNUM and about eighty more are 18th/19th-century
// trade cloths. No regex tells them from BENGALINE or BROADCLOTH, which are
// archaic-sounding and still ordered. Rejecting them is two minutes of ticking
// boxes and the reviewer is the only one who can do it.

import type { MinedTerm, VocabSource } from "./types.mts";
import { USER_AGENT } from "./types.mts";

const API = "https://en.wiktionary.org/w/api.php";

/** Category -> the item class its members are proposed for. FABRIC only, on purpose. */
const CATEGORIES: { title: string; classCode: string }[] = [
  { title: "Category:en:Fabrics", classCode: "FABRIC" },
];

/** Anything outside the main namespace is a page about words, not a word. */
const NAMESPACED = /^[A-Z][A-Za-z ]*:/;

/** A name an operator cannot type on the machine in front of them is not a name. */
const NON_ASCII = /[^\x20-\x7E]/;

async function categoryMembers(title: string): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;

  // The API caps a page at 500 for anonymous callers; follow cmcontinue so a
  // category that grows past that does not silently truncate.
  do {
    const url = new globalThis.URL(API);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "categorymembers");
    url.searchParams.set("cmtitle", title);
    url.searchParams.set("cmlimit", "500");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    if (cont) url.searchParams.set("cmcontinue", cont);

    const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) {
      throw new Error(`wiktionary: ${title} returned ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as {
      query?: { categorymembers?: { title?: string }[] };
      continue?: { cmcontinue?: string };
    };
    for (const m of body.query?.categorymembers ?? []) {
      if (m.title) titles.push(m.title.trim());
    }
    cont = body.continue?.cmcontinue;
  } while (cont);

  return titles;
}

export function wiktionarySource(): VocabSource {
  return {
    id: "wiktionary",
    note: "en.wiktionary Category:en:Fabrics (CC BY-SA 4.0) — FABRIC only; expect an archaic tail",

    async fetch(): Promise<MinedTerm[]> {
      const out: MinedTerm[] = [];

      for (const { title, classCode } of CATEGORIES) {
        const titles = await categoryMembers(title);
        let kept = 0;
        for (const t of titles) {
          if (NAMESPACED.test(t)) continue;
          if (NON_ASCII.test(t)) continue;
          out.push({ term: t, classCode, source: "wiktionary", ref: title.replace(/^Category:/, "") });
          kept++;
        }
        console.log(
          `  wiktionary: ${title} -> ${classCode}: ${titles.length} titles, ${kept} kept`,
        );
      }

      return out;
    },
  };
}
