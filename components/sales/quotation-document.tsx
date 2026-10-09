"use client";

import { useState } from "react";
import { Download, Printer, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/segmented";
import { fmtDate } from "@/lib/format";
import { priceText, type QuotationModel } from "@/lib/sales/sample-costing/quotation";
import { RevisionHistory } from "@/components/sales/revision-history";

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
 * document, so its palette is fixed and only the toolbar above follows the
 * theme. Download and Print both make the PDF the buyer receives — Print opens
 * that same PDF with the print dialog up, so what is printed is what is sent.
 *
 * NO RELOAD GUARD: read-only, no form, no overlay.
 */

const INK = "#17202b";
const MUTED = "#5b6472";
const BLUE = "#037bb8";
const RULE = "#e3e7ec";

export function QuotationDocument({ model }: { model: QuotationModel }) {
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState<"download" | "print" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const g = model.groups[idx] ?? model.groups[0];
  const ccy = model.currency;
  // The headline: a set's price, or the one piece's.
  const headline = g ? (model.isSet ? g.total : (g.lines[0]?.price ?? null)) : null;
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

  const facts: [string, string | null][] = [
    ["Customer", model.customer],
    ["Enquiry No", model.enquiryNo],
    ["Sample No", model.sampleNo],
    ["Season", model.season],
    ["Currency", ccy],
    ["Shipment", model.shipMode],
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {multi ? (
          <ToggleGroup<string>
            label="Size shown"
            value={String(idx)}
            onChange={(v) => setIdx(Number(v))}
            options={model.groups.map((x, i) => ({ value: String(i), label: `${x.label} · ${priceText(model.isSet ? x.total : (x.lines[0]?.price ?? null), ccy)}` }))}
          />
        ) : null}
        <Button variant="outline" size="md" disabled={busy != null || !!model.blocked} onClick={() => void run("print")} title={model.blocked ?? undefined}>
          <Printer className="h-4 w-4" />
          {busy === "print" ? "Opening…" : "Print"}
        </Button>
        <Button size="md" disabled={busy != null || !!model.blocked} onClick={() => void run("download")} title={model.blocked ?? undefined}>
          <Download className="h-4 w-4" />
          {busy === "download" ? "Building…" : "Download PDF"}
        </Button>
        {error ? <span className="text-sm text-danger">{error}</span> : null}
      </div>

      {model.blocked ? (
        <p className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm" style={{ background: "color-mix(in oklab, var(--warning) 12%, transparent)" }}>
          <ShieldAlert className="mt-0.5 size-4 shrink-0" style={{ color: "var(--warning)" }} aria-hidden />
          {model.blocked} You can read it here; it cannot be downloaded or printed until then.
        </p>
      ) : null}

      <article className="mx-auto w-full max-w-[880px] overflow-hidden rounded-lg border bg-white shadow-sm" style={{ color: INK, borderColor: RULE }}>
        <div className="flex h-[5px]" aria-hidden>
          <div className="flex-1" style={{ background: "#d98e04" }} />
          <div className="flex-1" style={{ background: "#6b7480" }} />
          <div className="flex-1" style={{ background: BLUE }} />
          <div className="flex-1" style={{ background: "#85c227" }} />
        </div>

        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 px-7 py-5" style={{ borderColor: INK }}>
          <div className="flex min-w-0 items-center gap-3">
            {model.company.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={model.company.logo} alt="" className="h-11 w-auto shrink-0 object-contain" />
            ) : (
              <span aria-hidden className="relative grid size-11 shrink-0 place-items-center rounded-lg text-[20px] font-extrabold text-white" style={{ background: BLUE }}>
                {(model.company.name ?? "R").trim().charAt(0)}
                <span className="absolute -bottom-[3px] -right-[3px] size-3 rounded-[3px] border-2 border-white" style={{ background: "#85c227" }} />
              </span>
            )}
            <div className="min-w-0">
              <div className="text-[19px] font-extrabold uppercase leading-tight tracking-[.01em]">{model.company.name ?? "Raagam Exports"}</div>
              {model.company.unit ? <div className="text-[11.5px] font-semibold uppercase tracking-[.06em]" style={{ color: MUTED }}>{model.company.unit}</div> : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] font-bold uppercase tracking-[.16em]" style={{ color: BLUE }}>Price Quotation</div>
            <div className="font-mono text-[21px] font-semibold">{[model.costingNo, model.revision].filter(Boolean).join(" · ") || "—"}</div>
            <div className="mt-0.5 flex flex-wrap items-center justify-end gap-2 text-[11.5px]" style={{ color: MUTED }}>
              {model.date ? <span>Dated {fmtDate(model.date)}</span> : null}
              {model.approved ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#eef7df", color: "#3f6a0d" }}>
                  <span className="size-1.5 rounded-full" style={{ background: "#85c227" }} />
                  Approved
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <section className="grid gap-5 px-7 py-6 md:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 items-start gap-4">
            <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border" style={{ borderColor: RULE, background: "#f6f7f9", color: "#9aa3af" }}>
              {model.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={model.thumbUrl} alt="" className="size-full object-cover" />
              ) : (
                <svg viewBox="0 0 64 64" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" aria-hidden>
                  <path d="M22 8l-14 8 6 12 6-3v31h24V25l6 3 6-12-14-8c-2 5-6 7-10 7s-8-2-10-7z" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: MUTED }}>Style{model.season ? ` · ${model.season}` : ""}</div>
              <h2 className="m-0 text-[24px] font-extrabold leading-tight tracking-tight">{model.style ?? "—"}</h2>
              {model.description ? <p className="m-0 mt-0.5 text-[13px]" style={{ color: MUTED }}>{model.description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
                {model.sampleNo ? <Chip>Sample <b>{model.sampleNo}</b></Chip> : null}
                <Chip>{model.isSet ? "SET" : "PIECE"}{multi ? <> · <b>{model.groups.length}</b> sizes</> : null}</Chip>
                {model.shipMode ? <Chip>Ship <b>{model.shipMode}</b></Chip> : null}
              </div>
            </div>
          </div>

          <div className="rounded-xl px-6 py-4 text-right md:min-w-[250px]" style={{ background: "#eaf7fd", borderTop: `3px solid ${BLUE}` }}>
            <div className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "#024f78" }}>
              Quoted price per {model.unitWord}{multi && g ? ` · ${g.label}` : ""}
            </div>
            <div className="font-mono text-[34px] font-bold leading-tight tabular-nums" style={{ color: "#024f78" }}>
              {priceText(headline, ccy)}
            </div>
            <div className="text-[11.5px]" style={{ color: MUTED }}>{ccy ? `All prices in ${ccy}` : "Currency not set"}</div>
          </div>
        </section>

        <section className="px-7 pb-6">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: MUTED }}>
            {model.isSet ? "Price by piece" : "Price by size"}
          </div>
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: RULE }}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr style={{ background: "#f6f7f9", color: MUTED }}>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Piece</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Size</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Price ({ccy ?? "—"})</th>
                </tr>
              </thead>
              <tbody>
                {model.groups.map((grp, gi) => (
                  <GroupRows key={grp.label} grp={grp} band={gi % 2 === 1} isSet={model.isSet} ccy={ccy} lit={multi && gi === idx} onPick={multi ? () => setIdx(gi) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* WHERE THIS QUOTATION STANDS IN THE NEGOTIATION — prices only; the
            margin is stripped from the model, so it cannot reach this table. */}
        <RevisionHistory rows={model.history} currency={ccy} />

        <section className="grid grid-cols-2 gap-x-6 gap-y-3 border-t px-7 py-5 md:grid-cols-3" style={{ borderColor: RULE }}>
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <div className="text-[10.5px] font-bold uppercase tracking-[.14em]" style={{ color: MUTED }}>{k}</div>
              <div className="truncate text-[13px] font-medium" title={v ?? undefined}>{v ?? "—"}</div>
            </div>
          ))}
        </section>

        <footer className="border-t px-7 py-4 text-[11.5px] leading-relaxed" style={{ borderColor: RULE, color: MUTED, background: "#fafbfc" }}>
          Prices are per {model.unitWord} unless stated, valid for the quantities and specification of this sample, subject to final order confirmation.
        </footer>
      </article>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5" style={{ borderColor: RULE, background: "#f6f7f9" }}>
      {children}
    </span>
  );
}

