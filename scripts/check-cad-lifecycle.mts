/**
 * Vectors for `lib/orders/cad-lifecycle/types.ts` — Orders ▸ CAD ▸ CAD Lifecycle
 * (doc/order/cad.md, 0628, doc/order/cad-plan.md).
 *
 * Every vector sits where two plausible implementations DISAGREE (the
 * check-ta-schedule.mts standard): the latest version decides the state, not
 * the first; a date equal to the bound passes and one day past fails; a file
 * named .DXF in capitals is a CAD file and a .dxf.pdf is not; the held Pattern
 * Maker survives while an unqualified one is never offered.
 *
 * ## THE SQL MIRROR IS CHECKED, NOT TRUSTED
 *
 * The rules live twice — here for the screen, in 0628 for the database. Section
 * 6 parses the migration and asserts the state words, the file extensions and
 * the Pattern Maker designations agree, so a change on one side fails this
 * script instead of shipping a screen that allows what the database refuses.
 *
 * `npm run check:cad-lifecycle` (inside `build:check`).
 */
import { readFileSync } from "node:fs";
import {
  allocationProblem,
  CAD_FILE_EXTENSIONS,
  CAD_STATES,
  cadCompletionOf,
  cadLateness,
  cadNextStep,
  cadOrderReady,
  cadPathSegment,
  cadSheetLabel,
  cadStateOf,
  cadStoragePath,
  cutKey,
  layoutForPart,
  mergePatternLines,
  decisionProblem,
  dispatchProblem,
  isCadFile,
  isPatternFile,
  isProofFile,
  istLocalToIso,
  PATTERN_FILE_EXTENSIONS,
  PROOF_FILE_EXTENSIONS,
  PATTERN_MAKER_DESIGNATIONS,
  patternMakerOptions,
  type CadDecision,
  type CadDispatch,
} from "../lib/orders/cad-lifecycle/types";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

const disp = (over: Partial<CadDispatch> = {}): CadDispatch => ({
  id: "d",
  dispatch_date: "2026-09-10",
  courier_tracking_no: "T1",
  email_sent_at: null,
  layout_type: "tubular",
  expected_approval_date: null,
  remarks: null,
  files: [],
  ...over,
});
const dec = (status: CadDecision["status"], decided_on: string | null = null): CadDecision => ({
  status,
  decided_on,
  buyer_comments: null,
});
type V = { version_no: number; allocation_date: string; dispatch: CadDispatch | null; decision: CadDecision | null };
const v = (n: number, over: Partial<V> = {}): V => ({
  version_no: n,
  allocation_date: "2026-09-01",
  dispatch: null,
  decision: null,
  ...over,
});

// ---------------------------------------------------------------------------
// 1. State — the LATEST version decides (§4.1, §4.2).
// ---------------------------------------------------------------------------
check("no versions → not_allocated", cadStateOf([]), "not_allocated");
check("allocated, not sent → allocated", cadStateOf([v(1)]), "allocated");
check("sent, no answer → pending", cadStateOf([v(1, { dispatch: disp(), decision: dec("pending") })]), "pending");
check(
  "v1 rework + v2 approved → approved (the latest wins, not the first)",
  cadStateOf([v(1, { dispatch: disp(), decision: dec("rework", "2026-09-05") }), v(2, { dispatch: disp(), decision: dec("approved", "2026-09-12") })]),
  "approved",
);
check(
  "versions out of order still read the highest",
  cadStateOf([v(2, { dispatch: disp(), decision: dec("approved") }), v(1, { dispatch: disp(), decision: dec("rework") })]),
  "approved",
);
check(
  "v1 rework + v2 just allocated → allocated (the rework is history)",
  cadStateOf([v(1, { dispatch: disp(), decision: dec("rework") }), v(2)]),
  "allocated",
);
check("next steps", CAD_STATES.map(cadNextStep), ["allocate", "dispatch", "decide", null, "reallocate"]);

