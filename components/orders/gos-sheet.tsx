import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { isRefusal, type GosPanel, type GosSheet, type GosStyle } from "@/lib/orders/gos/types";
import type { ReportStyleImage, ReportStyleImages } from "@/lib/orders/gos/style-images";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import { CONSTRUCTION_ONLY, DASH, gosHeaderFacts, gosStyleFacts, gosSummary, txt } from "@/lib/orders/gos/format";
import { pickReportThumbnail, withoutThumbnail } from "@/lib/orders/gos/report-thumbnail";
import { DocumentPrintStyles } from "./document-print-styles";
import { GosStyleImages } from "./gos-style-images";
import { GosToolbar } from "./gos-toolbar";
import { ReportThumbnail } from "./report-thumbnail";
import {
  BRAND,
  OrderFacts,
  SectionCard,
  SheetLabel,
  SheetMasthead,
  SignOff,
  SummaryTiles,
  Swatch,
  stripeRow,
  totalRowStyle,
  type StageStyle,
} from "./report-kit";

/**
 * THE GARMENT ORDER SHEET, as it prints.
 *
 * A server component: it takes a fully-resolved `GosSheet` and renders it. No
 * state, no effects, nothing to hydrate — the Excel / Print / Download PDF
 * buttons are their own client island (`GosToolbar`).
 *
 * ## THE ORDER DOCUMENTS' FORMAT (client 2026-09-23)
 *
 * "Follow our new format of view": the same letterhead (green rule, logo,
 * company + registered address, blue title), boxed header and table grammar
 * as the Cutting Chart, the Budget Statement and the Fabric BOM reports, and
 * their Prepared / Checked / Approved foot. Nothing the sheet SAYS changed —
 * the RE Number is still the biggest thing on the page, and every rule below
 * still holds.
 *
 * THE SHEET FORMAT (user 2026-09-29, "this is okay apply it" — the approved
 * "Raagam Requirement Sheet" design): the kit's masthead with the RE Number
 * large, the order's facts as a grid beside the style picture, summary tiles,
 * every section a card (tone header with its headline figure, a clean table,
 * tinted totals, swatches), and the kit's sign-off. Every fact and figure the
 * sheet printed before is still here; the PDF draws the same blocks
 * (`lib/orders/gos/export.ts`).
 *
 * ## ONE RULE FOR AN ABSENT VALUE, EVERYWHERE ON THE PAGE
 *
 * An em dash means "the system holds no value here". A digit means the system
 * holds that value, INCLUDING 0. The two are never interchanged, and the size
 * matrix is where it earns its keep: `0` in a size cell is the packer saying
 * "this carton has no XL", while a dash is a size the break-up never mentions.
 * Printing both as `0` turns a question nobody asked into an instruction to
 * make none of it, and a shop floor has no way to tell the difference back.
 *
 * The alternative — a truly empty cell for "not mentioned" — was rejected
 * because an empty cell on paper is indistinguishable from a printing fault,
 * and this sheet is read under factory light by people who cannot check the
 * screen.
 *
 * ## NOTHING HERE COMES FROM `material_bom_*`
 *
 * The Trim Clutter Prevention Policy is why. Buttons, sewing threads and labels
 * are the Accessories Requirement Sheet's; this document is construction only,
 * and the footer says so, so a supervisor who wants a trim knows there is
 * another sheet rather than assuming this one is incomplete.
 */
