import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { isRefusal, type GosPanel, type GosSheet, type GosStyle } from "@/lib/orders/gos/types";
import type { ReportStyleImage, ReportStyleImages } from "@/lib/orders/gos/style-images";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import { CONSTRUCTION_ONLY, DASH, gosHeaderColumns, gosStyleFacts, txt } from "@/lib/orders/gos/format";
import { DocumentPrintStyles } from "./document-print-styles";
import { GosStyleImages } from "./gos-style-images";
import { GosToolbar } from "./gos-toolbar";

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
  const contact = [company.unit, company.address, company.gstin ? `GSTIN ${company.gstin}` : null]
    .filter(Boolean)
    .join("  ·  ");

  /* EACH STYLE'S PICTURES PRINT IN ITS OWN BLOCK, matched by the style's TEXT
     reference — the key the files carry (0479). A group that matches no block
     (filed against the order, or under a reference this sheet does not print)
     goes under the header instead of being dropped: a ticked picture that
     silently never prints is the tick lying to the operator. */
  const imageGroups = "failed" in styleImages ? [] : styleImages;
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

        {/* ---- the letterhead ---- */}
        <header className="gos-keep overflow-hidden rounded-t-md border border-b-0 border-border bg-white">
          <div className="h-[3px] bg-[#85c227]" />
          <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#16181d] px-5 py-3">
            <div className="flex min-w-0 items-center gap-4">
              {company.logo && (
                // A plain <img>: a stored data URL or an external Company
                // Profile URL, which next/image would need configuring for.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={company.logo}
                  alt={company.name ?? "Company logo"}
                  className="h-12 w-auto shrink-0 object-contain"
                />
              )}
              <div className="min-w-0">
                <div className="text-[16px] font-bold uppercase tracking-wide text-[#16181d]">
                  {company.name ?? "RAAGAM EXPORTS"}
                </div>
                {contact && <div className="mt-0.5 text-[11.5px] text-[#5b6472]">{contact}</div>}
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-[12.5px] font-bold uppercase tracking-[.12em] text-[#037bb8]">
                Garment Order Sheet
              </h1>
              {/*
               * THE RE NUMBER IS THE BIGGEST THING ON THE PAGE, on purpose. 500+
               * people track every piece of work by it and by nothing else, and
               * a sheet found face-down on a table has to be identifiable from
               * arm's length. It is `sales_orders.order_number`, generated in
               * the database (0395) — never rebuilt here.
               */}
              <p className="font-mono text-2xl font-bold leading-tight text-[#16181d]">{txt(header.reNumber)}</p>
              {header.isDraft && (
                // A DRAFT IS NOT A DIRECTIVE. Said in words rather than as a
                // watermark: a faint diagonal is the first thing a photocopier
                // loses, and this must survive being copied.
                <p className="mt-1 inline-block border border-[#b3261e] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#b3261e]">
                  Draft — not confirmed
                </p>
              )}
            </div>
          </div>
        </header>

        {/* ---- the boxed header: four columns, each read down ---- */}
        <section className="gos-keep grid grid-cols-1 gap-x-6 gap-y-1 border border-t-0 border-border bg-white px-5 py-2.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
          {gosHeaderColumns(sheet).map((col, ci) => (
            <div key={ci} className="space-y-1">
              {col.map(([label, value]) => (
                <Fact key={label} label={label} value={value} mono={label === "S No" || label.startsWith("Order No")} />
              ))}
            </div>
          ))}
        </section>

        {"failed" in styleImages && (
          // Screen only: the sheet is still correct without its pictures, but an
          // operator who ticked one must learn why it is not here.
          <p className="border border-t-0 border-border bg-[#fdf3f2] px-5 py-2 text-[12px] text-[#b3261e] print:hidden">
            Style images are not shown — {styleImages.failed}
          </p>
        )}
        {unplaced.length > 0 && (
          <Box>
            {unplaced.map((g) => (
              <GosStyleImages
                key={g.styleRef ?? ""}
                images={g.images}
                title={g.styleRef == null ? "Order images" : `Style images · ${g.styleRef}`}
              />
            ))}
          </Box>
        )}

        {/*
         * Destinations print only when the order ships to more than one. On a
         * single-destination order every column here restates the header, and a
         * restated fact is a fact somebody has to reconcile.
         */}
        {multiDestination && (
          <Box>
            <SectionTitle>Destinations</SectionTitle>
            <table className="text-[12px]">
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
                  <tr key={i}>
                    <td>{txt(d.label)}</td>
                    <td className="font-mono">{txt(d.poNo)}</td>
                    <td>{fmtDate(d.deliveryDate)}</td>
                    <td>{fmtDate(d.earlierShipmentDate)}</td>
                    <td className="gos-num">{fmtNumber(d.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
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
          <section className="gos-keep border-2 border-[#b3261e] bg-white px-5 py-3">
            <p className="text-[12px] font-bold uppercase tracking-wide text-[#b3261e]">Quantities not shown above</p>
            <p className="mt-1 text-[11.5px] text-[#5b6472]">
              These assortment lines name a style reference this order does not declare, so they could not be
              placed under any style. Correct the order before cutting.
            </p>
            <ul className="mt-2 space-y-0.5 text-[12px]">
              {sheet.orphans.map((o, i) => (
                <li key={i}>
                  <span className="font-mono">{o.ref}</span> · {o.combo} ·{" "}
                  <span className="tabular-nums">{fmtNumber(o.qty)}</span> pcs
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---- the foot: totals, the construction-only line, signatures ---- */}
        <footer className="gos-keep rounded-b-md border border-t-0 border-border bg-white px-5 pb-3 pt-3 text-[12px]">
          <div className="flex flex-wrap justify-between gap-4">
            <span className="font-semibold">
              Order total {fmtNumber(sheet.grandTotal)} pcs · {sheet.styles.length} style
              {sheet.styles.length === 1 ? "" : "s"}
            </span>
            <span className="text-[11px] text-[#5b6472]">Printed {fmtDateTime(sheet.printedAt)}</span>
          </div>
          {/*
           * The exclusion is STATED. A construction sheet with no trims on it
           * looks incomplete to anyone who has not been told the policy — and a
           * supervisor who assumes it is incomplete goes looking for a longer
           * version of this document instead of for the right one.
           */}
          <p className="mt-1 text-[11px] text-[#5b6472]">{CONSTRUCTION_ONLY}</p>

          {/* THE THREE SIGNATURES — the order documents' foot. */}
          <div className="mt-10 grid grid-cols-3 gap-4 font-semibold">
            <div className="border-t border-[#16181d] pt-1">Prepared By</div>
            <div className="border-t border-[#16181d] pt-1 text-center">Checked By</div>
            <div className="border-t border-[#16181d] pt-1 text-right">Approved By</div>
          </div>
        </footer>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The print stylesheet's colours, re-pointed at the order documents' greys —
 *  an inline custom property beats the stylesheet's own `.gos-sheet` values. */
const FAMILY_VARS = {
  "--gos-rule": "#e2e5ea",
  "--gos-rule-strong": "#16181d",
  "--gos-muted": "#5b6472",
  "--gos-fill": "#f6f7f9",
} as React.CSSProperties;

/** One boxed band of the document, stacked under the one above. */
function Box({ children }: { children: React.ReactNode }) {
  return <section className="border border-t-0 border-border bg-white px-5 py-3">{children}</section>;
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <span className="shrink-0 text-[#8b95a3]">{label}:</span>
      <span className={`min-w-0 font-semibold ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[.12em] text-[#16181d]">{children}</h3>;
}

/** A table header cell — the stylesheet fills it grey, this sets the ink. */
function Th({ children, num }: { children: React.ReactNode; num?: boolean }) {
  return <th className={`font-semibold text-[#5b6472] ${num ? "gos-num" : ""}`}>{children}</th>;
}

function StyleBlock({
  style,
  images,
}: {
  style: GosStyle;
  images: readonly ReportStyleImage[];
}) {
  return (
    <section className="gos-style border border-t-0 border-border bg-white">
      {/* THE STYLE BANNER — its STL code and name, PO Qty on the right. */}
      <div className="gos-keep flex flex-wrap items-baseline justify-between gap-4 border-b border-border bg-[#f6f7f9] px-5 py-2">
        <p className="text-[13.5px] font-bold text-[#16181d]">
          <span className="font-mono">{txt(style.styleCode ?? style.styleRef)}</span>
          {style.styleName ? ` · ${style.styleName}` : ""}
        </p>
        <p className="text-[12.5px] tabular-nums">
          PO Qty <span className="font-bold">{fmtNumber(style.poQty)}</span>
        </p>
      </div>

      <div className="px-5 py-3">
        {/*
         * NO PER-STYLE "S No". The style's serial is its STL number, which is
         * the heading directly above — a second number beside it would have
         * been an array index nothing issued. Unit is piece vs set WITH the
         * count, which is what makes the warning below legible.
         */}
        <div className="gos-keep grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
          {gosStyleFacts(style).map(([label, value]) => (
            <Fact key={label} label={label} value={value} mono={label === "Style Ref"} />
          ))}
        </div>
        {style.coordinateWarning && (
          <p className="mt-2 border border-[#b3261e] bg-[#fdf3f2] px-2 py-1 text-[11.5px] font-semibold text-[#b3261e]">
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

        <div className="gos-keep mt-3">
          <SectionTitle>Size-wise and colour-wise break-up</SectionTitle>
          <Matrix style={style} />
        </div>

        <div className="mt-3">
          <SectionTitle>Components</SectionTitle>
          <Components style={style} />
        </div>
      </div>
    </section>
  );
}

function Matrix({ style }: { style: GosStyle }) {
  if (isRefusal(style.matrix)) {
    // A REFUSAL IS A SENTENCE, NOT AN EMPTY GRID. An empty matrix is what an
    // order nobody has broken up yet looks like, so it would read as a
    // legitimate answer rather than as the absence of one.
    return (
      <p className="border border-[#b3261e] bg-[#fdf3f2] px-2 py-1.5 text-[12px] font-semibold text-[#b3261e]">
        {style.matrix.refused}
      </p>
    );
  }
  const m = style.matrix;

  return (
    <div className="gos-scroll">
      <table className="text-[12px]">
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
          {m.rows.map((r) => (
            <tr key={r.combo}>
              <td className="font-medium">
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
          <tr>
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
      <p className="border border-[#b3261e] bg-[#fdf3f2] px-2 py-1.5 text-[12px] font-semibold text-[#b3261e]">
        No components are declared for this style — the Combos tab has no structure detail.
      </p>
    );
  }

  return (
    <div className="gos-scroll">
      <table className="text-[12px]">
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
                className="bg-[var(--gos-fill)] text-[11px] font-bold uppercase tracking-wide"
              >
                {block.coordinate}
              </td>
            </tr>
            {block.panels.map((p, i) => (
              <PanelRow key={i} panel={p} colourways={style.colourways} />
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
}: {
  panel: GosPanel;
  colourways: readonly string[];
}) {
  return (
    <tr>
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
