/**
 * THE ORDER REPORTS' ONE SCREEN LOOK (user 2026-09-29: "another reports also
 * need to look like yarn fabric requirement like looking") — the screen twin of
 * `lib/orders/report-pdf-kit.ts`.
 *
 * These were private to `fabric-bom-reports-sheet.tsx`, where only the Yarn &
 * Fabric Requirement could use them, so every other report grew its own grey
 * tables. Moved here UNCHANGED (plus `SectionBar`, the ledger's filled section
 * bar, lifted out of that report's inline markup) so every report draws with
 * one set.
 *
 * A section: `SectionBar` (filled, in the section's tone — a stage's, or
 * `BRAND` for anything that is not about a stage) over a `ReportTable` of `Th`
 * / `Td`, rows striped with `stripeRow(i)`, totals tinted with `totalRowStyle`.
 *
 * NOT "use client", ON PURPOSE: nothing here holds state, and several reports
 * (Accessories, GOS, Budget …) render as SERVER components. Under "use client"
 * the plain helpers (`stripeRow`, `totalRowStyle`) reach a server component as
 * client references and cannot be called — a runtime failure no type-check
 * sees. Imported by a client component, this module simply runs on the client.
 */

import { Fragment } from "react";
import { swatchFor, STAGE_STYLES, type StageStyle } from "@/lib/orders/fabric-bom/report-colours";
import { BRAND } from "@/lib/orders/report-pdf-kit";

export { BRAND, STAGE_STYLES, type StageStyle };

/**
 * THE FILLED SECTION BAR — the Process Stage Ledger's own section heading: the
 * tone's tint, its rule across the top, the tag (when the tone has a label) and
 * the title in its ink, and `right` — the section's headline figure — at the
 * right. `first` drops the top border where it sits directly under another box.
 */
export function SectionBar({
  tone = BRAND,
  title,
  right,
  first,
}: {
  tone?: StageStyle;
  title: React.ReactNode;
  right?: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={`flex w-full items-center justify-between gap-3 border-x border-border px-4 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide ${first ? "" : "border-t"}`}
      style={{ background: tone.tint, color: tone.ink, borderTop: `2px solid ${tone.rule}` }}
    >
      <span className="flex items-center gap-2">
        {tone.label ? <StageTag tone={tone} /> : null}
        {title}
      </span>
      {right != null && right !== "" ? (
        <span className="font-mono text-[11px] normal-case tracking-normal">{right}</span>
      ) : null}
    </div>
  );
}

/** The alternate body row — `style={stripeRow(i)}` on a `<tr>`. */
export const ROW_STRIPE_BG = "#fafbfc";
export function stripeRow(i: number): React.CSSProperties {
  return { background: i % 2 === 1 ? ROW_STRIPE_BG : "#ffffff" };
}

/** A total row in the section's tone — `style={totalRowStyle(tone)}` plus
 *  `className="font-semibold"` on the `<tr>`. */
export function totalRowStyle(tone: StageStyle = BRAND): React.CSSProperties {
  return { background: tone.tint, color: tone.ink };
}

export function SectionHeader({ children, tone }: { children: React.ReactNode; tone?: StageStyle }) {
  if (tone) {
    /* A STAGE-TONED HEADING (2026-09-20) — the stage's tag and a rule in its
       colour, the same heading the PDF draws. */
    return (
      <div
        className="flex items-center gap-2 border-x border-t border-border bg-white px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-[.1em] text-[#16181d]"
        style={{ borderTop: `3px solid ${tone.rule}` }}
      >
        <StageTag tone={tone} />
        {children}
      </div>
    );
  }
  return (
    <div className="border-x border-t border-border bg-[#eaf7fd] px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-[.1em] text-[#037bb8]">
      {children}
    </div>
  );
}

/** A stage's tag — pale fill, strong border, dark ink (./report-colours.ts). */
export function StageTag({ tone }: { tone: StageStyle }) {
  return (
    <span
      className="inline-block rounded-[3px] border px-1.5 py-px text-[10.5px] font-bold tracking-wide"
      style={{ background: tone.tint, borderColor: tone.rule, color: tone.ink }}
    >
      {tone.label}
    </span>
  );
}

/** The garment colour beside its name — nothing for a name with no known
 *  colour, never a guessed one (`swatchFor`). */
export function Swatch({ name }: { name: string | null | undefined }) {
  const hex = swatchFor(name);
  if (!hex) return null;
  return (
    <span
      aria-hidden
      className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] border border-[#6b7480] align-[-1px]"
      style={{ background: hex }}
    />
  );
}

