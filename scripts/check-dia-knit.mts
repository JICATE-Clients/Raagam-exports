// Vectors for lib/orders/fabric-bom/dia-knit.ts — Manual's Finish Dia is
// scoped to the fabric's own knit family (client 2026-09-19).
//
//     npm run check:dia-knit
//
// Run by tsx (the module imports ./types, which resolves `@/`), and listed in
// tsconfig `exclude` like its siblings.

import { diaKnitProblem, knitTypesOfDia, manualDiaKnitProblems } from "../lib/orders/fabric-bom/dia-knit.ts";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
}

/* An order declaring the shape seen live: circular 73 and 60, a flat collar
   width 28, a woven 58, a typed-but-empty row and an untyped 40. */
const dias = [
  { knit_type: "circular", dia: "73" },
  { knit_type: "circular", dia: "60" },
  { knit_type: "flat_knit", dia: "28" },
  { knit_type: "woven", dia: "58" },
  { knit_type: "circular", dia: null },
  { knit_type: null, dia: "40" },
  { knit_type: "flat_knit", dia: "60" },
];

eq("families of 73", knitTypesOfDia("73", dias), ["circular"]);
eq("60 is declared under two families", knitTypesOfDia("60", dias), ["circular", "flat_knit"]);
eq("case and spaces do not split a dia", knitTypesOfDia(" 23 cm ", [{ knit_type: "woven", dia: "23 CM" }]), ["woven"]);
eq("untyped 40 has no family", knitTypesOfDia("40", dias), []);

eq("circular fabric, circular dia → ok", diaKnitProblem("73", "circular", dias, "JERSEY"), null);
eq(
  "circular fabric, FLAT dia → refused, naming both families",
  diaKnitProblem("28", "circular", dias, "JERSEY"),
  "JERSEY: Finish Dia 28 is declared for Flat, but this fabric is Circular — pick a Circular dia.",
);
eq(
  "flat fabric, circular dia → refused",
  diaKnitProblem("73", "flat_knit", dias, "COLLAR"),
  "COLLAR: Finish Dia 73 is declared for Circular, but this fabric is Flat — pick a Flat dia.",
);
eq("a dia declared under BOTH families is fine for either", diaKnitProblem("60", "flat_knit", dias, "COLLAR"), null);
eq("fabric with no family set → never refused", diaKnitProblem("28", null, dias, "X"), null);
eq("undeclared dia is not 'the wrong type'", diaKnitProblem("99", "circular", dias, "X"), null);
eq("untyped dia is not 'the wrong type'", diaKnitProblem("40", "circular", dias, "X"), null);
eq("blank dia → nothing to check", diaKnitProblem("", "circular", dias, "X"), null);

const knitOf = (id: string) => ({ jersey: "circular", collar: "flat_knit", mystery: null })[id] ?? null;
const nameOf = (id: string) => id.toUpperCase();
eq(
  "across entries: one refusal per wrong dia, repeats folded, unnamed fabric skipped",
  manualDiaKnitProblems(
    [
      { item_id: "jersey", sizes: [{ dia: "73" }, { dia: "28" }, { dia: "28" }] },
      { item_id: "collar", sizes: [{ dia: "28" }, { dia: "58" }] },
      { item_id: "mystery", sizes: [{ dia: "28" }] },
      { item_id: null, sizes: [{ dia: "28" }] },
    ],
    dias,
    knitOf,
    nameOf,
  ),
  [
    "JERSEY: Finish Dia 28 is declared for Flat, but this fabric is Circular — pick a Circular dia.",
    "COLLAR: Finish Dia 58 is declared for Woven, but this fabric is Flat — pick a Flat dia.",
  ],
);

if (failed) {
  console.error(`\ncheck:dia-knit — ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:dia-knit — all vectors pass");
