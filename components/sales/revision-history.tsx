import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { changeText, type RevisionHistoryRow } from "@/lib/sales/sample-costing/revision-history";
import { ReportTable, SectionCard, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";

/**
 * Sample Costing — the revision history block of a report (client 2026-10-09).
 *
 * Original → Rev 1 → Rev 2, each with its date, status, the price it carried and
 * how that moved, the one on this page marked "This report". Drawn with the
 * order reports' kit (`report-kit.tsx`), as both documents now are, and in the
 * same card the PDFs' "Revision history" draws.
 *
 * `showMargin` is the INTERNAL switch: the Cost Sheet passes rows that carry a
 * margin and turns it on; the Quotation's rows have no margin to show at all
 * (it is stripped from its model), so the buyer-facing page cannot print one
 * whatever this prop says.
 */
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
    <SectionCard title="Revision history" total={`${rows.length} revisions`}>
      <ReportTable bare>
        <thead>
          <tr>
            <Th>Revision</Th>
            <Th>Date</Th>
            <Th>Status</Th>
            <Th right>Quoted price</Th>
            <Th right>Change</Th>
            {showMargin ? <Th right>Margin</Th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.current ? "font-semibold" : undefined} style={r.current ? totalRowStyle() : stripeRow(i)}>
              <Td>
                {hrefFor && !r.current ? (
                  <Link href={hrefFor(r.id)} className="text-[#037bb8] underline underline-offset-2">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
                {r.current ? (
                  <span className="ml-2 rounded-full bg-[#037bb8] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">This report</span>
                ) : null}
              </Td>
              <Td mono>{r.date ? fmtDate(r.date) : "—"}</Td>
              <Td>{r.statusLabel}</Td>
              <Td right mono>{price(r.price)}</Td>
              <Td right mono className={r.changePct == null || r.changePct === 0 ? "" : r.changePct < 0 ? "text-[#b4331f]" : "text-[#3f6a0d]"}>
                {changeText(r.changePct)}
              </Td>
              {showMargin ? <Td right mono>{r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}</Td> : null}
            </tr>
          ))}
        </tbody>
      </ReportTable>
    </SectionCard>
  );
}