// ---------------------------------------------------------------------------
// 2. The order-level answer and the order-sheet word (§6.2, §7).
// ---------------------------------------------------------------------------
check("no styles → NOT ready (nothing was approved)", cadOrderReady([]), false);
check(
  "one approved, one pending → not ready",
  cadOrderReady([{ state: "approved", on_order: true }, { state: "pending", on_order: true }]),
  false,
);
check(
  "a style that left the order neither blocks nor satisfies",
  cadOrderReady([{ state: "approved", on_order: true }, { state: "rework", on_order: false }]),
  true,
);
check(
  "only a departed style → not ready",
  cadOrderReady([{ state: "approved", on_order: false }]),
  false,
);
check("sheet: approved V2", cadSheetLabel("approved", 2), { text: "Approved (V2)", pending: false });
check("sheet: rework reads Pending, red", cadSheetLabel("rework", 1), { text: "Pending", pending: true });

// ---------------------------------------------------------------------------
// 3. The report arithmetic (§6.1): approval date − V1's allocation date.
// ---------------------------------------------------------------------------
check(
  "T-7721: V1 allocated 01-09, V2 approved 15-09 → 2 versions, 14 days",
  cadCompletionOf([
    v(1, { allocation_date: "2026-09-01", dispatch: disp(), decision: dec("rework", "2026-09-06") }),
    v(2, { allocation_date: "2026-09-07", dispatch: disp(), decision: dec("approved", "2026-09-15") }),
  ]),
  { totalVersions: 2, state: "approved", leadTimeDays: 14 },
);
check(
  "S-9002: pending → no lead time (not V2's allocation date either)",
  cadCompletionOf([v(1, { dispatch: disp(), decision: dec("pending") })]),
  { totalVersions: 1, state: "pending", leadTimeDays: null },
);

// ---------------------------------------------------------------------------
// 4. Files and the revision path (§3.1, "File Revision Architecture").
// ---------------------------------------------------------------------------
check("P1.DXF (capitals) is a CAD file", isCadFile("P1.DXF"), true);
check("back.plt / front.pds are CAD files", [isCadFile("back.plt"), isCadFile("front.pds")], [true, true]);
check("marker.dxf.pdf is NOT (the last extension counts)", isCadFile("marker.dxf.pdf"), false);
check("no extension is not", isCadFile("DXF"), false);
check("a style code with slashes becomes one segment", cadPathSegment("stl/2627/0001"), "STL_2627_0001");
check(
  "path: cad/{order}/{style}/v{n}/{style}_{n}_{stamp}.{ext}",
  cadStoragePath("ORD", "T-7721", 2, "Back.DXF", 1700000000000),
  "cad/ORD/T-7721/v2/T-7721_2_1700000000000.dxf",
);
check(
  "a second file in the same version never overwrites the first",
  cadStoragePath("ORD", "T-7721", 2, "Front.dxf", 1700000000000, 1),
  "cad/ORD/T-7721/v2/T-7721_2_1700000000000-2.dxf",
);
check("datetime-local is IST", istLocalToIso("2026-09-10T14:30"), "2026-09-10T14:30:00+05:30");

// ---------------------------------------------------------------------------
// 5. The three form rules — each bound exactly, and one past it.
// ---------------------------------------------------------------------------
const today = "2026-09-24";
check(
  "target = allocation date is allowed (≥, not >)",
  allocationProblem({ pattern_maker_id: "e", cad_type: "grading", target_date: today }, today),
  null,
);
check(
  "target one day before is refused",
  allocationProblem({ pattern_maker_id: "e", cad_type: "grading", target_date: "2026-09-23" }, today) !== null,
  true,
);
check("no pattern maker refused first", allocationProblem({ pattern_maker_id: null, cad_type: null, target_date: null }, today), "Choose the Pattern Maker.");

