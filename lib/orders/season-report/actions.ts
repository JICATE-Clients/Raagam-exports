"use server";

import { requirePermission } from "@/lib/auth/server";
import { getGarmentOrderSheet } from "@/lib/orders/gos/service";
import { isRefusal, type GosSheet, type GosStyle } from "@/lib/orders/gos/types";
import type { SeasonDetail, SeasonStyleDetail } from "./types";

/**
 * Season Report ▸ Detailed — the colour × size breakdown, loaded when the
 * reader asks for it.
 *
 * It is the Garment Order Sheet's OWN matrix (`getGarmentOrderSheet`), not a
 * second reading of the quantity tables: the sheet already resolves pack rows,
 * ratio-wise assortments and undeclared colourways, and a season report that
 * re-derived them would one day disagree with the sheet the floor cuts from.
 *
 * Lazy because the Summary needs none of it, and it costs one sheet per order.
 * Six at a time — each sheet is several round trips and the browser should not
 * wait on thirty in a row.
 *
 * NO TYPES ARE RE-EXPORTED from this file (a `"use server"` module that does
 * crashes at runtime with "X is not defined"; tsc cannot see it).
 */

const AT_A_TIME = 6;
const MAX_ORDERS = 120;

function styleDetail(s: GosStyle): SeasonStyleDetail {
  const base = {
    styleRef: s.styleRef,
    styleCode: s.styleCode,
    description: s.description ?? s.styleName,
    articleNo: s.articleNo,
    qty: s.poQty,
  };
  if (isRefusal(s.matrix)) {
    return { ...base, refused: s.matrix.refused, columns: [], rows: [], columnTotals: [], total: 0 };
  }
  return {
    ...base,
    refused: null,
    columns: s.matrix.columns.map((c) => c.label),
    rows: s.matrix.rows.map((r) => ({ combo: r.combo, cells: r.cells, total: r.total })),
    columnTotals: s.matrix.columnTotals,
    total: s.matrix.total,
  };
}

function detailOf(salesOrderId: string, sheet: GosSheet): SeasonDetail {
  return {
    salesOrderId,
    styles: sheet.styles.map(styleDetail),
    orphanQty: sheet.orphans.reduce((n, o) => n + o.qty, 0),
  };
}

export async function loadSeasonDetail(
  salesOrderIds: string[],
): Promise<{ ok: true; details: SeasonDetail[]; failed: { salesOrderId: string; reason: string }[] } | { ok: false; error: string }> {
  await requirePermission("orders", "view");
  const ids = [...new Set(salesOrderIds)].slice(0, MAX_ORDERS);
  const details: SeasonDetail[] = [];
  const failed: { salesOrderId: string; reason: string }[] = [];
  try {
    for (let i = 0; i < ids.length; i += AT_A_TIME) {
      const batch = ids.slice(i, i + AT_A_TIME);
      const sheets = await Promise.all(batch.map((id) => getGarmentOrderSheet(id)));
      sheets.forEach((sheet, k) => {
        if (isRefusal(sheet)) failed.push({ salesOrderId: batch[k], reason: sheet.refused });
        else details.push(detailOf(batch[k], sheet));
      });
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load the colour and size breakdown" };
  }
  return { ok: true, details, failed };
}
