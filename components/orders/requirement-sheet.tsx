import { DocumentPrintStyles } from "./document-print-styles";
import { fmtDateTime } from "@/lib/format";
import { isReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import { ACCESSORY_COLUMNS, accessoryQty, accessoryRows } from "@/lib/orders/requirement/sheet";
import type { RequirementSheetData } from "@/lib/orders/requirement/service";
import { BRAND } from "@/lib/orders/report-pdf-kit";
import {
  SectionCard,
  SheetLabel,
  SheetMasthead,
  SignOff,
  SummaryTiles,
  Swatch,
  stripeRow,
} from "@/components/orders/report-kit";
import { SheetOpening } from "@/components/orders/sheet-opening";

/**
 * THE ACCESSORIES REQUIREMENT, ON SCREEN — THE SHEET FORMAT (user 2026-09-29,
 * the approved "Raagam Requirement Sheet": "this is okay apply it").
 *
 * The same document the PDF draws (`exportAccessoriesRequirementPdf`), block
 * for block, so what the operator checks here is what the supplier is sent:
 *
 *   - the opening every BomDocHeader report shares (`SheetOpening`): masthead,
 *     Customer / Order No / Style (Description under it) / Earlier Shipment
 *     (Delivery under it) / Unit / Excess, and the quantity as the sum
 *     Order + Excess + Approval + Rej.Allow = Cut. The header is the Yarn &
 *     Fabric Requirement's own (`loadMaterialBomDocHeader`), so the two
 *     documents never disagree about an order's quantities;
 *   - the sheet's counts as tiles — trim lines, categories, any unplanned;
 *   - TRIMS PURCHASE as a card — Category | Item Name | Consumption | Color |
 *     Size | Specification | UOM | Required Qty (user 2026-09-29), the category
 *     written once over its items; Specification exactly as typed, blank when
 *     nothing was;
 *   - Prepared By / Checked By / Approved By.
 *
 * It replaced the RP printout's centred letterhead and bordered grids — the
 * client's "we do not need to copy the legacy paper layout, keep every detail"
 * (2026-09-29). The printout's SQ No / SQ Description are the standing
 * 2026-09-23 decision: gone, and the column reads Cut. "SC No" reads RE No.
 *
 * A server component with nothing to hydrate; the three buttons above it are
 * `RequirementToolbar`. Borders are set INLINE: `document-print-styles`'
 * `.req-sheet th, td` rule draws a full grid and outranks utility classes.
 */
export function RequirementSheetDocument({ data }: { data: RequirementSheetData }) {
  const rows = accessoryRows(data.rows, data.names);
  /* A sheet frozen as V_final before 2026-09-24 carries no header — it still
     prints its body, and says why the facts above are missing. */
  const h = data.header && !isReportRefusal(data.header) ? data.header : null;
  const categories = rows.filter((r) => r.category != null).length;
  const unplanned = rows.filter((r) => r.qty == null).length;

  return (
    <>
      <DocumentPrintStyles scope="req" />
      <article className="req-sheet mx-auto max-w-[1100px] bg-white pb-6 text-[12px] text-[#17202b]">
        <div>
          {h ? (
            <SheetOpening kind="Accessories Requirement" header={h} thumbnail={null} />
          ) : (
            <div className="mb-5">
              <SheetMasthead
                company={{ name: data.company.name ?? "RAAGAM EXPORTS" }}
                kind="Accessories Requirement"
                reNo={data.order.scNo ?? null}
              />
            </div>
          )}
        </div>

        {/* WHEN THE FIGURES WERE STORED, not when the page was opened. */}
        <p className="-mt-2 mb-3 px-1 text-[10.5px] text-[#7b8594]">
          Requirement stored {data.bom.computedAt ? fmtDateTime(data.bom.computedAt) : "—"}
        </p>

        {!h && data.header && isReportRefusal(data.header) && (
          <p className="mb-3 rounded-sm bg-[#fdf1f1] px-3 py-2 text-[12px] font-medium text-destructive">{data.header.refused}</p>
        )}

        {rows.length > 0 && (
          <div className="mb-5">
            <SheetLabel>This sheet</SheetLabel>
            <SummaryTiles
              tiles={[
                { label: "Trim lines", value: String(rows.length), note: "to purchase", tone: BRAND },
                { label: "Categories", value: String(categories), note: "item groups", tone: BRAND },
                ...(unplanned ? [{ label: "Unplanned", value: String(unplanned), note: "quantity not worked out", tone: BRAND }] : []),
              ]}
            />
          </div>
        )}

        <SectionCard
          title="Trims Purchase"
          total={rows.length ? `${rows.length} item${rows.length === 1 ? "" : "s"}` : null}
        >
          <div className="req-scroll">
            <table className="req-grid w-full border-collapse">
              <thead>
                <tr>
                  {ACCESSORY_COLUMNS.map((c) => (
                    <Head key={c} right={c === "Required Qty"}>
                      {c}
                    </Head>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <Cell colSpan={ACCESSORY_COLUMNS.length}>No trims on this Material BOM.</Cell>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={r.key} style={stripeRow(i)}>
                    {/* The category, written once over its items, wears the
                        section's tone — the group's own heading cell. */}
                    {r.category != null && (
                      <Cell rowSpan={r.span} top bold tint={BRAND}>
                        {r.category}
                      </Cell>
                    )}
                    {/* ACCESSORY_COLUMNS' order (user 2026-09-29): Item Name ·
                        Consumption · Color · Size · Specification · UOM · Qty. */}
                    <Cell>{r.item}</Cell>
                    <Cell>{r.consumption}</Cell>
                    <Cell>
                      <Swatch name={r.colour} />
                      {r.colour ?? ""}
                    </Cell>
                    <Cell>{r.size ?? ""}</Cell>
                    <Cell>{r.spec ?? ""}</Cell>
                    <Cell>{r.uom}</Cell>
                    {r.qty == null ? (
                      <Cell danger>{r.refusal ?? "—"}</Cell>
                    ) : (
                      <Cell right mono>
                        {accessoryQty(r.qty)}
                      </Cell>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SignOff />
      </article>
    </>
  );
}

/** The card table's head — small grey capitals on white, ruled underneath. */
function Head({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{ background: "#ffffff", border: "none", borderBottom: "1px solid #dde2e8" }}
      className={`whitespace-nowrap px-3 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[.07em] text-[#7b8594] ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Cell({
  children,
  rowSpan,
  colSpan,
  right,
  mono,
  bold,
  top,
  danger,
  tint,
}: {
  children: React.ReactNode;
  rowSpan?: number;
  colSpan?: number;
  right?: boolean;
  mono?: boolean;
  bold?: boolean;
  top?: boolean;
  danger?: boolean;
  /** Paint the cell in a tone's tint and ink (a group heading). */
  tint?: { tint: string; ink: string };
}) {
  return (
    <td
      rowSpan={rowSpan}
      colSpan={colSpan}
      style={{
        border: "none",
        borderBottom: "1px solid #eef1f4",
        ...(tint ? { background: tint.tint, color: tint.ink } : {}),
      }}
      className={[
        "px-3 py-1.5 text-[12px]",
        right ? "text-right" : "",
        mono ? "font-mono tabular-nums" : "",
        bold ? "font-bold" : "",
        top ? "align-top" : "",
        danger ? "text-[#b91c1c]" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}
