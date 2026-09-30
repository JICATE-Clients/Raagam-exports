/**
 * THE REQUIREMENT SHEET'S SUMMARY (user 2026-09-29, the approved "Raagam
 * Requirement Sheet" format): the "To buy for this order" tiles and the
 * order's route strip, derived ONCE from the report so the screen and the PDF
 * cannot print two different answers. Pure and client-safe; both renderers
 * call it.
 *
 * Nothing here is a new figure: each tile is a sum of lines the report already
 * prints below it, and the route is the order its sections already follow.
 */
import type { YarnFabricRequirementReport } from "./reports";
import { STAGE_STYLES, sectionStyle, type StageStyle } from "./report-colours";

export type BuyTile = { label: string; qty: number; unit: string | null; note: string; tone: StageStyle };

/** What purchasing buys for this order — only the kinds that are non-zero. */
export function requirementBuyTiles(data: YarnFabricRequirementReport): BuyTile[] {
  const unit = data.yarnGrandTotal?.uomCode ?? data.clothPurchaseTotal?.uomCode ?? null;
  const names = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];

  let greigeYarn = 0;
  let dyedYarn = 0;
  const greigeYarnNames: string[] = [];
  const dyedColours: string[] = [];
  for (const y of data.yarns) {
    if (y.purchaseQty == null) continue;
    if (y.stageState === "DYED") {
      dyedYarn += Number(y.purchaseQty);
      dyedColours.push(y.yarnName);
      continue;
    }
    const dyed = (y.dyedPurchases ?? []).reduce((sum, d) => sum + d.toOrderedWt, 0);
    dyedYarn += dyed;
    for (const d of y.dyedPurchases ?? []) dyedColours.push(d.colour);
    const greige = y.greigeQty ?? Number(y.purchaseQty);
    if (greige > 0) {
      greigeYarn += greige;
      greigeYarnNames.push(y.yarnName);
    }
  }

  let dyedFabric = 0;
  let greigeFabric = 0;
  const dyedFabricColours: string[] = [];
  const greigeFabricNames: string[] = [];
  for (const c of data.clothPurchase) {
    if (c.source === "dyed_purchase") {
      dyedFabric += c.purchaseWt;
      dyedFabricColours.push(c.combo ?? "");
    } else {
      greigeFabric += c.purchaseWt;
      greigeFabricNames.push(c.fabricName);
    }
  }

  const list = (xs: string[], max = 3) => {
    const u = names(xs);
    return u.length > max ? `${u.slice(0, max).join(", ")} +${u.length - max}` : u.join(", ");
  };
  const conversionNote = (data.conversion ?? []).length ? "includes loose fabric for conversion" : "";
  const tiles: BuyTile[] = [];
  if (greigeYarn > 0) {
    tiles.push({
      label: "Greige yarn",
      qty: greigeYarn,
      unit,
      note: [list(greigeYarnNames, 2), data.yarnDyeing.length ? "dyed in-house" : ""].filter(Boolean).join(" · "),
      tone: STAGE_STYLES.yarn,
    });
  }
  if (dyedYarn > 0) {
    tiles.push({ label: "Dyed yarn", qty: dyedYarn, unit, note: `${list(dyedColours)} · bought dyed`, tone: STAGE_STYLES.dyed });
  }
  if (dyedFabric > 0) {
    tiles.push({ label: "Dyed fabric", qty: dyedFabric, unit, note: list(dyedFabricColours), tone: STAGE_STYLES.dyed });
  }
  if (greigeFabric > 0) {
    tiles.push({
      label: "Greige fabric",
      qty: greigeFabric,
      unit,
      note: [list(greigeFabricNames, 1), conversionNote].filter(Boolean).join(" · "),
      tone: STAGE_STYLES.greige,
    });
  }
  return tiles;
}

/** The order's stages, in the order the sheet's sections follow them. */
export function requirementRoute(data: YarnFabricRequirementReport): { label: string; tone: StageStyle }[] {
  const steps: { label: string; tone: StageStyle }[] = [];
  const add = (label: string, tone: StageStyle) => {
    if (!steps.some((s) => s.label.toUpperCase() === label.toUpperCase())) steps.push({ label, tone });
  };
  if (data.yarns.length) add("Yarn purchase", STAGE_STYLES.yarn);
  if ((data.conversion ?? []).length) add("Conversion", STAGE_STYLES.dyed);
  if (data.yarnDyeing.length) add("Yarn dyeing", STAGE_STYLES.dyed);
  if (data.clothPurchase.length) add("Fabric purchase", STAGE_STYLES.greige);
  for (const g of data.stageBreakdown) {
    if (g.isClothPurchase) continue;
    const label = g.processName.replace(/\s*\[.*\]\s*$/, "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    add(label, sectionStyle(g.stages, g.isPrint));
  }
  add("Cutting", STAGE_STYLES.cutting);
  return steps;
}