/** What the stage colours mean — once, under the order facts. */
export function StageKey() {
  const entries: [StageStyle, string][] = [
    [STAGE_STYLES.yarn, "yarn to buy"],
    [STAGE_STYLES.greige, "one lot per fabric"],
    [STAGE_STYLES.dyed, "per colourway"],
    [STAGE_STYLES.print, "printed colourways only"],
    [STAGE_STYLES.cutting, "to the cutting table"],
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border border-t-0 border-border bg-white px-5 py-2 text-[11.5px] text-[#5b6472]">
      <span className="font-bold tracking-wide text-[#16181d]">KEY</span>
      {entries.map(([tone, text]) => (
        <span key={tone.label} className="flex items-center gap-1.5">
          <StageTag tone={tone} />
          {text}
        </span>
      ))}
    </div>
  );
}

/** The bordered table shell every section uses — one border language, so a
 *  table never reads as a different document from the letterhead above it.
 *  `fixed` opts a table into `table-fixed` + explicit `<colgroup>` widths
 *  (via `EntryRegisterGridCols` below) instead of the default auto-sized
 *  `min-w-max` — the Entry Register grid's own long Fabric description was
 *  otherwise stretching every numeric column, including every subtotal and
 *  the Grand Total row, off the right edge of the Sheet (client screenshot
 *  2847, 2026-09-11: "not that much a professional report look"). Every
 *  other table using this shell keeps its old auto-sized behaviour. */
export function ReportTable({
  children,
  fixed,
  bare,
}: {
  children: React.ReactNode;
  fixed?: boolean;
  /** Inside a `SectionCard`, whose own border frames it (2026-09-29). */
  bare?: boolean;
}) {
  return (
    <div className={`overflow-x-auto bg-white ${bare ? "" : "border-x border-b border-border"}`}>
      {/* NO SIDEWAYS SCROLLING (client 2026-09-20). The auto-sized tables used
          to carry `min-w-max` — "as wide as every cell on one line" — so one
          long fabric description pushed Loss % and To Ordered off the right
          edge. Now they take the pane's width and TEXT WRAPS inside its cell;
          figures never wrap (`Td` right/mono is `whitespace-nowrap`). The
          `overflow-x-auto` above stays only as a fallback for a phone-width
          window, where no table of these columns can fit. */}
      <table className={`w-full border-collapse text-[12px] ${fixed ? "table-fixed" : ""}`}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  right,
  center,
  colSpan,
  rowSpan,
}: {
  children: React.ReactNode;
  right?: boolean;
  /** A group heading over its sub-columns ("Planned" over Nos/Mtrs · Wt). */
  center?: boolean;
  colSpan?: number;
  rowSpan?: number;
}) {
  return (
    <th
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={`border-b border-border bg-[#f6f7f9] px-2 py-1 align-bottom font-semibold text-[#5b6472] ${center ? "text-center" : right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  right,
  mono,
  className = "",
  colSpan,
  wrap,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  className?: string;
  colSpan?: number;
  /** Let a right/mono cell wrap after all — for the one that can hold a
   *  sentence (a refused yarn's reason) instead of a figure. */
  wrap?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      /* A FIGURE NEVER WRAPS — right-aligned or mono cells are numbers, codes
         and dates; only text (a fabric's description) breaks onto a second
         line to keep the table inside the pane. */
      className={`border-b border-border/60 px-2 py-1 ${right ? "text-right" : "text-left"} ${mono ? "font-mono" : ""} ${(right || mono) && !wrap ? "whitespace-nowrap" : ""} ${className}`}
    >
      {children}
    </td>
  );
}


export const STAGE_BADGE_TONE: Record<string, string> = {
  /* The report palette's Greige and Dyed (2026-09-20), so a badge and the
     section it sits beside speak one colour. */
  GREY: "bg-[#eceff3] text-[#37404a]",
  GREIGE: "bg-[#eceff3] text-[#37404a]",
  RFD: "bg-[#fde8cc] text-[#8a5a15]",
  DYED: "bg-[#e1eff9] text-[#024f78]",
  WASH: "bg-[#dff3f0] text-[#0b5a52]",
  PRINT: "bg-[#eaf5dc] text-[#3d6410]",
};


export function StageBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STAGE_BADGE_TONE[state] ?? "bg-[#e4e6ea] text-[#4a5261]"}`}
    >
      {state}
    </span>
  );
}


/* ===========================================================================
 * THE SHEET FORMAT (user 2026-09-29: "this is okay apply it" — the approved
 * mockups "Raagam Requirement Sheet" and "Raagam Budget Statement"). The client
 * asked for "our style", not the RP printout copied line for line, with every
 * figure kept. A sheet reads top to bottom:
 *
 *   SheetMasthead   company · document kind · the RE No large · status
 *   OrderFacts      picture + the order's facts as a grid of label/value
 *   QtyEquation     Order + Excess + Approval + Rej.Allow = Cut, drawn as the sum it is
 *   SummaryTiles    the few figures the reader came for (what to buy / the result)
 *   RouteStrip      the order's stages in sequence (requirement sheets)
 *   SectionCard     each section: tone header (tag, title, total) + its table
 *   SignOff
 *
 * The PDF draws the same blocks (`lib/orders/report-pdf-kit.ts`), so the page
 * and the printout are one document.
 * ========================================================================= */

/** A small uppercase caption over a block ("QUANTITY TO CUT"). */
export function SheetLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#4a5563]">{children}</p>;
}

