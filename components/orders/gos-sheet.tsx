import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { isRefusal, type GosPanel, type GosSheet, type GosStyle } from "@/lib/orders/gos/types";
import { DocumentPrintStyles } from "./document-print-styles";

/**
 * THE GARMENT ORDER SHEET, as it prints.
 *
 * A server component: it takes a fully-resolved `GosSheet` and renders it. No
 * state, no effects, nothing to hydrate — a document has no behaviour beyond
 * the Print button, which is its own client island.
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

/** The one absent-value token on the sheet. */
const DASH = "—";

const txt = (v: string | null | undefined) => (v && v.trim() ? v : DASH);

export function GosSheetDocument({ sheet }: { sheet: GosSheet }) {
  const { header } = sheet;
  const multiDestination = sheet.destinations.length > 1;

  return (
    <article className="gos-sheet mx-auto max-w-[210mm] rounded-lg p-8 shadow-elev print:max-w-none">
      <DocumentPrintStyles scope="gos" />

      {/* ---- masthead ---- */}
      <header className="gos-keep mb-4 border-b-2 border-[var(--gos-rule-strong)] pb-3">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-base font-bold tracking-tight">RAAGAM EXPORTS</p>
            <h1 className="mt-0.5 text-lg font-bold uppercase tracking-wide">
              Garment Order Sheet
            </h1>
          </div>
          <div className="text-right">
            {/*
             * THE RE NUMBER IS THE BIGGEST THING ON THE PAGE, on purpose. 500+
             * people track every piece of work by it and by nothing else, and
             * a sheet found face-down on a table has to be identifiable from
             * arm's length. It is `sales_orders.order_number`, generated in
             * the database (0395) — never rebuilt here.
             */}
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--gos-muted)]">
              RE Number
            </p>
            <p className="font-mono text-2xl font-bold leading-tight">
              {txt(header.reNumber)}
            </p>
            {header.isDraft && (
              // A DRAFT IS NOT A DIRECTIVE. Said in words rather than as a
              // watermark: a faint diagonal is the first thing a photocopier
              // loses, and this must survive being copied.
              <p className="mt-1 border border-[var(--gos-rule-strong)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
                Draft — not confirmed
              </p>
            )}
          </div>
        </div>
      </header>

      {/* ---- mandatory header data ---- */}
      <section className="gos-keep mb-4">
        <dl className="grid grid-cols-4 gap-x-4 gap-y-2 text-[11px]">
          {/*
           * S No IS THE AMENDMENT'S OWN CODE (GOA-0011), not a count of
           * anything. `mono`, because it is a serial and reads as one.
           */}
          <Fact label="S No" value={txt(header.sNo)} mono />
          <Fact label="Approved Sample No" value={txt(header.approvedSampleNo)} />
          <Fact label="Season" value={txt(header.season)} />
          <Fact label="Customer" value={txt(header.customerName)} wide />
          <Fact label="Country" value={txt(header.countryName)} />
          <Fact label="Merchandiser" value={txt(header.merchandiser)} />
          <Fact label="Order No (Customer PO)" value={txt(header.poNo)} mono />
          <Fact label="PO Date" value={fmtDate(header.poDate)} />
          <Fact label="Order Date" value={fmtDate(header.orderDate)} />
          <Fact label="Delivery Date" value={fmtDate(header.deliveryDate)} />
        </dl>
      </section>

      {/*
       * Destinations print only when the order ships to more than one. On a
       * single-destination order every column here restates the header, and a
       * restated fact is a fact somebody has to reconcile.
       */}
      {multiDestination && (
        <section className="gos-keep mb-4">
          <SectionTitle>Destinations</SectionTitle>
          <table className="text-[11px]">
            <thead>
              <tr>
                <th>Destination</th>
                <th>Customer PO</th>
                <th>Delivery</th>
                <th>Earlier shipment</th>
                <th className="gos-num">Qty</th>
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
        </section>
      )}

      {sheet.styles.map((style, i) => (
        <StyleBlock key={`${i}-${style.styleRef}`} style={style} />
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
        <section className="gos-keep mt-6 border-2 border-[var(--gos-rule-strong)] p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide">
            Quantities not shown above
          </p>
          <p className="mt-1 text-[10px] text-[var(--gos-muted)]">
            These assortment lines name a style reference this order does not declare,
            so they could not be placed under any style. Correct the order before cutting.
          </p>
          <ul className="mt-2 space-y-0.5 text-[11px]">
            {sheet.orphans.map((o, i) => (
              <li key={i}>
                <span className="font-mono">{o.ref}</span> · {o.combo} ·{" "}
                <span className="tabular-nums">{fmtNumber(o.qty)}</span> pcs
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- footer ---- */}
      <footer className="gos-keep mt-6 border-t border-[var(--gos-rule)] pt-2 text-[10px] text-[var(--gos-muted)]">
        <div className="flex justify-between gap-4">
          <span>
            Order total {fmtNumber(sheet.grandTotal)} pcs · {sheet.styles.length} style
            {sheet.styles.length === 1 ? "" : "s"}
          </span>
          <span>Printed {fmtDateTime(sheet.printedAt)}</span>
        </div>
        {/*
         * The exclusion is STATED. A construction sheet with no trims on it
         * looks incomplete to anyone who has not been told the policy — and a
         * supervisor who assumes it is incomplete goes looking for a longer
         * version of this document instead of for the right one.
         */}
        <p className="mt-1">
          Construction only. Buttons, sewing threads, labels and all other trims and
          accessories are on the Accessories Requirement Sheet.
        </p>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------

function Fact({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[9px] font-semibold uppercase tracking-widest text-[var(--gos-muted)]">
        {label}
      </dt>
      <dd className={`font-medium ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--gos-muted)]">
      {children}
    </h3>
  );
}

function StyleBlock({ style }: { style: GosStyle }) {
  return (
    <section className="gos-style mt-5">
      <div className="gos-keep mb-2 border-y border-[var(--gos-rule-strong)] py-1.5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm font-bold">
            <span className="font-mono">{txt(style.styleCode ?? style.styleRef)}</span>
            {style.styleName ? ` · ${style.styleName}` : ""}
          </p>
          <p className="text-[11px] tabular-nums">
            PO Qty <span className="font-bold">{fmtNumber(style.poQty)}</span>
          </p>
        </div>
        <dl className="mt-1.5 grid grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
          {/*
           * NO PER-STYLE "S No". The style's serial is its STL number, which is
           * the heading directly above this row — a second number beside it
           * would have been an array index nothing issued.
           */}
          <Fact label="Style Ref" value={txt(style.styleRef)} mono />
          <Fact label="Article No" value={txt(style.articleNo)} />
          <Fact label="Approved Sample No" value={txt(style.approvedSampleNo)} />
          {/*
           * PIECE VS SET, WITH THE COUNT BESIDE IT. The unit kind alone does
           * not tell the floor what to expect; "Set · 2 coordinates" does, and
           * it is what makes the warning below legible when the two disagree.
           */}
          <Fact
            label="Unit"
            value={
              style.unitKindLabel
                ? `${style.unitKindLabel} · ${style.coordinateCount} coordinate${style.coordinateCount === 1 ? "" : "s"}`
                : `${style.coordinateCount} coordinate${style.coordinateCount === 1 ? "" : "s"}`
            }
          />
          <Fact label="Description" value={txt(style.description)} wide />
        </dl>
        {style.coordinateWarning && (
          <p className="mt-1.5 border border-[var(--gos-rule-strong)] px-2 py-1 text-[10px] font-semibold">
            {style.coordinateWarning}
          </p>
        )}
      </div>

      <div className="gos-keep mb-4">
        <SectionTitle>Size-wise and colour-wise break-up</SectionTitle>
        <Matrix style={style} />
      </div>

      <div className="mb-2">
        <SectionTitle>Components</SectionTitle>
        <Components style={style} />
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
      <p className="border border-[var(--gos-rule-strong)] px-2 py-1.5 text-[11px] font-semibold">
        {style.matrix.refused}
      </p>
    );
  }
  const m = style.matrix;

  return (
    <div className="gos-scroll">
      <table className="text-[11px]">
        <thead>
          <tr>
            <th>Colour</th>
            {m.columns.map((c) => (
              <th key={c.sizeId} className="gos-num">
                {c.label}
              </th>
            ))}
            <th className="gos-num">Total</th>
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
                {r.undeclared && (
                  <span className="ml-1 text-[9px] font-normal">(not on Combos)</span>
                )}
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
      <p className="border border-[var(--gos-rule-strong)] px-2 py-1.5 text-[11px] font-semibold">
        No components are declared for this style — the Combos tab has no structure detail.
      </p>
    );
  }

  return (
    <div className="gos-scroll">
      <table className="text-[11px]">
        <thead>
          <tr>
            <th>Component</th>
            <th>Structure</th>
            <th className="gos-num">GSM</th>
            {/*
             * ONE COLUMN PER COLOURWAY, so the same physical panel reads across
             * every colour on one line. The alternative — a whole component
             * block repeated per colourway — multiplies the sheet by the colour
             * count and makes "is the sleeve the same fabric in navy?" a
             * question you answer by flipping pages.
             */}
            {style.colourways.map((c) => (
              <th key={c}>{c}</th>
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
                className="bg-[var(--gos-fill)] text-[10px] font-bold uppercase tracking-wide"
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
                {v.print && (
                  <span className="block text-[9px] text-[var(--gos-muted)]">
                    {v.print}
                  </span>
                )}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
}
