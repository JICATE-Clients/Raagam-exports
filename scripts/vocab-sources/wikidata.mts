// SOURCE: Wikidata, via the public SPARQL endpoint.
//
//   https://query.wikidata.org/sparql?format=json&query=...   (no key, CC0)
//
// One subclass-tree walk per root: `?item wdt:P279* wd:Qnnn` returns the root and
// everything transitively below it. CC0 means the data carries no attribution
// obligation at all, which is why this is the least encumbered of the three
// sources even though it is the noisiest.
//
// ── ROOTS ARE NAMED, MEASURED, AND PROPORTIONATE ────────────────────────────
//
// A root is only listed here after its tree has been counted, because the size
// of the tree decides whether the class is reviewable at all. Counted 2026-08-04
// (labels returned, which is lower than the raw subclass count — unlabelled items
// collapse onto their Q-id and dedupe away):
//
//   Q10282072  textile fiber      205   -> YARN     listed
//   Q1314278   woven fabric       470   -> FABRIC   listed
//   Q830128    knitted fabric      33   -> FABRIC   listed
//   Q28823     textile           1564   -> (none)   too broad: spans fibre,
//                                                   fabric and made-ups at once,
//                                                   so it cannot be filed under
//                                                   any single class
//   Q11460     clothing          7048   -> (none)   every garment in history,
//                                                   including regional dress no
//                                                   buyer orders. HSN chapters
//                                                   61/62 are the better GAR
//                                                   source by a wide margin.
//
// The other four classes have no root, deliberately. Wikidata has no usable tree
// for trims, packing materials, general stores or factory machinery — anything
// broad enough to cover them (`product`, `machine`) is broad enough to be
// useless. Silence rather than a guess, the same answer `categoryNameSeed()`
// gives for an unknown class.
//
// ── WHAT COMES BACK THAT MUST NOT BE PROPOSED ──────────────────────────────
//
// Measured on the Q10282072 tree, all present in the live response:
//   • ~15 bare "Q12345" labels — items with no English label at all.
//   • Non-textile fibres that are genuinely subclasses: ASBESTOS FIBER, GLASS
//     WOOL, ROCK WOOL, LEAD WOOL, QUARTZ FIBER, SILICON CARBIDE FIBER,
//     PIEZOELECTRIC FIBER. Every one is a real fibre and none is something this
//     factory spins. REJECT_SUBSTRINGS below drops them.
//   • Regional textiles a Tamil Nadu knitwear floor will never buy — Yaeyama
//     jofu, Ojiya-chijimi, Echigo-jofu. Those survive to the review file, where
//     rejecting them takes one glance. They are not automatable and should not
//     be: a name that is wrong HERE may be right for the next user of this repo.

import type { MinedTerm, VocabSource } from "./types.mts";
import { USER_AGENT } from "./types.mts";

const ENDPOINT = "https://query.wikidata.org/sparql";

type Root = { qid: string; label: string; classCode: string };

const ROOTS: Root[] = [
  { qid: "Q10282072", label: "textile fiber", classCode: "YARN" },
  { qid: "Q1314278", label: "woven fabric", classCode: "FABRIC" },
  { qid: "Q830128", label: "knitted fabric", classCode: "FABRIC" },
];

/**
 * Dropped on a substring match, case-insensitive.
 *
 * These are not typos or noise — they are correct subclasses of "textile fibre"
 * that this trade does not buy. Dropping them here rather than in review is
 * justified because the judgement is not about THIS factory's habits: no garment
 * factory anywhere spins asbestos into a knitted fabric.
 */
const REJECT_SUBSTRINGS = [
  "ASBESTOS", "GLASS WOOL", "ROCK WOOL", "MINERAL WOOL", "LEAD WOOL",
  "QUARTZ", "SILICON CARBIDE", "PIEZOELECTRIC", "LUMINESCENT",
  "CARBON FIBER", "CARBON FIBRE", "BASALT", "CERAMIC", "OPTICAL",
  "HOLLOW FIBER", "HOLLOW FIBRE", "SPIDER SILK", "CADDISFLY",
];

/** Wikidata items with no English label serialise as their own Q-id. */
const BARE_QID = /^Q\d+$/;

async function subclassLabels(root: Root): Promise<string[]> {
  const query = `SELECT DISTINCT ?itemLabel WHERE {
  ?item wdt:P279* wd:${root.qid}.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(
      `wikidata: ${root.qid} (${root.label}) returned ${res.status} ${res.statusText}. ` +
        `The endpoint rate-limits aggressively — wait a minute and re-run.`,
    );
  }

  const body = (await res.json()) as {
    results?: { bindings?: { itemLabel?: { value?: string } }[] };
  };
  return (body.results?.bindings ?? [])
    .map((b) => (b.itemLabel?.value ?? "").trim())
    .filter(Boolean);
}

export function wikidataSource(): VocabSource {
  return {
    id: "wikidata",
    note: "Wikidata subclass trees (CC0) — fibre and fabric roots only; see the file header for why",

    async fetch(): Promise<MinedTerm[]> {
      const out: MinedTerm[] = [];

      for (const root of ROOTS) {
        const labels = await subclassLabels(root);
        let kept = 0;
        for (const label of labels) {
          if (BARE_QID.test(label)) continue;
          const upper = label.toUpperCase();
          if (REJECT_SUBSTRINGS.some((r) => upper.includes(r))) continue;
          out.push({
            term: label,
            classCode: root.classCode,
            source: "wikidata",
            ref: root.qid,
          });
          kept++;
        }
        console.log(
          `  wikidata: ${root.qid} ${root.label} -> ${root.classCode}: ` +
            `${labels.length} labels, ${kept} kept`,
        );
      }

      return out;
    },
  };
}
