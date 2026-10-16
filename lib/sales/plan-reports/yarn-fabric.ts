import type {
  BomDocHeader,
  ClothPurchaseLine,
  StageBreakdownGroup,
  StageBreakdownLine,
  YarnDyeingLine,
  YarnFabricRequirementReport,
  YarnRequirementLine,
} from "@/lib/orders/fabric-bom/reports";
import { mergeGreigeLines } from "@/lib/orders/fabric-bom/stage-ledger";
import { printRequirement, type PrintRequirementRow } from "@/lib/orders/fabric-bom/print-route";
import { stageRank } from "@/lib/orders/fabric-bom/stage-routes";
import { clothPurchaseLabel, type FabricSource } from "@/lib/orders/fabric-bom/fabric-source";
import { comboKey } from "@/lib/orders/fabric-bom/yarn-process";

/**
 * THE SAMPLE FABRIC PLAN, AS ORDER ENTRY'S FABRIC PLAN REPORT (user
 * 2026-10-14: "the fabric plan report need to same as like order entry fabric
 * plan report … take it as reference for the sample module").
 *
 * Order Entry's Fabric Plan prints the **Yarn & Fabric Requirement** — the
 * RP-format sheet: masthead and facts, Quantity to cut, To buy, Route, Yarn
 * Purchase Requirement (with Yarn Dyeing / Dyed Yarn Purchase), one section
 * per process in route order, and the Fabric Allocation (cutting). Its loader
 * cannot read a sample plan — it is 3,000 lines over `order_fabric_bom_*`,
 * colourways and Manual consumption — but its RENDERER and its PDF exporter
 * read nothing but a `YarnFabricRequirementReport`. So this file builds that
 * object from the sample plan's STORED rows, and the sample prints through the
 * very same `FabricBomReportView` / `exportYarnRequirementPdf`. Same document,
 * not a look-alike that drifts the first time the order report changes.
 *
 * THE MAPPING, decided once here:
 *  - RE No → the SWO No; Order No → the SMP numbers; Style → PRD no + style;
 *    Quantity to cut → the samples' pieces (no excess / approval / rejection
 *    on a sample, so Order = Cut).
 *  - Colourway → the line's own Colour — the bucket the IWO yarn engine
 *    already treats as one (`iwoFabricGross`), so colour-wise losses (0613)
 *    resolve against the same key.
 *  - Yarns are the STORED purchase rows; a DYED yarn's shades become Yarn
 *    Dyeing lines (colour by yarn dyeing) or Dyed Yarn Purchase lines (bought
 *    dyed), their loss read back from planned vs purchase — never re-derived.
 *  - The process sections walk each line's route BACKWARD from its Req Wt with
 *    the engine's loss rule (divide by 1 − L), exactly as the order ledger does.
 *  - A cloth whose route OPENS with a purchase step (FABRIC PURCHASE, DYED
 *    FABRIC PURCHASE) is bought by the roll: it is a Fabric Purchase line —
 *    Req Wt grossed back through the whole route, the order's `net × ladder`
 *    — and buys no yarn (the plan's save leaves it out of the yarn rows,
 *    `iwoSourceByFabric`, 2026-10-16).
 *  - Fabric Allocation lists the lines themselves: Req Wt is the cloth issued
 *    to cutting (a sample plan stores no separate cutting wastage, so net =
 *    allocated).
 *
 * Pure: the loader (./service.ts) reads, this shapes.
 */

export type SampleYarnFabricInput = {
  header: BomDocHeader;
  lines: {
    sample: string;
    itemId: string;
    fabric: string;
    stageId: string | null;
    form: string | null;
    gsm: number | null;
    colour: string | null;
    dia: string | null;
    print: string | null;
    part: string | null;
    reqKg: number;
  }[];
  yarns: {
    itemId: string;
    yarn: string;
    buyStage: { code: string | null; name: string } | null;
    colourBy: string | null;
    purchaseQty: number | null;
    uom: string | null;
    refusal: string | null;
    shades: { colour: string; plannedKg: number | null; purchaseQty: number | null }[];
  }[];
  /** Every route step, any fabric, with its process and stage resolved. */
  steps: {
    itemId: string;
    sno: number;
    processId: string;
    processName: string;
    isPrint: boolean;
    isClothPurchase: boolean;
    isDyeing: boolean;
    stage: { id: string; code: string | null; name: string } | null;
    lossPct: number | null;
    colorLosses: Record<string, number> | null;
  }[];
};

