/**
 * THE FABRIC ALLOCATION (CUTTING) SECTION of the Yarn & Fabric Requirement
 * report — client spec 2026-09-19, decision 3A: "append the Fabric Allocation
 * block (Component · Garment Colourway · Net Cutting Wt · Finished Dia/GSM ·
 * Allocated Wt) as a new section at the end of the report".
 *
 * Pure and client-safe (types only from `./reports`, which is `server-only`),
 * the same split `./stage-ledger.ts` makes, so the vectors can run it.
 *
 * ## IT IS THE ENTRY REGISTER, REGROUPED — NEVER A SECOND CALCULATION
 *
 * Every figure comes off `fabricBomEntryRegister`'s rows, which already name
 * the component set, the colourway, the fabric, the GSM and each size's dia.
 * Re-deriving them here from the requirement table would be a second
 * implementation of one document, free to disagree with the register tab
 * beside it.
 *
 * ## THE TWO WEIGHTS
 *
 * - **Allocated Wt** is `netReqWt` — the stored `required_qty`, the finished
 *   cloth the cutting room is issued, cutting-room wastage INCLUDED.
 * - **Net Cutting Wt** is the same cloth WITHOUT that wastage: `netReqWt ÷
 *   (1 + wastage%)`. Checked against every live requirement row (342 of 342,
 *   2026-09-19): `required_qty = basis_qty x consumption x (1 + wastage%)`, so
 *   this is exactly garments x consumption. Divided back out rather than
 *   multiplied up so that no unit is assumed for `pieceWt`.
 *
 * Neither is the GROSS (the weight run backward through the dye / knit
 * losses): that is what is BOUGHT, and the ledger sections above already
 * print it. This section answers what reaches the cutting table.
 *
 * ## ONE ROW PER (COLOURWAY, COMPONENT SET, FABRIC, DIA)
 *
 * The cutting room cuts per diameter, so sizes knitted at one dia merge and
 * sizes at another stay apart. A size row with no dia joins a "no dia" row of
 * its own rather than borrowing a neighbour's.
 */
import type { EntryRegister } from "./reports";

export type FabricAllocationRow = {
  /** The assort colourway — null/"" when none was declared. */
  combo: string | null;
  /** e.g. "BACK, FRONT BODY, SLEEVES" — the Manual entry's component set. */
  component: string;
  fabricName: string;
  /** The finished dia/width for these sizes (text since 0566). */
  dia: string | null;
  gsm: number | null;
  /** Cloth for the garments themselves, BEFORE cutting-room wastage. */
  netCuttingWt: number;
  /** Cloth issued to cutting — wastage INCLUDED (the stored requirement). */
  allocatedWt: number;
};

export type FabricAllocation = {
  rows: FabricAllocationRow[];
  netCuttingWt: number;
  allocatedWt: number;
};

/** A register size row's weight before wastage — see the header. */
function beforeWastage(netReqWt: number, wastagePct: number | null): number {
  const w = wastagePct ?? 0;
  return w > -100 ? netReqWt / (1 + w / 100) : netReqWt;
}

const round = (v: number) => Number(v.toFixed(3));

export function fabricAllocationOf(register: Pick<EntryRegister, "groups">): FabricAllocation {
  const rows: FabricAllocationRow[] = [];
  for (const colour of register.groups) {
    for (const comp of colour.components) {
      /* Sizes in first-seen order, merged by dia — the register's own size
         order, so the section reads in the sequence the tab above does. */
      const byDia = new Map<string, FabricAllocationRow>();
      for (const sz of comp.sizes) {
        const key = sz.dia ?? "";
        let row = byDia.get(key);
        if (!row) {
          row = {
            combo: colour.combo,
            component: comp.componentNames.join(", "),
            fabricName: comp.fabricName,
            dia: sz.dia,
            gsm: comp.gsm,
            netCuttingWt: 0,
            allocatedWt: 0,
          };
          byDia.set(key, row);
        }
        row.netCuttingWt += beforeWastage(sz.netReqWt, sz.wastagePct);
        row.allocatedWt += sz.netReqWt;
      }
      for (const row of byDia.values()) {
        rows.push({ ...row, netCuttingWt: round(row.netCuttingWt), allocatedWt: round(row.allocatedWt) });
      }
    }
  }
  return {
    rows,
    netCuttingWt: round(rows.reduce((a, r) => a + r.netCuttingWt, 0)),
    allocatedWt: round(rows.reduce((a, r) => a + r.allocatedWt, 0)),
  };
}
