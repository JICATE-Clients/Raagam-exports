// Vectors for the Vehicle & Transport module's pure logic
// (lib/logistics/transport/logic.ts — doc/vehicle program/plan.md D5, §3B).
//
//     npm run check:transport
//     (node --experimental-strip-types scripts/check-transport-logic.mts)
//
// The module is loaded by a computed dynamic import, so tsc never sees a `.ts`
// extension in an import specifier and this file needs no tsconfig `exclude`.
// `logic.ts` imports nothing at runtime (only `import type`), so no `@/` alias
// is ever resolved.
//
// VERIFIED BY BEING MADE TO FAIL FIRST (2026-10-29). `TRANSPORT_LOGIC=<path>`
// points the check at another copy of logic.ts. Run against a deliberately
// broken copy — allocateCost rounding each line and DROPPING the remainder,
// nextTripStatus letting "enter origin" drag an en-route trip back to loading,
// and canTransition letting a completed trip move again — it reported 14
// failures (Σ cost / Σ pct ≠ total on thirds and primes, the remainder landing
// nowhere ×3, the en_route ← enter-origin regression and its transition, six
// moves out of `completed`) and exited 1. Against the real file it passes.
//
// What it asserts:
//   1. utilisationPct — the §3A formula, 2 dp, zero-payload guard.
//   2. allocateCost — Σ allocated_cost === totalCost to the paisa and
//      Σ weight_pct === 100, on awkward splits (1/3s, primes, one paisa);
//      the rounding remainder lands on the LARGEST line; zero weights split
//      equally; an empty list is empty.
//   3. nextTripStatus — every one of the 6 × 4 (status × event) pairs, so an
//      ignored event (null) is asserted as deliberately as a transition.
//   4. canTransition — forward only; cancel only before leaving origin;
//      nothing leaves completed / cancelled; every GPS transition is allowed
//      by the manual door too (both go through applyTripEvent).

type Logic = typeof import("../lib/logistics/transport/logic");
type TripStatus = "planned" | "loading" | "en_route" | "unloading" | "completed" | "cancelled";

const target = process.env.TRANSPORT_LOGIC
  ? new URL(`file:///${process.env.TRANSPORT_LOGIC.replace(/\\/g, "/").replace(/^\/+/, "")}`).href
  : new URL("../lib/logistics/transport/logic.ts", import.meta.url).href;