const ver = { allocation_date: "2026-09-10", cad_type: "first_pattern" };
const good = { dispatch_date: today, courier_tracking_no: "T1", email_sent_at: null, layout_type: null, files: [{ file_name: "a.dxf" }] };
check("a good dispatch passes", dispatchProblem(good, ver, today), null);
check("dispatch today is allowed; tomorrow refused", dispatchProblem({ ...good, dispatch_date: "2026-09-25" }, ver, today), "The Dispatch Date cannot be in the future.");
check("dispatch before allocation refused", dispatchProblem({ ...good, dispatch_date: "2026-09-09" }, ver, today), "The Dispatch Date cannot be before the Allocation Date.");
check("email alone is proof enough", dispatchProblem({ ...good, courier_tracking_no: "  ", email_sent_at: "2026-09-24T10:00" }, ver, today), null);
check("blank courier and no email refused", dispatchProblem({ ...good, courier_tracking_no: "  " }, ver, today)?.startsWith("Enter a Courier"), true);
check("no file refused", dispatchProblem({ ...good, files: [] }, ver, today)?.startsWith("Attach the CAD file"), true);
// 0632: a PDF marker rides ALONG with a real CAD file, never instead of it.
check("a PDF alone is refused — it is a picture of a marker, not a pattern", dispatchProblem({ ...good, files: [{ file_name: "a.pdf" }] }, ver, today)?.startsWith("Attach the CAD file"), true);
check("a PDF beside a .DXF passes", dispatchProblem({ ...good, files: [{ file_name: "a.dxf" }, { file_name: "a.pdf" }] }, ver, today), null);
check("a .jpg is not a pattern file", dispatchProblem({ ...good, files: [{ file_name: "a.dxf" }, { file_name: "b.jpg" }] }, ver, today), "b.jpg is not a CAD file — only .DXF, .PDS, .PLT and a .PDF marker are accepted.");
check("a proof slip alone is proof enough", dispatchProblem({ ...good, courier_tracking_no: null, proof_files: [{ file_name: "slip.PNG" }] }, ver, today), null);
check("a .dxf is not a proof", dispatchProblem({ ...good, proof_files: [{ file_name: "x.dxf" }] }, ver, today), "x.dxf cannot be a transmission proof — attach a .PDF, .JPG, .PNG, .EML or .MSG.");
check("pattern vs proof lists", [isPatternFile("m.PDF"), isProofFile("m.PDF"), isPatternFile("s.eml"), isProofFile("s.eml")], [true, true, false, true]);

// 0638: Send requires the Pattern Master's Ready — refused first, before any field.
check("dispatch refused while pattern not Ready", dispatchProblem(good, { ...ver, pattern_status: "acknowledged" }, today), "The pattern is not Ready yet — mark it Ready before sending.");
check("dispatch passes once Ready", dispatchProblem(good, { ...ver, pattern_status: "ready" }, today), null);

// 0637: a cut row is (coordinate, component) — TOP and BOTTOM FRONT BODY are two rows.
check("cutKey: two coordinates → two keys", cutKey({ coordinate_id: "T", component_id: "FB" }) !== cutKey({ coordinate_id: "B", component_id: "FB" }), true);
check("cutKey: no coordinate keys as '-' (0637's SQL coalesce)", cutKey({ coordinate_id: null, component_id: "FB" }), "-|FB");

// 0632: pattern details.
const alloc = { pattern_maker_id: "e", cad_type: "first_pattern", target_date: today };
check("fit wash No needs no percentages", allocationProblem({ ...alloc, fit_wash: false }, today), null);
check("fit wash Yes with both → ok", allocationProblem({ ...alloc, fit_wash: true, length_shrink_pct: 3.5, width_shrink_pct: 2 }, today), null);
check("fit wash Yes, length blank → refused", allocationProblem({ ...alloc, fit_wash: true, length_shrink_pct: null, width_shrink_pct: 2 }, today)?.startsWith("Enter the Length Shrinkage"), true);
check("fit wash Yes, 0% width → refused (0 is not a shrinkage)", allocationProblem({ ...alloc, fit_wash: true, length_shrink_pct: 3, width_shrink_pct: 0 }, today)?.startsWith("Enter the Width Shrinkage"), true);
check("Shrinkage / Wash pattern with Fit Wash No → refused", allocationProblem({ ...alloc, cad_type: "shrinkage_wash", fit_wash: false }, today), "A Shrinkage / Wash Pattern needs Bit Wash = Yes.");
check(
  "marker planning needs a layout; first pattern does not",
  [dispatchProblem(good, { ...ver, cad_type: "marker_planning" }, today) !== null, dispatchProblem(good, ver, today)],
  [true, null],
);

