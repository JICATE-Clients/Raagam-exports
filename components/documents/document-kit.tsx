import { ReportTable, SectionCard, Td, stripeRow, totalRowStyle, type SheetFact } from "@/components/orders/report-kit";
import { fmtFixed } from "@/lib/format";

/**
 * THE OUTSIDE-PARTY DOCUMENT'S PARTS (user 2026-10-31: "built on every … for all module",
 * Phase 1). The vendor PO print (`components/purchase/po-print-sheet.tsx`) was made compact
 * screenshot by screenshot that day; these are its pieces, lifted out so every document a
 * supplier, processor, buyer or bank receives — PO, Process DC, Production DC, Rejection DC,
 * Commercial Invoice, Packing List — reads as one family. They sit ON the report kit
 * (`components/orders/report-kit.tsx`, `dense` mode), never beside it:
 *
 *   SheetMasthead dense  →  CompanyLine  →  OrderFacts dense (facts through `presentFacts`)
 *   →  item SectionCard dense, its Total row in `totalRowStyle()`
 *   →  DocumentFoot (words · remarks · terms left, AmountCard right)
 *   →  SignOff dense, ONE row
 *
 * Wrap the page in `DocumentPrintStyles` and mark each block that must not split `po-keep`.
 * NOT "use client": every caller is a server component (report-kit says why that matters).
 */

/** A value that says nothing — left off a facts grid rather than printed as a dash. */
function isBlank(v: React.ReactNode): boolean {
  if (v == null || v === false) return true;
  if (typeof v === "string") return v.trim() === "" || v.trim() === "—";
  return false;
}

/**
 * A FACT WITH NO VALUE IS LEFT OFF (user 2026-10-31, the PO facts grid pasted back with four
 * dashes). Pass every fact the document CAN carry — `null` / `false` for one that does not
 * apply — and only the filled ones reach `OrderFacts`, which sizes itself to them.
 */
export function presentFacts(facts: readonly (SheetFact | null | false | undefined)[]): SheetFact[] {
  return facts.filter((f): f is SheetFact => !!f && !isBlank(f.value));
}

/** Address · Tel · Email · GSTIN — the line under the masthead; nothing when all are empty. */
export function CompanyLine({
  company,
}: {
  company: { address?: string | null; phone?: string | null; email?: string | null; gstin?: string | null };
}) {
  const parts = [company.address, company.phone ? `Tel ${company.phone}` : null, company.email, company.gstin ? `GSTIN ${company.gstin}` : null].filter(Boolean);
  if (!parts.length) return null;
  return <p className="border-x border-b border-border bg-white px-4 py-1 text-[10.5px] text-[#5b6472]">{parts.join(" · ")}</p>;
}

/** "₹ 1,234.50", a Less as "− ₹ 12.00". */
export function money(sym: string, v: number): string {
  return `${v < 0 ? "− " : ""}${sym} ${fmtFixed(Math.abs(v), 2)}`;
}

/**
 * THE MONEY, in the order an invoice is checked against it: each line (Gross Value, a tax,
 * a charge, Round off), then the net in the tone's total row. `after` takes rows below the
 * net that are not part of it (an import PO's "In INR").
 */
export function AmountCard({
  sym,
  rows,
  net,
  netLabel = "Net Value",
  title = "Amount",
  after,
}: {
  sym: string;
  rows: readonly { label: string; value: number }[];
  net: number;
  netLabel?: string;
  title?: string;
  after?: readonly { label: string; value: string }[];
}) {
  return (
    <SectionCard dense title={title} total={money(sym, net)} totalLabel={netLabel}>
      <ReportTable bare>
        <tbody>
          {rows.map((a, i) => (
            <tr key={a.label} style={stripeRow(i)}>
              <Td>{a.label}</Td>
              <Td right>{money(sym, a.value)}</Td>
            </tr>
          ))}
          <tr style={totalRowStyle()} className="font-semibold">
            <Td>{netLabel}</Td>
            <Td right>{money(sym, net)}</Td>
          </tr>
          {after?.map((a) => (
            <tr key={a.label}>
              <Td>{a.label}</Td>
              <Td right>{a.value}</Td>
            </tr>
          ))}
        </tbody>
      </ReportTable>
    </SectionCard>
  );
}

/**
 * THE FOOT, ONE BAND (user 2026-10-31 "compacted"; screenshot 3942). Left: the value in
 * words, the remarks, the terms — each only when there is one. Right: the money
 * (`AmountCard`), when the document carries money; a DC carries none, so its left column
 * takes the full width. Nothing at all → nothing rendered. `lead` puts a document's own
 * card first on the left (the Rejection DC's Debit Note copy).
 */
export function DocumentFoot({
  lead,
  words,
  remarks,
  terms,
  amount,
}: {
  lead?: React.ReactNode;
  words?: string | null;
  remarks?: string | null;
  terms?: readonly { label: string; value: React.ReactNode }[];
  amount?: React.ReactNode;
}) {
  const left = (
    <>
      {lead}
      {words ? (
        <SectionCard dense title="Value in words">
          <p className="px-3 py-1.5 font-semibold">{words}</p>
        </SectionCard>
      ) : null}
      {remarks?.trim() ? (
        <SectionCard dense title="Remarks">
          <p className="px-3 py-1.5 whitespace-pre-wrap">{remarks}</p>
        </SectionCard>
      ) : null}
      {terms?.length ? (
        <SectionCard dense title="Terms and Conditions">
          <ReportTable bare>
            <tbody>
              {terms.map((t, i) => (
                <tr key={t.label} style={stripeRow(i)}>
                  <Td className="text-[#5b6472]">{t.label}</Td>
                  <Td>{t.value}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </SectionCard>
      ) : null}
    </>
  );
  const hasLeft = !!(lead || words || remarks?.trim() || terms?.length);
  if (!hasLeft && !amount) return null;
  if (!amount) return <div className="po-keep space-y-3">{left}</div>;
  return (
    <div className="po-keep grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-3">
      <div className="space-y-3">{left}</div>
      {amount}
    </div>
  );
}