const r6 = (v: number) => Number(v.toFixed(6));
const r3 = (v: number) => Number(v.toFixed(3));
/** The loss a stored pair implies — planned is what is needed, purchase what is bought. */
const impliedLoss = (planned: number | null, bought: number | null): number | null =>
  planned != null && bought != null && bought > 0 && bought >= planned ? r3((1 - planned / bought) * 100) : null;

/** One-unit sum or nothing — the order report's own refusal to add kg to m. */
function oneUnitTotal(rows: { qty: number | null; uom: string | null }[]): { qty: number; uomCode: string | null } | null {
  if (!rows.length || rows.some((r) => r.qty == null)) return null;
  const units = new Set(rows.map((r) => r.uom ?? ""));
  if (units.size !== 1) return null;
  return { qty: r6(rows.reduce((t, r) => t + (r.qty as number), 0)), uomCode: rows[0].uom };
}

export function sampleYarnFabricReport(input: SampleYarnFabricInput): YarnFabricRequirementReport {
  // ---- Yarn Purchase · Yarn Dyeing · Dyed Yarn Purchase ---------------------
  const yarnDyeing: YarnDyeingLine[] = [];
  const yarns: YarnRequirementLine[] = input.yarns.map((y) => {
    const dyedStage = !!y.buyStage && (stageRank({ id: "", ...y.buyStage }) ?? 0) >= 1;
    const shades = y.shades.filter((s) => s.colour && s.colour !== "—");
    const base: YarnRequirementLine = {
      itemId: y.itemId,
      yarnName: y.yarn,
      stageState: "GREY",
      itemType: "YARN",
      color: null,
      purchaseQty: y.purchaseQty,
      uomCode: y.uom,
      refusalReason: y.refusal,
      byFabric: [],
    };
    if (!dyedStage || !shades.length) return base;
    if (y.colourBy === "yarn_dyeing") {
      // Bought grey, dyed by us: the grey line above, the dye-house lots below.
      for (const s of shades) {
        const planned = s.plannedKg ?? 0;
        const ordered = s.purchaseQty ?? planned;
        yarnDyeing.push({
          yarnItemId: y.itemId,
          yarnName: y.yarn,
          colorName: s.colour,
          combo: null,
          mixingPct: 0,
          plannedWt: planned,
          lossPct: impliedLoss(planned, ordered) ?? 0,
          toOrderedWt: ordered,
          uomCode: y.uom,
        });
      }
      return base;
    }
    // Bought already dyed. One shade is one DYED line; several are a Dyed Yarn
    // Purchase line each, the order report's own split (greige part = 0).
    if (shades.length === 1) return { ...base, stageState: "DYED", color: shades[0].colour };
    return {
      ...base,
      greigeQty: 0,
      dyedPurchases: shades.map((s) => ({
        colour: s.colour,
        plannedWt: s.plannedKg ?? 0,
        lossPct: impliedLoss(s.plannedKg, s.purchaseQty),
        toOrderedWt: s.purchaseQty ?? s.plannedKg ?? 0,
      })),
    };
  });
  const yarnDyeingTotal = yarnDyeing.length
    ? (() => {
        const t = oneUnitTotal(yarnDyeing.map((l) => ({ qty: l.toOrderedWt, uom: l.uomCode })));
        return t ? { plannedWt: r6(yarnDyeing.reduce((a, l) => a + l.plannedWt, 0)), toOrderedWt: t.qty, uomCode: t.uomCode } : null;
      })()
    : null;

  const text = (v: string | null | undefined) => v ?? "";

  // ---- The process sections ------------------------------------------------
  const stepsByItem = new Map<string, SampleYarnFabricInput["steps"]>();
  for (const st of [...input.steps].sort((a, b) => a.sno - b.sno)) {
    const list = stepsByItem.get(st.itemId) ?? [];
    list.push(st);
    stepsByItem.set(st.itemId, list);
  }
  const minSno = new Map<string, number>();
  for (const st of input.steps) minSno.set(st.processId, Math.min(minSno.get(st.processId) ?? Infinity, st.sno));

  const byProcess = new Map<string, StageBreakdownGroup>();
  const stagesOf = new Map<string, Map<string, { id: string; code: string | null; name: string }>>();
  const refusals: string[] = [];
  /** Bought cloth, one line per (fabric, colour) — the order's grain. */
  const clothBy = new Map<string, ClothPurchaseLine>();
  const kgCode = input.yarns.find((y) => y.uom)?.uom ?? null;
  /** A route opening with a purchase step buys the cloth — greige or dyed by
   *  that step's stage, the order's `branchSource` rule. An unranked stage
   *  buys nothing (null), exactly as there. */
  const sourceOf = (route: SampleYarnFabricInput["steps"]): FabricSource | null => {
    const first = route[0];
    if (!first?.isClothPurchase || !first.stage) return null;
    const rank = stageRank(first.stage);
    return rank === 0 ? "greige_purchase" : rank != null && rank >= 1 ? "dyed_purchase" : null;
  };
  for (const l of input.lines) {
    const route = stepsByItem.get(l.itemId) ?? [];
    if (!route.length || !(l.reqKg > 0)) continue;
    const colour = comboKey(l.colour);
    // BACKWARD from the cutting table: the last step delivers Req Wt.
    let out = l.reqKg;
    let walked = true;
    for (let i = route.length - 1; i >= 0; i--) {
      const st = route[i];
      const own = st.colorLosses ? Object.entries(st.colorLosses).find(([k]) => comboKey(k) === colour)?.[1] : undefined;
      const loss = typeof own === "number" && Number.isFinite(own) ? own : (st.lossPct ?? 0);
      if (!(loss < 100)) {
        refusals.push(`${l.fabric} · ${st.processName}: a ${loss}% loss leaves nothing — check the Fabric Process route.`);
        walked = false;
        break;
      }
      const input_ = out / (1 - loss / 100);
      let g = byProcess.get(st.processId);
      if (!g) {
        g = {
          processId: st.processId,
          processName: st.processName,
          isPrint: st.isPrint,
          isClothPurchase: st.isClothPurchase,
          perComponent: st.isDyeing,
          lines: [],
          byColour: [],
          plannedTotal: 0,
          toOrderedTotal: 0,
        };
        byProcess.set(st.processId, g);
      }
      if (st.stage) {
        const m = stagesOf.get(st.processId) ?? new Map();
        m.set(st.stage.id, st.stage);
        stagesOf.set(st.processId, m);
      }
      const line: StageBreakdownLine = {
        itemId: l.itemId,
        fabricName: l.fabric,
        combo: l.colour || null,
        component: null,
        lossPct: loss,
        plannedWt: r6(out),
        toOrderedWt: r6(input_),
        dia: l.dia,
        fabricColour: l.colour,
        ydComboName: null,
        mixingText: null,
        formLabel: l.form,
        gsm: l.gsm,
        plannedNos: null,
        toOrderedNos: null,
        nosUomCode: null,
        printName: st.isPrint ? l.print : null,
        // A dyeing section bands by the cloth's colour (DyeingLedgerTable).
        band: st.isDyeing ? l.colour || null : undefined,
      };
      g.lines.push(line);
      g.plannedTotal += line.plannedWt;
      g.toOrderedTotal += line.toOrderedWt;
      out = input_;
    }
    // What enters the FIRST step is what is bought, when that step buys it.
    const source = walked ? sourceOf(route) : null;
    const label = source ? clothPurchaseLabel(source) : null;
    if (source && label) {
      const key = `${l.itemId}|${colour}`;
      const held = clothBy.get(key);
      if (held) {
        held.netWt = r6(held.netWt + l.reqKg);
        held.purchaseWt = r6(held.purchaseWt + out);
      } else {
        clothBy.set(key, {
          fabricId: l.itemId,
          fabricName: l.fabric,
          source,
          label,
          combo: l.colour || null,
          component: null,
          netWt: r6(l.reqKg),
          purchaseWt: r6(out),
          uomCode: kgCode,
        });
      }
    }
  }
  const clothPurchase = [...clothBy.values()].sort(
    (a, b) => a.fabricName.localeCompare(b.fabricName) || text(a.combo).localeCompare(text(b.combo)),
  );

  for (const [pid, g] of byProcess) {
    g.stages = [...(stagesOf.get(pid)?.values() ?? [])];
    // One greige lot per fabric, not one per colour (the order report's rule).
    if (g.stages.length && g.stages.every((s) => stageRank(s) === 0)) g.lines = mergeGreigeLines(g.lines);
    const bandOf = (l: StageBreakdownLine) => (g.perComponent ? (l.band ?? null) : l.combo);
    g.lines.sort((a, b) => text(bandOf(a)).localeCompare(text(bandOf(b))) || a.fabricName.localeCompare(b.fabricName));
    const byColour = new Map<string, { combo: string | null; plannedTotal: number; toOrderedTotal: number }>();
    for (const l of g.lines) {
      const k = text(bandOf(l));
      const held = byColour.get(k) ?? { combo: bandOf(l), plannedTotal: 0, toOrderedTotal: 0 };
      held.plannedTotal += l.plannedWt;
      held.toOrderedTotal += l.toOrderedWt;
      byColour.set(k, held);
    }
    g.byColour = [...byColour.values()].map((c) => ({ ...c, plannedTotal: r6(c.plannedTotal), toOrderedTotal: r6(c.toOrderedTotal) }));
    g.plannedTotal = r6(g.plannedTotal);
    g.toOrderedTotal = r6(g.toOrderedTotal);
  }
  const stageBreakdown = [...byProcess.values()].sort((a, b) => (minSno.get(a.processId) ?? 0) - (minSno.get(b.processId) ?? 0));

  // ---- Printing — the PRINT sections, lifted out ----------------------------
  const printRows: PrintRequirementRow[] = stageBreakdown
    .filter((g) => g.isPrint)
    .flatMap((g) =>
      g.lines.map((l) => ({
        processName: g.processName,
        fabricName: l.fabricName,
        combo: l.combo ?? "",
        component: "",
        print: l.printName ?? "",
        dia: l.dia ?? "",
        lossPct: l.lossPct,
        sentWt: l.toOrderedWt,
        receivedWt: l.plannedWt,
      })),
    );

  // ---- Fabric Allocation (cutting) — the plan's own lines -------------------
  const allocRows = input.lines
    .filter((l) => l.reqKg > 0)
    .map((l) => ({
      combo: l.colour,
      // The sample (and its part, 0596) stands where an order prints components.
      component: [l.sample, l.part].filter(Boolean).join(" · "),
      fabricName: l.fabric,
      dia: l.dia,
      gsm: l.gsm,
      netCuttingWt: r3(l.reqKg),
      allocatedWt: r3(l.reqKg),
    }));

  return {
    header: input.header,
    yarns,
    yarnGrandTotal: oneUnitTotal(yarns.map((y) => ({ qty: y.purchaseQty, uom: y.uomCode }))),
    yarnDyeing,
    yarnDyeingTotal,
    conversion: [],
    clothPurchase,
    clothPurchaseTotal: oneUnitTotal(clothPurchase.map((c) => ({ qty: c.purchaseWt, uom: c.uomCode }))),
    stageBreakdown,
    printing: printRequirement(printRows),
    allocation: {
      rows: allocRows,
      netCuttingWt: r3(allocRows.reduce((a, r) => a + r.netCuttingWt, 0)),
      allocatedWt: r3(allocRows.reduce((a, r) => a + r.allocatedWt, 0)),
    },
    stageLedgerRefusals: refusals,
  };
}