const L = (await import(target)) as Logic;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`FAIL  ${msg}`);
};
const eq = (name: string, got: unknown, want: unknown) => {
  if (!Object.is(got, want) && JSON.stringify(got) !== JSON.stringify(want))
    fail(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const paise = (n: number) => Math.round(n * 100);

// ---------- 1. utilisationPct ----------
eq("util 300+200 of 1000", L.utilisationPct([300, 200], 1000), 50);
eq("util 1/3", L.utilisationPct([1], 3), 33.33);
eq("util over", L.utilisationPct([700, 450], 1000), 115);
eq("util empty", L.utilisationPct([], 1000), 0);
eq("util zero payload, nothing", L.utilisationPct([], 0), 0);
eq("util zero payload, something", L.utilisationPct([5], 0), Number.POSITIVE_INFINITY);

// ---------- 2. allocateCost ----------
const cases: { name: string; total: number; w: number[] }[] = [
  { name: "thirds", total: 100, w: [1, 1, 1] },
  { name: "primes", total: 1234.57, w: [7, 11, 13, 17] },
  { name: "one paisa", total: 0.01, w: [10, 20, 30] },
  { name: "spec example", total: 1500, w: [300, 450, 250] },
  { name: "uneven", total: 999.99, w: [0.5, 2.25, 97.25] },
  { name: "single", total: 450, w: [123] },
];
for (const c of cases) {
  const out = L.allocateCost(c.total, c.w.map((weight_kg, key) => ({ key, weight_kg })));
  eq(`${c.name}: line count`, out.length, c.w.length);
  const sum = out.reduce((s, r) => s + paise(r.allocated_cost), 0);
  if (sum !== paise(c.total)) fail(`${c.name}: Σ allocated ${sum / 100} ≠ total ${c.total}`);
  const pct = out.reduce((s, r) => s + Math.round(r.weight_pct * 100), 0);
  if (pct !== 10000) fail(`${c.name}: Σ weight_pct ${pct / 100} ≠ 100`);
  for (const r of out)
    if (Math.abs(paise(r.allocated_cost) - r.allocated_cost * 100) > 1e-6)
      fail(`${c.name}: ${r.allocated_cost} is not whole paise`);
}
// Remainder rule: 100 / 3 → 33.33 each = 99.99; the 0.01 goes to the largest line.
{
  const out = L.allocateCost(100, [
    { key: "a", weight_kg: 1 },
    { key: "b", weight_kg: 1.00001 },
    { key: "c", weight_kg: 1 },
  ]);
  eq("remainder → largest (b)", out.map((r) => r.allocated_cost), [33.33, 33.34, 33.33]);
}
{
  // Tie on the largest weight → the FIRST such line takes it.
  const out = L.allocateCost(100, [
    { key: "a", weight_kg: 5 },
    { key: "b", weight_kg: 5 },
    { key: "c", weight_kg: 5 },
  ]);
  eq("remainder → first largest on tie", out.map((r) => r.allocated_cost), [33.34, 33.33, 33.33]);
  eq("pct remainder → first largest on tie", out.map((r) => r.weight_pct), [33.34, 33.33, 33.33]);
}
eq("spec 30%", L.allocateCost(1500, [{ key: 1, weight_kg: 300 }, { key: 2, weight_kg: 700 }])[0], {
  key: 1,
  weight_pct: 30,
  allocated_cost: 450,
});
eq("zero weights split equally", L.allocateCost(10, [{ key: 1, weight_kg: 0 }, { key: 2, weight_kg: 0 }]).map((r) => r.allocated_cost), [5, 5]);
eq("empty", L.allocateCost(500, []), []);

// ---------- 3. nextTripStatus: the whole table ----------
const S: TripStatus[] = ["planned", "loading", "en_route", "unloading", "completed", "cancelled"];
const E = [
  { kind: "enter", at: "origin" },
  { kind: "exit", at: "origin" },
  { kind: "enter", at: "destination" },
  { kind: "exit", at: "destination" },
] as const;
const want: Record<TripStatus, (TripStatus | null)[]> = {
  //          enter-o     exit-o      enter-d      exit-d
  planned: ["loading", "en_route", null, null],
  loading: [null, "en_route", null, null],
  en_route: [null, null, "unloading", null],
  unloading: [null, null, null, "completed"],
  completed: [null, null, null, null],
  cancelled: [null, null, null, null],
};
for (const s of S)
  E.forEach((e, i) => eq(`next(${s}, ${e.kind} ${e.at})`, L.nextTripStatus(s, e), want[s][i]));

// ---------- 4. canTransition ----------
for (const s of S)
  E.forEach((e) => {
    const to = L.nextTripStatus(s, e);
    if (to && !L.canTransition(s, to)) fail(`GPS move ${s} → ${to} refused by canTransition`);
  });
eq("cancel planned", L.canTransition("planned", "cancelled"), true);
eq("cancel loading", L.canTransition("loading", "cancelled"), true);
eq("cancel en_route", L.canTransition("en_route", "cancelled"), false);
eq("backwards", L.canTransition("en_route", "loading"), false);
for (const t of S) {
  eq(`completed → ${t}`, L.canTransition("completed", t), false);
  eq(`cancelled → ${t}`, L.canTransition("cancelled", t), false);
}
for (const s of S) {
  const n = L.manualNextStatus(s);
  if (n && !L.canTransition(s, n)) fail(`manual button ${s} → ${n} refused by canTransition`);
}

if (failures) {
  console.error(`\ncheck:transport — ${failures} failure(s)`);
  process.exit(1);
}
console.log("check:transport — ok (utilisation, allocation sums, state machine, transitions)");
