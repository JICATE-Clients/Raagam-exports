// Verification vectors for lib/ui/search-match.ts — the one rule every field
// search box in the app matches by (`DataPicker`, `Combobox`, `MultiSelect`).
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-search-match.mts
//     npm run check:search
//
// ## THIS CHECK WAS MADE TO FAIL BEFORE IT WAS TRUSTED
//
// A check that prints `ok` against the code it was written beside proves only
// that the two agree. So it carries the OLD behaviour as a switch:
//
//     node --experimental-strip-types scripts/check-search-match.mts --baseline
//
// which is the single contiguous `includes()` every picker used until
// 2026-09-03. The FINDS vectors below must FAIL under `--baseline` — that is
// what makes each of them a statement about the fix rather than about substring
// matching. A vector that passes both ways is asserting nothing and the run says
// so instead of counting it as a pass.
//
// The MISSES vectors are the other half and run BOTH ways: a search that is
// meant to find nothing must still find nothing, or "understand whatever is
// typed" has quietly become "match almost anything".

import { matchesSearch, searchTokens } from "../lib/ui/search-match.ts";

const BASELINE = process.argv.includes("--baseline");

/** What every picker did before: one contiguous substring, case-folded. */
const oldMatch = (haystack: string, query: string): boolean =>
  haystack.toLowerCase().includes(query.trim().toLowerCase());

const hit = (haystack: string, query: string): boolean =>
  BASELINE ? oldMatch(haystack, query) : matchesSearch(haystack, searchTokens(query));

let failed = 0;
let vacuous = 0;

/**
 * The two live composed fabric names quoted in fabric-bom-screen.tsx — the
 * `composeFabricName` output the client was searching when they reported this.
 */
const RIB = "SOLID 1X1 LYCRA RIB (30'S COTTON COMBED 95%, 20'S ELASTANE 5%) 100%";
const FLEECE =
  "SOLID FLEECE (30'S COMBED COTTON 55%, 16'S COMPACT COTTON 35%, 50 DINER POLYESTER 10%) 100%";

/** Must match. Under --baseline a PASS is the failure — the vector proves nothing. */
function finds(label: string, haystack: string, query: string) {
  const ok = hit(haystack, query);
  if (BASELINE) {
    if (ok) {
      vacuous++;
      console.error(
        `VACUOUS  ${label}\n         the OLD contiguous includes() already found it`,
      );
    } else {
      console.log(`caught   ${label}`);
    }
    return;
  }
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      "${query}" did not find: ${haystack}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

/** Must NOT match — asserted under both modes; see the header. */
function misses(label: string, haystack: string, query: string) {
  if (hit(haystack, query)) {
    failed++;
    console.error(`FAIL  ${label}\n      "${query}" wrongly matched: ${haystack}`);
  } else if (!BASELINE) {
    console.log(`ok    ${label}`);
  }
}

// -------------------------------------------------- the report (2026-09-03)
// "whatever the user searches it should understand, needs to fetch the right
// fabric". Each of these is a real thing a planner types at the Fabric field
// and every one of them found NOTHING before.
finds("words out of order — 'rib lycra'", RIB, "rib lycra");
finds("two words from opposite ends — 'solid elastane'", RIB, "solid elastane");
finds("structure + a blend member — 'rib cotton'", RIB, "rib cotton");
finds("the yarn count typed without its apostrophe — '30s'", RIB, "30s");
finds("count and fibre — '30s cotton'", RIB, "30s cotton");
// `95%` ALONE WAS VACUOUS and this is what replaced it — caught by --baseline
// rather than by review, which is the whole reason that mode exists. The old
// contiguous test already found "95%" because the sign is stored too; only a
// query that ALSO puts the words the wrong way round proves the sign is being
// stripped from what was typed rather than merely happening to be present.
finds("a share typed with its sign, words reversed — '95% elastane'", RIB, "95% elastane");
finds("three scattered words", FLEECE, "fleece polyester compact");
finds("case and spacing are irrelevant", FLEECE, "  DINER   fleece ");

// The composed name puts the structure LAST among the words a planner thinks
// in — this is the shape of nearly every complaint about a composed master.
finds("what the operator calls it, in their order", FLEECE, "cotton fleece");

// -------------------------------------------------- what must still not match
// The fix must not become "matches almost anything". A word that is not in the
// cloth still refuses, so the operator learns the master does not hold it.
misses("a fibre this cloth does not contain", RIB, "viscose");
misses("all words but one present", RIB, "rib lycra viscose");
misses("a different structure", RIB, "fleece");
misses("a typo is NOT corrected — that is useSpellSuggest's job", RIB, "lyrca");

// -------------------------------------------------- the ordinary cases hold
// These pass both ways by design (they are contiguous), so they are `misses`'
// counterpart rather than `finds` — asserted only in the real mode, because
// under --baseline they are exactly what the old rule already did.
if (!BASELINE) {
  const same = (label: string, h: string, q: string) => {
    if (!matchesSearch(h, searchTokens(q))) {
      failed++;
      console.error(`FAIL  ${label}\n      "${q}" did not find: ${h}`);
    } else console.log(`ok    ${label}`);
  };
  same("a plain prefix still works", RIB, "solid");
  same("a contiguous phrase still works", RIB, "lycra rib");
  same("an empty query matches everything", RIB, "   ");
  // `searchTokens` is what every caller uses to decide "no filter"; punctuation
  // alone must reduce to no tokens, or a stray keystroke would empty the list.
  if (searchTokens("  ,  ").length !== 0) {
    failed++;
    console.error("FAIL  punctuation-only query is not an empty token list");
  } else console.log("ok    punctuation-only query means 'no filter'");
}

// -------------------------------------------------- verdict
if (BASELINE) {
  if (vacuous > 0) {
    console.error(
      `\n${vacuous} vector(s) assert nothing — the OLD contiguous match already found them.`,
    );
    process.exit(1);
  }
  if (failed > 0) {
    console.error(`\n${failed} "must not match" vector(s) failed under --baseline.`);
    process.exit(1);
  }
  console.log("\nEvery 'finds' vector fails under --baseline, so each one is load-bearing.");
  process.exit(0);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll search-match checks passed.");
