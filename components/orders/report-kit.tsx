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
export function ReportTable({ children, fixed }: { children: React.ReactNode; fixed?: boolean }) {
  return (
    <div className="overflow-x-auto border-x border-b border-border bg-white">
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