export function GosSheetDocument({
  sheet,
  company,
  styleImages = [],
}: {
  sheet: GosSheet;
  /** The letterhead — read live beside the sheet, never frozen with it
   *  (`getDocLetterhead`). */
  company: DocLetterhead;
  /**
   * The pictures ticked "Print on reports" (user, 2026-09-23), loaded beside
   * the sheet rather than inside it — see `getReportStyleImages` for why they
   * cannot ride in the payload V_final freezes.
   */
  styleImages?: ReportStyleImages | { failed: string };
}) {
  const { header } = sheet;
  const multiDestination = sheet.destinations.length > 1;

  /* EACH STYLE'S PICTURES PRINT IN ITS OWN BLOCK, matched by the style's TEXT
     reference — the key the files carry (0479). A group that matches no block
     (filed against the order, or under a reference this sheet does not print)
     goes under the header instead of being dropped: a ticked picture that
     silently never prints is the tick lying to the operator. */
  /* THE HEADER THUMBNAIL (2026-09-26) — the first ticked picture, beside the
     order facts. It is taken OUT of the blocks below so it does not print
     twice; the export picks the same one (`pickReportThumbnail`). */
  const thumb = pickReportThumbnail(styleImages, sheet.styles.length === 1 ? sheet.styles[0].styleRef : null);
  const rest = withoutThumbnail(styleImages, thumb);
  const imageGroups = "failed" in rest ? [] : rest;
  const styleRefs = new Set(sheet.styles.map((st) => st.styleRef?.trim()).filter(Boolean));
  const imagesOf = (ref: string | null | undefined) =>
    imageGroups.find((g) => g.styleRef != null && g.styleRef === ref?.trim())?.images ?? [];
  const unplaced = imageGroups.filter((g) => g.styleRef == null || !styleRefs.has(g.styleRef));

  return (
    <div className="space-y-3">
      <GosToolbar sheet={sheet} company={company} styleImages={styleImages} />

      {/* `gos-sheet` + `DocumentPrintStyles` stay, so Ctrl+P on the page still
          prints just the sheet; the print stylesheet's colour variables are
          re-pointed at the order documents' greys (`FAMILY_VARS`). */}
      <article className="gos-sheet" style={FAMILY_VARS}>
        <DocumentPrintStyles scope="gos" />
        {/* Cards frame their tables, so the tables drop their side rules and
            read as the sheet format's clean rows (2026-09-29). */}
        <style dangerouslySetInnerHTML={{ __html: CARD_TABLE_CSS }} />

        {/* ---- the masthead ---- */}
        {/*
         * THE RE NUMBER IS THE BIGGEST THING ON THE PAGE, on purpose. 500+
         * people track every piece of work by it and by nothing else, and a
         * sheet found face-down on a table has to be identifiable from arm's
         * length. It is `sales_orders.order_number`, generated in the database
         * (0395) — never rebuilt here.
         */}
        <div className="gos-keep">
          <SheetMasthead
            company={{ name: company.name, unit: company.unit, logo: company.logo }}
            kind="Garment Order Sheet"
            reNo={txt(header.reNumber)}
            meta={
              header.isDraft ? (
                // A DRAFT IS NOT A DIRECTIVE. Said in words rather than as a
                // watermark: a faint diagonal is the first thing a photocopier
                // loses, and this must survive being copied.
                <span className="border border-[#b3261e] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#b3261e]">
                  Draft — not confirmed
                </span>
              ) : (
                <>Printed {fmtDateTime(sheet.printedAt)}</>
              )
            }
            status={header.isDraft ? null : "Confirmed"}
          />
          <OrderFacts
            thumbnail={thumb ? <ReportThumbnail image={thumb} /> : undefined}
            facts={gosHeaderFacts(sheet).map((f) => ({ ...f, mono: f.label.startsWith("Order No") }))}
          />
        </div>

        {"failed" in styleImages && (
          // Screen only: the sheet is still correct without its pictures, but an
          // operator who ticked one must learn why it is not here.
          <p className="border border-t-0 border-border bg-[#fdf3f2] px-5 py-2 text-[12px] text-[#b3261e] print:hidden">
            Style images are not shown — {styleImages.failed}
          </p>
        )}

        <div className="mt-4 space-y-4">
          <div className="gos-keep">
            <SheetLabel>This order</SheetLabel>
            <SummaryTiles tiles={gosSummary(sheet)} />
          </div>

          {unplaced.map((g) => (
            <SectionCard key={g.styleRef ?? ""} title={g.styleRef == null ? "Order images" : `Style images · ${g.styleRef}`}>
              <div className="px-4 py-3">
                <GosStyleImages images={g.images} />
              </div>
            </SectionCard>
          ))}

          {/*
           * Destinations print only when the order ships to more than one. On a
           * single-destination order every column here restates the header, and a
           * restated fact is a fact somebody has to reconcile.
           */}
          {multiDestination && (
            <SectionCard
              title="Destinations"
              total={`${fmtNumber(sheet.destinations.reduce((a, d) => a + (d.qty ?? 0), 0))} pcs`}
            >
              <table className="gos-card text-[12px]">
                <thead>
                  <tr>
                    <Th>Destination</Th>
                    <Th>Customer PO</Th>
                    <Th>Delivery</Th>
                    <Th>Earlier shipment</Th>
                    <Th num>Qty</Th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.destinations.map((d, i) => (
                    <tr key={i} style={stripeRow(i)}>
                      <td>{txt(d.label)}</td>
                      <td className="font-mono">{txt(d.poNo)}</td>
                      <td>{fmtDate(d.deliveryDate)}</td>
                      <td>{fmtDate(d.earlierShipmentDate)}</td>
                      <td className="gos-num">{fmtNumber(d.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          )}

          {sheet.styles.map((style, i) => (
            <StyleBlock key={`${i}-${style.styleRef}`} style={style} images={imagesOf(style.styleRef)} />
          ))}

          {/*
           * PIECES THAT LANDED NOWHERE ARE PRINTED, NOT DROPPED.
           *
           * An assortment line names a style or inherits its destination's; with
           * several styles declared and a line naming none of them, its quantity
           * belongs to no block above. Silently omitting it would mean fabric
           * nobody cuts, discovered at the packing bench. See `GosOrphan`.
           */}
          {sheet.orphans.length > 0 && (
            <SectionCard
              tone={DANGER}
              title="Quantities not shown above"
              total={`${fmtNumber(sheet.orphans.reduce((a, o) => a + o.qty, 0))} pcs`}
              note="These assortment lines name a style this order does not declare, so they could not be placed under any style. Correct the order before cutting."
            >
              <table className="gos-card text-[12px]">
                <thead>
                  <tr>
                    <Th>Style (not declared)</Th>
                    <Th>Colour</Th>
                    <Th num>Qty</Th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.orphans.map((o, i) => (
                    <tr key={i} style={stripeRow(i)}>
                      <td className="font-mono">{o.ref}</td>
                      <td>
                        <Swatch name={o.combo} />
                        {o.combo}
                      </td>
                      <td className="gos-num">{fmtNumber(o.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          )}

          {/* ---- the foot: totals, the construction-only line, signatures ---- */}
          <footer className="gos-keep pt-1 text-[12px]">
            <div className="flex flex-wrap justify-between gap-4">
              <span className="font-semibold text-[#17202b]">
                Order total {fmtNumber(sheet.grandTotal)} pcs · {sheet.styles.length} style
                {sheet.styles.length === 1 ? "" : "s"}
              </span>
              <span className="text-[11px] text-[#7b8594]">Printed {fmtDateTime(sheet.printedAt)}</span>
            </div>
            {/*
             * The exclusion is STATED. A construction sheet with no trims on it
             * looks incomplete to anyone who has not been told the policy — and a
             * supervisor who assumes it is incomplete goes looking for a longer
             * version of this document instead of for the right one.
             */}
            <p className="mt-1 text-[11px] text-[#7b8594]">{CONSTRUCTION_ONLY}</p>
            <SignOff />
          </footer>
        </div>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The print stylesheet's colours, re-pointed at the sheet format's palette —
 *  an inline custom property beats the stylesheet's own `.gos-sheet` values.
 *  Table heads are white with small grey capitals (the sheet format); totals and
 *  coordinate banners carry the BRAND tint explicitly. */
const FAMILY_VARS = {
  "--gos-rule": "#eef1f4",
  "--gos-rule-strong": "#17202b",
  "--gos-muted": "#7b8594",
  "--gos-fill": "#ffffff",
} as React.CSSProperties;

/** A table inside a card: no side rules (the card frames it), a firmer rule
 *  under the head, the head's small spaced capitals. */
const CARD_TABLE_CSS = `
.gos-sheet table.gos-card th, .gos-sheet table.gos-card td { border-left: 0; border-right: 0; }
.gos-sheet table.gos-card thead th { border-bottom-color: #dde2e8; }
.gos-sheet table.gos-card { margin: 0; }
`;

/** A section that is a WARNING — the unplaced quantities. */
const DANGER: StageStyle = { label: "", tint: "#fdf3f2", rule: "#b3261e", ink: "#b3261e" };

/** A table header cell — small spaced grey capitals, the sheet format's head. */
function Th({ children, num }: { children: React.ReactNode; num?: boolean }) {
  return (
    <th className={`text-[10.5px] font-semibold uppercase tracking-[.07em] text-[#7b8594] ${num ? "gos-num" : ""}`}>
      {children}
    </th>
  );
}

/** A style's fact, label over value — the order facts' own shape. */
function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-[#7b8594]">{label}</div>
      <div className={`mt-px break-words text-[13px] font-semibold text-[#17202b] ${mono ? "font-mono font-medium" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function StyleBlock({
  style,
  images,
}: {
  style: GosStyle;
  images: readonly ReportStyleImage[];
}) {
  return (
    <div className="gos-style space-y-3">
      {/* THE STYLE AS A CARD — its STL code and name, PO Qty at the right, then
          its facts; the break-up and the components follow as their own cards. */}
      <div className="gos-keep">
        <SectionCard
          title={
            <>
              <span className="font-mono">{txt(style.styleCode ?? style.styleRef)}</span>
              {style.styleName ? ` · ${style.styleName}` : ""}
            </>
          }
          total={fmtNumber(style.poQty)}
          totalLabel="PO Qty"
        >
          <div className="px-4 py-3">
            {/*
             * NO PER-STYLE "S No". The style's serial is its STL number, which is
             * the heading directly above — a second number beside it would have
             * been an array index nothing issued. Unit is piece vs set WITH the
             * count, which is what makes the warning below legible.
             */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
              {gosStyleFacts(style).map(([label, value]) => (
                <Fact key={label} label={label} value={value} mono={label === "Style"} />
              ))}
            </div>
            {style.coordinateWarning && (
              <p className="mt-3 rounded border border-[#b3261e] bg-[#fdf3f2] px-2 py-1 text-[11.5px] font-semibold text-[#b3261e]">
                {style.coordinateWarning}
              </p>
            )}
            {/* Between the style's facts and its matrix: the picture is what the
                cutting room checks the rest of the block against. */}
            {images.length > 0 && (
              <div className="mt-3">
                <GosStyleImages images={images} />
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="gos-keep">
        <SectionCard
          title="Size-wise and colour-wise break-up"
          total={isRefusal(style.matrix) ? null : `${fmtNumber(style.matrix.total)} pcs`}
        >
          <Matrix style={style} />
        </SectionCard>
      </div>

      <SectionCard title="Components">
        <Components style={style} />
      </SectionCard>
    </div>
  );
}

function Matrix({ style }: { style: GosStyle }) {
  if (isRefusal(style.matrix)) {
    // A REFUSAL IS A SENTENCE, NOT AN EMPTY GRID. An empty matrix is what an
    // order nobody has broken up yet looks like, so it would read as a
    // legitimate answer rather than as the absence of one.
    return (
      <p className="m-3 rounded border border-[#b3261e] bg-[#fdf3f2] px-2 py-1.5 text-[12px] font-semibold text-[#b3261e]">
        {style.matrix.refused}
      </p>
    );
  }
  const m = style.matrix;

  return (
    <div className="gos-scroll">
      <table className="gos-card text-[12px]">
        <thead>
          <tr>
            <Th>Colour</Th>
            {m.columns.map((c) => (
              <Th key={c.sizeId} num>
                {c.label}
              </Th>
            ))}
            <Th num>Total</Th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r, ri) => (
            <tr key={r.combo} style={stripeRow(ri)}>
              <td className="font-medium">
                <Swatch name={r.combo} />
                {r.combo}
                {/* Not declared on the Combos tab. Marked rather than dropped —
                    a colourway with quantities and no construction behind it is
                    something the cutting room has to be told about. */}
                {r.undeclared && <span className="ml-1 text-[10px] font-normal">(not on Combos)</span>}
              </td>
              {r.cells.map((v, i) => (
                <td key={m.columns[i].sizeId} className="gos-num">
                  {v === null ? DASH : fmtNumber(v)}
                </td>
              ))}
              <td className="gos-num font-semibold">{fmtNumber(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold" style={totalRowStyle(BRAND)}>
            <td>Total</td>
            {m.columnTotals.map((t, i) => (
              <td key={m.columns[i].sizeId} className="gos-num">
                {fmtNumber(t)}
              </td>
            ))}
            <td className="gos-num">{fmtNumber(m.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Components({ style }: { style: GosStyle }) {
  if (style.coordinates.length === 0) {
    return (
      <p className="m-3 rounded border border-[#b3261e] bg-[#fdf3f2] px-2 py-1.5 text-[12px] font-semibold text-[#b3261e]">
        No components are declared for this style — the Combos tab has no structure detail.
      </p>
    );
  }

  return (
    <div className="gos-scroll">
      <table className="gos-card text-[12px]">
        <thead>
          <tr>
            <Th>Component</Th>
            <Th>Structure</Th>
            <Th num>GSM</Th>
            {/*
             * ONE COLUMN PER COLOURWAY, so the same physical panel reads across
             * every colour on one line. The alternative — a whole component
             * block repeated per colourway — multiplies the sheet by the colour
             * count and makes "is the sleeve the same fabric in navy?" a
             * question you answer by flipping pages.
             */}
            {style.colourways.map((c) => (
              <Th key={c}>{c}</Th>
            ))}
          </tr>
        </thead>
        {style.coordinates.map((block) => (
          <tbody key={block.coordinate}>
            {/*
             * THE COORDINATE IS A BANNER ROW, not a repeated cell. On a Set it
             * is the only thing that says which garment a SLEEVE belongs to; on
             * a Piece it costs one line.
             */}
            <tr>
              <td
                colSpan={3 + style.colourways.length}
                className="text-[11px] font-bold uppercase tracking-wide"
                style={{ background: BRAND.tint, color: BRAND.ink }}
              >
                {block.coordinate}
              </td>
            </tr>
            {block.panels.map((p, i) => (
              <PanelRow key={i} panel={p} colourways={style.colourways} stripe={i % 2 === 1} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PanelRow({
  panel,
  colourways,
  stripe = false,
}: {
  panel: GosPanel;
  colourways: readonly string[];
  stripe?: boolean;
}) {
  return (
    <tr style={stripeRow(stripe ? 1 : 0)}>
      <td className="font-medium">{txt(panel.component)}</td>
      <td>{txt(panel.structure)}</td>
      <td className="gos-num">
        {panel.gsm == null
          ? DASH
          : // The tolerance rides with the GSM because they are one
            // specification — a knitter given 180 with no tolerance has been
            // given a target nobody can hit exactly.
            `${fmtNumber(panel.gsm)}${panel.gsmTolerance == null ? "" : ` ±${fmtNumber(panel.gsmTolerance)}`}`}
      </td>
      {colourways.map((c, i) => {
        const v = panel.colours[i];
        return (
          <td key={c}>
            {v === null ? (
              DASH
            ) : (
              <>
                <Swatch name={v.colour} />
                {txt(v.colour)}
                {/* "Fabric Print" is ONE field on the order (0410) and prints
                    under the colour, because a printed panel is that colour
                    WITH that print, not one or the other. */}
                {v.print && <span className="block text-[10px] text-[var(--gos-muted)]">{v.print}</span>}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
}