export function SheetMasthead({
  company,
  kind,
  reNo,
  meta,
  status,
}: {
  company: { name: string | null; unit?: string | null; logo?: string | null };
  kind: string;
  reNo: string | null;
  meta?: React.ReactNode;
  /** A green pill ("Approved"); omit for none. */
  status?: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-t-md border border-b-0 border-border bg-white">
      <div className="flex h-[5px]" aria-hidden>
        <div className="flex-1 bg-[#d98e04]" />
        <div className="flex-1 bg-[#6b7480]" />
        <div className="flex-1 bg-[#037bb8]" />
        <div className="flex-1 bg-[#85c227]" />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#17202b] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {company.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logo} alt={company.name ?? "Company logo"} className="h-11 w-auto shrink-0 object-contain" />
          ) : (
            <span
              aria-hidden
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#037bb8] text-[20px] font-extrabold text-white"
            >
              {(company.name ?? "R").trim().charAt(0)}
              <span className="absolute -bottom-[3px] -right-[3px] h-3 w-3 rounded-[3px] border-2 border-white bg-[#85c227]" />
            </span>
          )}
          <div className="min-w-0">
            <div className="text-[19px] font-extrabold uppercase leading-tight tracking-[.01em] text-[#17202b]">
              {company.name ?? "RAAGAM EXPORTS"}
            </div>
            {company.unit && (
              <div className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-[#7b8594]">{company.unit}</div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] font-bold uppercase tracking-[.16em] text-[#037bb8]">{kind}</div>
          {reNo && <div className="font-mono text-[21px] font-semibold text-[#17202b]">{reNo}</div>}
          {(meta || status) && (
            <div className="mt-0.5 flex flex-wrap items-center justify-end gap-2 text-[11.5px] text-[#7b8594]">
              {meta}
              {status && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef7df] px-2 py-0.5 text-[11px] font-semibold text-[#3f6a0d]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#85c227]" />
                  {status}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type SheetFact = { label: string; value: React.ReactNode; sub?: React.ReactNode; mono?: boolean };

/** The order's facts as a grid, the style picture at its left when there is one. */
export function OrderFacts({ facts, thumbnail }: { facts: readonly SheetFact[]; thumbnail?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border border-t-0 border-border bg-white px-5 py-4">
      {thumbnail}
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-[#7b8594]">{f.label}</div>
            <div className={`mt-px break-words text-[13.5px] font-semibold text-[#17202b] ${f.mono ? "font-mono font-medium" : ""}`}>
              {f.value || "—"}
            </div>
            {f.sub && <div className="text-[11.5px] text-[#7b8594]">{f.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export type QtyTerm = { label: string; value: React.ReactNode; note?: React.ReactNode };

/** Order + Excess + Approval + Rej.Allow = Cut — the quantity block as the sum it is. */
export function QtyEquation({ terms, result }: { terms: readonly QtyTerm[]; result: QtyTerm }) {
  const op = (sign: string) => (
    <span aria-hidden className="hidden w-6 place-items-center border-x border-[#eef1f4] bg-[#f7f9fb] font-mono text-[#7b8594] sm:grid">
      {sign}
    </span>
  );
  return (
    <div className="flex flex-wrap overflow-hidden rounded-lg border border-border bg-white">
      {terms.map((t, i) => (
        <Fragment key={t.label}>
          {i > 0 && op("+")}
          <div className="grid min-w-[96px] flex-1 gap-px px-3.5 py-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-[#7b8594]">{t.label}</span>
            <span className="font-mono text-[17px] font-semibold tabular-nums text-[#17202b]">{t.value}</span>
            {t.note && <span className="font-mono text-[11px] text-[#7b8594]">{t.note}</span>}
          </div>
        </Fragment>
      ))}
      {op("=")}
      <div className="grid min-w-[96px] flex-1 gap-px bg-[#037bb8] px-3.5 py-2.5 text-white">
        <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-[#cfe6f4]">{result.label}</span>
        <span className="font-mono text-[17px] font-semibold tabular-nums">{result.value}</span>
        {result.note && <span className="font-mono text-[11px] text-[#cfe6f4]">{result.note}</span>}
      </div>
    </div>
  );
}

export type SummaryTile = { label: string; value: React.ReactNode; unit?: string; note?: React.ReactNode; tone?: StageStyle };

/** The figures the reader came for, first — a row of tiles, each ruled in its tone. */
export function SummaryTiles({ tiles }: { tiles: readonly SummaryTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="grid gap-0.5 rounded-md border border-border bg-white px-3 py-2.5"
          style={{ borderTop: `3px solid ${(t.tone ?? BRAND).rule}` }}
        >
          <span className="text-[11px] font-semibold text-[#4a5563]">{t.label}</span>
          <span className="font-mono text-[18px] font-semibold tabular-nums text-[#17202b]">
            {t.value}
            {t.unit && <small className="ml-1 text-[11px] font-medium text-[#7b8594]">{t.unit}</small>}
          </span>
          {t.note && <span className="text-[11px] text-[#7b8594]">{t.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** The order's stages, in sequence — each numbered chip in its stage tone. */
export function RouteStrip({ steps }: { steps: readonly { label: string; tone: StageStyle }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => (
        <Fragment key={`${s.label}-${i}`}>
          {i > 0 && (
            <span aria-hidden className="text-[12px] text-[#7b8594]">
              →
            </span>
          )}
          <span
            className="inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[11.5px] font-semibold"
            style={{ background: s.tone.tint, color: s.tone.ink }}
          >
            <i
              className="grid h-[18px] w-[18px] place-items-center rounded-full font-mono text-[10px] not-italic text-white"
              style={{ background: s.tone.rule }}
            >
              {i + 1}
            </i>
            {s.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A SECTION AS A CARD — the tone's header (tag when the tone has one, title,
 * the section's headline figure at the right), an optional note line, then the
 * section's own table as `children`.
 */
export function SectionCard({
  tone = BRAND,
  title,
  total,
  totalLabel,
  note,
  children,
}: {
  tone?: StageStyle;
  title: React.ReactNode;
  total?: React.ReactNode;
  totalLabel?: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white">
      <div
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3.5 py-2.5"
        style={{ background: tone.tint, color: tone.ink }}
      >
        <h3 className="m-0 flex items-center gap-2 text-[14px] font-bold tracking-[.02em]">
          {tone.label ? (
            <span
              className="rounded border bg-white px-1.5 py-px text-[10px] font-bold tracking-[.1em]"
              style={{ borderColor: tone.rule, color: tone.ink }}
            >
              {tone.label}
            </span>
          ) : null}
          {title}
        </h3>
        {total != null && total !== "" && (
          <span className="font-mono text-[13px] font-semibold tabular-nums">
            {totalLabel && <small className="mr-1.5 font-sans text-[11px] font-medium opacity-80">{totalLabel}</small>}
            {total}
          </span>
        )}
      </div>
      {note && <div className="border-b border-[#eef1f4] bg-white px-3.5 py-2 text-[11.5px] text-[#4a5563]">{note}</div>}
      {children}
    </section>
  );
}

/** Prepared / Checked / Approved, each over a rule. */
export function SignOff({ names }: { names?: { prepared?: string | null; checked?: string | null; approved?: string | null } }) {
  const cells: [string, string | null | undefined][] = [
    ["Prepared By", names?.prepared],
    ["Checked By", names?.checked],
    ["Approved By", names?.approved],
  ];
  return (
    <div className="mt-8 grid grid-cols-3 gap-7">
      {cells.map(([label, name]) => (
        <div key={label} className="border-t border-[#17202b] pt-1.5 text-[12px] font-semibold text-[#17202b]">
          {label}
          <span className="block text-[11.5px] font-normal text-[#7b8594]">{name || " "}</span>
        </div>
      ))}
    </div>
  );
}