function GroupRows({ grp, band, isSet, ccy, lit, onPick }: { grp: QuotationModel["groups"][number]; band: boolean; isSet: boolean; ccy: string | null; lit: boolean; onPick?: () => void }) {
  const bg = lit ? "#eaf7fd" : band ? "#fafbfc" : "#ffffff";
  return (
    <>
      {grp.lines.map((l, i) => (
        <tr key={`${l.piece}-${i}`} style={{ background: bg, cursor: onPick ? "pointer" : undefined }} onClick={onPick}>
          <td className="border-t px-3 py-2" style={{ borderColor: RULE }}>{l.piece}</td>
          <td className="border-t px-3 py-2" style={{ borderColor: RULE }}>{grp.label}</td>
          <td className="border-t px-3 py-2 text-right font-mono tabular-nums" style={{ borderColor: RULE }}>{priceText(l.price, ccy)}</td>
        </tr>
      ))}
      {isSet ? (
        <tr style={{ background: "#eef1f4" }}>
          <td className="border-t px-3 py-2 font-bold" style={{ borderColor: RULE }} colSpan={2}>Set total · {grp.label}</td>
          <td className="border-t px-3 py-2 text-right font-mono font-bold tabular-nums" style={{ borderColor: RULE }}>{priceText(grp.total, ccy)}</td>
        </tr>
      ) : null}
    </>
  );
}
