"use client";

import { useState, type ReactNode } from "react";
import { Download, Printer, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/segmented";
import { fmtDate } from "@/lib/format";
import { priceText, type QuotationModel } from "@/lib/sales/sample-costing/quotation";
import { RevisionHistory } from "@/components/sales/revision-history";
import { OrderFacts, ReportTable, SectionCard, SheetLabel, SheetMasthead, SummaryTiles, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";

/**
 * THE SAMPLE QUOTATION — the page (client 2026-10-09: "there is no proper view
 * option … fix it, not directly downloading").
 *
 * The buyer's document, readable BEFORE it is sent: the quoted price up front,
 * the sizes beside it, every piece's price in a ruled table. PRICES ONLY — the
 * rates, margin and wastage behind them are on the internal cost sheet, one tab
 * over, and never reach this page or its PDF.
 *
 * IT IS PAPER IN BOTH THEMES, as the cost sheet is: a preview of a physical
 * document, drawn with the order reports' kit (`report-kit.tsx`) so the page and
 * the PDF (`report-pdf-kit`) are one document, and only the toolbar above
 * follows the theme. Download and Print both make the PDF the buyer receives — Print opens
 * that same PDF with the print dialog up, so what is printed is what is sent.
 *
 * NO RELOAD GUARD: read-only, no form, no overlay.
 */

export function QuotationDocument({
  model,
  locked = false,
  lead,
  trail,
  quietDownload = false,
}: {
  model: QuotationModel;
  /** An UNSAVED revision is on screen: nothing may be downloaded or printed from it. */
  locked?: boolean;
  /** The page's controls share this toolbar row — see `CostSheetDocument`. */
  lead?: ReactNode;
  trail?: ReactNode;
  quietDownload?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState<"download" | "print" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ccy = model.currency;
  const multi = model.groups.length > 1;

  async function run(output: "download" | "print") {
    setBusy(output);
    setError(null);
    try {
      const mod = await import("@/lib/sales/sample-costing/quotation-export");
      await mod.exportQuotationPdf(
        {
          ...model,
          pieceName: (k: string) => model.pieceNames[k] ?? "GARMENT",
          sizeName: (s: string | null) => s ?? "All sizes",
        },
        model.company,
        output,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm print:hidden">
        {lead}
        {multi ? (
          <ToggleGroup<string>
            label="Size shown"
            value={String(idx)}
            onChange={(v) => setIdx(Number(v))}
            options={model.groups.map((x, i) => ({ value: String(i), label: `${x.label} · ${priceText(model.isSet ? x.total : (x.lines[0]?.price ?? null), ccy)}` }))}
          />
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {error ? <span className="text-sm text-danger">{error}</span> : null}
          {locked ? (
            null
          ) : model.blocked ? null : (
            // A blocked quotation says why in the amber notice below, so no dead buttons here.
            <>
              <Button variant="outline" size="md" disabled={busy != null} onClick={() => void run("print")}>
                <Printer className="h-4 w-4" />
                {busy === "print" ? "Opening…" : "Print"}
              </Button>
              <Button variant={quietDownload ? "outline" : undefined} size="md" disabled={busy != null} onClick={() => void run("download")}>
                <Download className="h-4 w-4" />
                {busy === "download" ? "Building…" : "Download PDF"}
              </Button>
            </>
          )}
          {trail}
        </div>
      </div>

      {model.blocked ? (
        <p className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm" style={{ background: "color-mix(in oklab, var(--warning) 12%, transparent)" }}>
          <ShieldAlert className="mt-0.5 size-4 shrink-0" style={{ color: "var(--warning)" }} aria-hidden />
          {model.blocked} You can read it here; it cannot be downloaded or printed until then.
        </p>
      ) : null}

      {/* THE KIT'S SHEET (report-kit.tsx — every order report's look, and the
          screen twin of report-pdf-kit, which the PDF already draws with). Same
          blocks in the same order as `exportQuotationPdf`: masthead, the facts,
          the price tiles, Price by piece / size, Revision history, the terms. */}
      <article className="mx-auto w-full max-w-[880px] space-y-3">
        <div>
          <SheetMasthead
            company={model.company}
            kind="Price Quotation"
            reNo={[model.costingNo, model.revision].filter(Boolean).join(" · ") || "—"}
            // "Dated …" and, when approved, when — the buyer sees THAT it is approved, never how.
            meta={[model.date ? `Dated ${fmtDate(model.date)}` : null, model.approvalNote].filter(Boolean).join(" · ") || null}
            status={model.approved ? "Approved" : null}
          />
          <OrderFacts
            thumbnail={<Thumb url={model.thumbUrl} />}
            facts={[
              { label: "Customer", value: model.customer },
              { label: "SMP Number", value: model.sampleNo, mono: true },
              { label: "Style", value: model.style },
              { label: "Description", value: model.description },
              { label: "Season", value: model.season },
              { label: "Currency", value: ccy },
              { label: "Shipment", value: model.shipMode },
              { label: "Quoted per", value: `${model.isSet ? "SET" : "PIECE"}${multi ? ` · ${model.groups.length} sizes` : ""}` },
            ]}
          />
        </div>

        <div>
          <SheetLabel>{model.isSet ? "Set price" : "Price"}</SheetLabel>
          <SummaryTiles
            tiles={model.groups.map((x) => ({
              label: multi ? x.label : model.isSet ? "Quoted set price" : "Quoted price",
              value: priceText(model.isSet ? x.total : (x.lines[0]?.price ?? null), ccy),
              unit: `per ${model.unitWord}`,
              note: ccy ? `All prices in ${ccy}` : "Currency not set",
            }))}
          />
        </div>

        <SectionCard title={model.isSet ? "Price by piece" : "Price by size"}>
          <ReportTable bare>
            <thead>
              <tr>
                <Th>Piece</Th>
                <Th>Size</Th>
                <Th right>Price ({ccy ?? "—"})</Th>
              </tr>
            </thead>
            <tbody>
              {model.groups.map((grp, gi) => (
                <GroupRows key={grp.label} grp={grp} band={gi} isSet={model.isSet} ccy={ccy} lit={multi && gi === idx} onPick={multi ? () => setIdx(gi) : undefined} />
              ))}
            </tbody>
          </ReportTable>
        </SectionCard>

        {/* WHERE THIS QUOTATION STANDS IN THE NEGOTIATION — prices only; the
            margin is stripped from the model, so it cannot reach this table. */}
        <RevisionHistory rows={model.history} currency={ccy} hrefFor={(id) => `/sales/sample-costing/${id}/reports?tab=quotation`} />

        <p className="m-0 rounded-lg border border-border bg-white px-5 py-3 text-[11.5px] leading-relaxed text-[#5b6472]">
          Prices are per {model.unitWord} unless stated, valid for the quantities and specification of this sample, subject to final order confirmation.
        </p>
      </article>
    </div>
  );
}

/** The style picture beside the facts, or the garment outline when there is none. */
function Thumb({ url }: { url: string | null }) {
  return (
    <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-[#f6f7f9] text-[#9aa3af]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <svg viewBox="0 0 64 64" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
          <path d="M22 8l-14 8 6 12 6-3v31h24V25l6 3 6-12-14-8c-2 5-6 7-10 7s-8-2-10-7z" />
        </svg>
      )}
    </div>
  );
}

/** One size's rows; the size the switch shows is lit, and a click on any row picks it. */
function GroupRows({ grp, band, isSet, ccy, lit, onPick }: { grp: QuotationModel["groups"][number]; band: number; isSet: boolean; ccy: string | null; lit: boolean; onPick?: () => void }) {
  const style = lit ? { background: "#eaf7fd" } : stripeRow(band);
  return (
    <>
      {grp.lines.map((l, i) => (
        <tr key={`${l.piece}-${i}`} style={{ ...style, cursor: onPick ? "pointer" : undefined }} onClick={onPick}>
          <Td>{l.piece}</Td>
          <Td>{grp.label}</Td>
          <Td right mono>{priceText(l.price, ccy)}</Td>
        </tr>
      ))}
      {isSet ? (
        <tr className="font-semibold" style={totalRowStyle()}>
          <Td colSpan={2}>Set total · {grp.label}</Td>
          <Td right mono>{priceText(grp.total, ccy)}</Td>
        </tr>
      ) : null}
    </>
  );
}