const dsp = { dispatch_date: "2026-09-20", layout_type: "tubular" };
check("approve, layouts agree", decisionProblem({ status: "approved", decided_on: today, buyer_comments: null }, dsp, "tubular", "S1", today), null);
check(
  "approve, layouts disagree → refused, both named",
  decisionProblem({ status: "approved", decided_on: today, buyer_comments: null }, { ...dsp, layout_type: "open_width" }, "tubular", "S1", today)?.includes("Open Width but style S1 is declared Tubular"),
  true,
);
check("approve, style declares no layout → allowed", decisionProblem({ status: "approved", decided_on: today, buyer_comments: null }, dsp, null, "S1", today), null);
check("rework mismatched layout is fine (it is going back anyway)", decisionProblem({ status: "rework", decided_on: today, buyer_comments: "FIX" }, { ...dsp, layout_type: "open_width" }, "tubular", "S1", today), null);
check("rework with blank comments refused", decisionProblem({ status: "rework", decided_on: today, buyer_comments: "   " }, dsp, null, "S1", today)?.startsWith("Enter the Buyer Alteration"), true);
check("decision before dispatch refused", decisionProblem({ status: "approved", decided_on: "2026-09-19", buyer_comments: null }, dsp, null, "S1", today), "The Decision Date cannot be before the Dispatch Date.");

// Lateness
check("allocated past target → late", cadLateness({ target_date: "2026-09-20", dispatch: null, decision: null }, today), { late: true, days: 4, what: "past target" });
check("allocated ON target → not late", cadLateness({ target_date: today, dispatch: null, decision: null }, today).late, false);
check(
  "awaiting buyer past expected → late",
  cadLateness({ target_date: "2026-09-01", dispatch: disp({ expected_approval_date: "2026-09-22" }), decision: dec("pending") }, today),
  { late: true, days: 2, what: "buyer reply overdue" },
);
check(
  "approved is never late, whatever the dates",
  cadLateness({ target_date: "2026-09-01", dispatch: disp({ expected_approval_date: "2026-09-02" }), decision: dec("approved", today) }, today).late,
  false,
);

// Pattern makers
const staff = [
  { id: "a", code: null, name: "RAVI", inactive: false, designation: "pattern maker " },
  { id: "b", code: null, name: "SITA", inactive: false, designation: "CAD TECHNICIAN" },
  { id: "c", code: null, name: "PACKER", inactive: false, designation: "PACKING" },
  { id: "d", code: null, name: "OLD", inactive: true, designation: "PATTERN MAKER" },
];
check("offers pattern maker + CAD technician, case/space-insensitive; not the packer, not the inactive", patternMakerOptions(staff, null).items.map((e) => e.id), ["a", "b"]);
check("the held (inactive) maker survives, last", patternMakerOptions(staff, "d").items.map((e) => e.id), ["a", "b", "d"]);
check("CAD DESIGNER qualifies (0632)", patternMakerOptions([{ id: "x", code: null, name: "RAMESH", inactive: false, designation: "CAD Designer" }], null).items.length, 1);
check("nobody tagged → empty, with the reason — never everyone", patternMakerOptions([staff[2]], null).items.length === 0 && !!patternMakerOptions([staff[2]], null).hint, true);

