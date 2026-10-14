/**
 * check:sample-revision-scope — what a Sample Revision lets its proposed
 * costing change (lib/sales/sample-revisions/scope.ts, 0716).
 */
import { costingRevisionProblem } from "../lib/sales/sample-revisions/scope";
import type { CostingDraft } from "../lib/sales/sample-costing/types";

const base = (): CostingDraft => ({
  header: {
    opportunity_id: "o1", style_id: "s1", costing_date: "2026-10-12", currency_code: "USD", exchange_rate: "84",
    margin_pct: "20", garment_waste_pct: "3", overhead_pct: "5", discount_pct: "", ship_mode: "SEA",
    freight_per_pc: "", insurance_per_pc: "", buyer_target_price: "", commission_pct: "", notes: "",
  },
  pieces: [{ key: "p1", piece_name: "GARMENT", coordinate_id: null, cmt: "40", cmt_direct: true, lines: [], testing_cost: "", bank_cost: "" }],
  fabrics: [{
    key: "f1", fabric_id: "fab", quality: "SJ", yarn_rate: "300", yarns: [{ key: "y1", item_id: "yarn", yarn_name: "", mix_pct: "100", rate: "300" }],
    knitting_rate: "20", dyeing_rate: "80", finishing_rate: "", process_loss_pct: "8", is_direct: false, direct_rate: "", processes: [],
  }],
  weights: [{ key: "w1", piece_key: "p1", fabric_key: "f1", component_ids: ["c1"], size_name: "M", weight_g: "250", length_cm: "", width_cm: "", gsm: "180", wastage_pct: "3" }],
  trims: [{ key: "t1", piece_key: "p1", item_id: "btn", description: "BUTTON", qty: "4", rate: "1", is_direct: true, pack_price: "", pack_size: "" }],
  quotes: { "p1|M": "4.3" },
  extras: [],
});

let fail = 0;
const check = (name: string, got: string | null, wantRefused: boolean) => {
  const ok = wantRefused ? got !== null : got === null;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${got ? ` — ${got}` : ""}`);
};
const edit = (f: (d: CostingDraft) => void) => { const d = base(); f(d); return d; };

check("no change passes with any module", costingRevisionProblem(base(), base(), ["trims"], "R"), false);
check("a GSM change needs Fabric & Yarn Spec", costingRevisionProblem(base(), edit((d) => (d.weights[0].gsm = "200")), ["costing"], "R"), true);
check("a GSM change passes under Fabric & Yarn Spec", costingRevisionProblem(base(), edit((d) => (d.weights[0].gsm = "200")), ["fabric_spec"], "R"), false);
check("a trim consumption change needs Accessories & Trims", costingRevisionProblem(base(), edit((d) => (d.trims[0].qty = "6")), ["fabric_spec"], "R"), true);
// RATES FOLLOW THEIR MODULE (user 2026-10-14, "Costing & Price" retired).
check("a dyeing rate change needs Fabric & Yarn Spec", costingRevisionProblem(base(), edit((d) => (d.fabrics[0].dyeing_rate = "90")), ["trims"], "R"), true);
check("a dyeing rate change passes under Fabric & Yarn Spec", costingRevisionProblem(base(), edit((d) => (d.fabrics[0].dyeing_rate = "90")), ["fabric_spec"], "R"), false);
check("a trim rate change needs Accessories & Trims", costingRevisionProblem(base(), edit((d) => (d.trims[0].rate = "9")), ["fabric_spec"], "R"), true);
check("a trim rate change passes under Accessories & Trims", costingRevisionProblem(base(), edit((d) => (d.trims[0].rate = "9")), ["trims"], "R"), false);
check("a revision raised with the retired Costing & Price still opens a rate", costingRevisionProblem(base(), edit((d) => (d.fabrics[0].dyeing_rate = "90")), ["costing"], "R"), false);
check("a new fabric's own rates are free under Fabric & Yarn Spec", costingRevisionProblem(base(), edit((d) => d.fabrics.push({ ...d.fabrics[0], key: "f2", fabric_id: "rib", quality: "RIB", dyeing_rate: "95" })), ["fabric_spec"], "R"), false);
check("the quote opens with any costing module", costingRevisionProblem(base(), edit((d) => (d.quotes["p1|M"] = "4.5")), ["fabric_spec"], "R"), false);
check("the sample and style never change", costingRevisionProblem(base(), edit((d) => (d.header.style_id = "s2")), ["costing", "fabric_spec", "trims"], "R"), true);
check("same rate typed differently (90 vs 90.0) is no change", costingRevisionProblem(edit((d) => (d.fabrics[0].dyeing_rate = "90")), edit((d) => (d.fabrics[0].dyeing_rate = "90.0")), ["trims"], "R"), false);

if (fail) { console.error(`\ncheck:sample-revision-scope — ${fail} failed`); process.exit(1); }
console.log("\ncheck:sample-revision-scope — all passed");
