import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { changeText, type RevisionHistoryRow } from "@/lib/sales/sample-costing/revision-history";

/**
 * Sample Costing — the revision history block of a report (client 2026-10-09).
 *
 * Original → Rev 1 → Rev 2, each with its date, status, the price it carried and
 * how that moved, the one on this page marked "This report". Drawn on the paper
 * palette both documents use, so it sits inside either without a seam.
 *
 * `showMargin` is the INTERNAL switch: the Cost Sheet passes rows that carry a
 * margin and turns it on; the Quotation's rows have no margin to show at all
 * (it is stripped from its model), so the buyer-facing page cannot print one
 * whatever this prop says.
 */
const INK = "#17202b";
const MUTED = "#5b6472";
const RULE = "#e3e7ec";

type Row = Omit<RevisionHistoryRow, "marginPct"> & { marginPct?: number | null };

export function RevisionHistory({
  rows,
  currency,
  showMargin = false,
  hrefFor,
}: {
  rows: readonly Row[];
  currency: string | null;
  showMargin?: boolean;
  /** Where a revision's own report lives. When given, every revision but the one shown is a link. */
  hrefFor?: (id: string) => string;
}) {
  if (rows.length === 0) return null;
  const price = (v: number | null) => (v == null ? "—" : `${currency ?? ""} ${v.toFixed(2)}`.trim());
  return (
    <section className="px-7 pb-6" style={{ color: INK }}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: MUTED }}>Revision history</span>
        <span className="text-[11px]" style={{ color: MUTED }}>{rows.length} revisions of this costing</span>
      </div>
      <div className="overflow-hidden rounded-lg border" style={{ borderColor: RULE }}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr style={{ background: "#f6f7f9", color: MUTED }}>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Revision</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Date</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">Status</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Quoted price</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Change</th>
              {showMargin ? <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">Margin</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ background: r.current ? "#eaf7fd" : "#ffffff", color: r.current ? INK : MUTED, fontWeight: r.current ? 600 : 400 }}>
                <td className="border-t px-3 py-2" style={{ borderColor: RULE }}>
                  {hrefFor && !r.current ? (
                    <Link href={hrefFor(r.id)} className="underline underline-offset-2" style={{ color: "#037bb8" }}>
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                  {r.current ? (
                    <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: "#037bb8" }}>
                      This report
                    </span>
                  ) : null}
                </td>
                <td className="border-t px-3 py-2 tabular-nums" style={{ borderColor: RULE }}>{r.date ? fmtDate(r.date) : "—"}</td>
                <td className="border-t px-3 py-2" style={{ borderColor: RULE }}>{r.statusLabel}</td>
                <td className="border-t px-3 py-2 text-right font-mono tabular-nums" style={{ borderColor: RULE }}>{price(r.price)}</td>
                <td
                  className="border-t px-3 py-2 text-right font-mono tabular-nums"
                  style={{ borderColor: RULE, color: r.changePct == null || r.changePct === 0 ? undefined : r.changePct < 0 ? "#b4331f" : "#3f6a0d" }}
                >
                  {changeText(r.changePct)}
                </td>
                {showMargin ? (
                  <td className="border-t px-3 py-2 text-right font-mono tabular-nums" style={{ borderColor: RULE }}>
                    {r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