// ---------------------------------------------------------------------------
// 6. The SQL mirror — 0628.
// ---------------------------------------------------------------------------
const sql = readFileSync(new URL("../supabase/migrations/0628_cad_lifecycle.sql", import.meta.url), "utf8");
const statesFn = sql.match(/function public\.cad_style_states[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? "";
const sqlStates = [...new Set([...statesFn.matchAll(/'(not_allocated|allocated|pending)'/g)].map((m) => m[1]))];
const approvalCheck = sql.match(/status\s+text not null default 'pending' check \(status in \(([^)]*)\)\)/)?.[1] ?? "";
const sqlDecisions = [...approvalCheck.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
check("SQL states = TS states", [...sqlStates, ...sqlDecisions.filter((d) => d !== "pending")].sort(), [...CAD_STATES].sort());
// Files and designations were redefined by 0632 — the LATEST definition is the one that runs.
const sql632 = readFileSync(new URL("../supabase/migrations/0632_cad_pattern_details.sql", import.meta.url), "utf8");
const kindCheck = sql632.match(/constraint chk_ocdf_kind_extension check \(([\s\S]*?)\)\);/)?.[1] ?? "";
const extsOf = (kind: string) =>
  [...(kindCheck.match(new RegExp(`kind = '${kind}'\\s+and extension in \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
check("SQL pattern extensions = TS", extsOf("pattern"), [...PATTERN_FILE_EXTENSIONS]);
check("SQL proof extensions = TS", extsOf("proof"), [...PROOF_FILE_EXTENSIONS]);
const rpcCad = sql632.match(/if v_ext <> 'pdf' then v_cad/) !== null;
check("SQL counts every non-PDF pattern file as the real CAD file (TS: CAD_FILE_EXTENSIONS)", [rpcCad, [...CAD_FILE_EXTENSIONS]], [true, PATTERN_FILE_EXTENSIONS.filter((e) => e !== "pdf")]);
const desigCheck = sql632.match(/v_desig not in \(([^)]*)\)/)?.[1] ?? "";
check("SQL Pattern Maker designations = TS", [...desigCheck.matchAll(/'([A-Z ]+)'/g)].map((m) => m[1]), [...PATTERN_MAKER_DESIGNATIONS]);

// --- Cut Method → roll form (Task 1) and merged Pattern Sheet lines (0643) -----
check("Direct Shape is Open Width", layoutForPart("direct_shape", "SINGLE JERSEY"), "open_width");
check("Fit Form Cutting is Tubular", layoutForPart("fit_form", null), "tubular");
check("no method, a rib structure: Tubular", layoutForPart(null, "1X1 LYCRA RIB"), "tubular");
check("the method wins over the structure", layoutForPart("direct_shape", "1X1 LYCRA RIB"), "open_width");
check("RIBBON is not a rib", layoutForPart(null, "RIBBON TAPE"), null);
check("nothing to go on: null, never a guess", layoutForPart(null, "SINGLE JERSEY"), null);
{
  const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const line = (parts: string[], over: Record<string, unknown> = {}) => ({
    parts: parts.map((c) => ({ coordinate_id: null, component_id: c })),
    fabric_category_id: U(9),
    gsm: 180,
    colours: ["WHITE"],
    size_ids: [U(8)],
    table_dia: 64,
    width_form: "open_width" as const,
    avg_pcs_weight_g: 150,
    remark: null as string | null,
    ...over,
  });
  const m = mergePatternLines([line([U(1)], { remark: "A" }), line([U(2)], { remark: "B" }), line([U(3)]), line([U(1)], { gsm: 220 })]);
  check("three lines differing only in the part merge into one", m.length, 2);
  check("parts are unioned in order", m[0].parts.map((p) => p.component_id), [U(1), U(2), U(3)]);
  check("remarks are kept, joined", m[0].remark, "A · B");
  check("a different GSM stays its own line", m[1].gsm, 220);
  check("a different weight never merges", mergePatternLines([line([U(1)]), line([U(2)], { avg_pcs_weight_g: 25 })]).length, 2);
  check("a different size never merges", mergePatternLines([line([U(1)]), line([U(2)], { size_ids: [U(7)] })]).length, 2);
  check("colours compare as a set", mergePatternLines([line([U(1)], { colours: ["WHITE", "NAVY"] }), line([U(2)], { colours: ["NAVY", "WHITE"] })]).length, 1);
  check("sizes compare as a set", mergePatternLines([line([U(1)], { size_ids: [U(7), U(8)] }), line([U(2)], { size_ids: [U(8), U(7)] })]).length, 1);
  check("a different colour set never merges", mergePatternLines([line([U(1)], { colours: ["RED"] }), line([U(2)])]).length, 2);
  check("a part is never listed twice", mergePatternLines([line([U(1)]), line([U(1)])])[0].parts.length, 1);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\ncheck-cad-lifecycle: all passed.");
