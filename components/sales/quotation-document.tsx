"use client";

import { useState, type ReactNode } from "react";
import { Download, Printer, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/segmented";
import { fmtDate } from "@/lib/format";
import { priceText, type QuotationModel } from "@/lib/sales/sample-costing/quotation";
import { ReportTable, SectionCard, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm print:hidden">
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

      {/* THE SHEET: the Option B letterhead (below, `QuoteLetterhead`) over the kit's
          sections (report-kit.tsx) — Price by piece / size, Revision history, the
          terms. The PDF (`exportQuotationPdf`, report-pdf-kit) still draws the kit's
          own masthead, facts and price tiles: the same facts and price, in its layout. */}
      <article className="mx-auto w-full max-w-[880px] space-y-3">
        {/* OPTION B, AS ON THE COST SHEET (user 2026-10-16: "Option B is okay", then
            "next this quotation ui screen"). The kit's masthead, the facts grid and the
            PRICE tiles become one letterhead: the brand stripe, the company, the document
            and its status, the style as the title, and ONE blue card holding the price.
            The card is the BUYER'S price only — no margin, rupees or rate, which stay on
            the internal sheet. The PDF is still drawn by `exportQuotationPdf`. */}
        <QuoteLetterhead model={model} idx={idx} />

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

        {/* NO REVISION HISTORY ON THE QUOTATION (user 2026-10-16: "no need to Revision
            history, remove it from quotation report"). The buyer's document states the
            price in force; the trail of earlier prices stays on the internal Cost Sheet's
            Revisions tab. */}
        <p className="m-0 rounded-lg border border-border bg-white px-5 py-3 text-[11.5px] leading-relaxed text-[#5b6472]">
          Prices are per {model.unitWord} unless stated, valid for the quantities and specification of this sample, subject to final order confirmation.
        </p>
      </article>
    </div>
  );
}

/**
 * The Option B letterhead (see the cost sheet's `.lh`): stripe, company, document,
 * title, price card, then the facts band with the style picture. With several
 * sizes the card shows the size the toolbar switch has picked (`idx`).
 */
function QuoteLetterhead({ model, idx }: { model: QuotationModel; idx: number }) {
  const ccy = model.currency;
  const multi = model.groups.length > 1;
  const grp = model.groups[idx] ?? model.groups[0];
  const price = grp ? (model.isSet ? grp.total : (grp.lines[0]?.price ?? null)) : null;
  const facts: { label: string; value: ReactNode; mono?: boolean }[] = [
    { label: "SMP Number", value: model.sampleNo, mono: true },
    { label: "Style", value: model.style },
    { label: "Season", value: model.season },
    { label: "Shipment", value: model.shipMode },
    { label: "Quoted per", value: `${model.isSet ? "SET" : "PIECE"}${multi ? ` · ${model.groups.length} sizes` : ""}` },
    { label: "Dated", value: model.date ? fmtDate(model.date) : null },
  ];
  return (
    <header className="overflow-hidden rounded-lg border border-border bg-white text-[#0f1b26]">
      <div className="flex h-[5px]" aria-hidden>
        <span className="flex-1 bg-[#d98e04]" />
        <span className="flex-1 bg-[#6b7480]" />
        <span className="flex-1 bg-[#037bb8]" />
        <span className="flex-1 bg-[#85c227]" />
      </div>
      <div className="grid gap-4 border-b-2 border-[#0f1b26] px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2.5">
            {model.company.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={model.company.logo} alt="" className="h-10 w-auto shrink-0 object-contain" />
            ) : (
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-[#037bb8] text-[19px] font-extrabold text-white">
                {(model.company.name ?? "R").trim().charAt(0)}
              </span>
            )}
            <div className="min-w-0">
              <div className="text-[16px] font-extrabold uppercase tracking-[.01em]">{model.company.name ?? "Raagam Exports"}</div>
              {model.company.unit ? (
                <div className="text-[11.5px] uppercase tracking-[.06em] text-[#5a6a79]">{model.company.unit}</div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[11.5px] font-bold uppercase tracking-[.16em] text-[#037bb8]">Price Quotation</span>
            <span className="font-mono text-[16px] font-semibold">
              {[model.costingNo, model.revision].filter(Boolean).join(" · ") || "—"}
            </span>
            {model.approved ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e3f4ea] px-2.5 py-0.5 text-[11.5px] font-bold text-[#14803f]">
                <span className="size-1.5 rounded-full bg-[#14803f]" />
                Approved
              </span>
            ) : null}
          </div>
          <h2 className="m-0 text-[19px] font-extrabold leading-tight tracking-[-.01em]">
            {model.description || model.style || "—"}
            {model.customer ? <span className="text-[15px] font-semibold text-[#5a6a79]"> · {model.customer}</span> : null}
          </h2>
          {/* The buyer sees THAT it is approved and when, never how. */}
          {model.approvalNote ? <p className="m-0 text-[12px] text-[#5a6a79]">{model.approvalNote}</p> : null}
        </div>
        <div className="flex min-w-[200px] flex-col justify-center gap-1 rounded-xl bg-[linear-gradient(160deg,#037bb8,#024f78)] px-4 py-3 text-white">
          <span className="text-[10.5px] font-bold uppercase tracking-[.14em] text-[#bfe0f2]">
            {model.isSet ? "Quoted set price" : "Quoted price"}
            {multi && grp ? ` · ${grp.label}` : ""}
          </span>
          <span className="font-mono text-[26px] font-bold leading-tight">{priceText(price, ccy)}</span>
          <span className="text-[12px] text-[#d8ecf7]">per {model.unitWord}</span>
          <span className="text-[12px] text-[#d8ecf7]">{ccy ? `All prices in ${ccy}` : "Currency not set"}</span>
        </div>
      </div>
      <div className="flex items-start gap-4 bg-[#f5f8fb] px-5 py-3">
        <Thumb url={model.thumbUrl} />
        <dl className="m-0 grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-3">
          {facts.map((f) =>
            f.value ? (
              <div key={f.label} className="min-w-0">
                <dt className="text-[10.5px] font-bold uppercase tracking-[.09em] text-[#5a6a79]">{f.label}</dt>
                <dd className={`m-0 break-words text-[13.5px] font-semibold ${f.mono ? "font-mono font-medium" : ""}`}>{f.value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      </div>
    </header>
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
