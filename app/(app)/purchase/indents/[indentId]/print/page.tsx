import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getPurchaseIndent, getIndentLines } from "@/lib/purchase/extras-service";
import { INDENT_STATUS_LABELS } from "@/lib/purchase/extras-types";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { OrderFacts, ReportTable, SectionCard, SheetMasthead, SignOff, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { CompanyLine, DocumentFoot, presentFacts } from "@/components/documents/document-kit";
import { fmtDate, fmtNumber } from "@/lib/format";

/**
 * THE PURCHASE INDENT, AS PRINTED (user 2026-10-31, phase 2 of the compact document prints):
 * the department's request to Purchase — who asked, for when, and the lines with their qty.
 * Same shape as the vendor PO print: masthead → company line → facts (blank ones left off)
 * → lines with a Total row → notes → one-row sign-off. No money, so no Amount card.
 *
 * Item and UOM names are read BY ID, not through the active-only option lists: an indent
 * that names an item since switched off must still print it.
 */
export default async function IndentPrintPage({ params }: { params: Promise<{ indentId: string }> }) {
  await requirePermission("materials_purchase", "view");
  const { indentId } = await params;
  const [indent, lines] = await Promise.all([getPurchaseIndent(indentId), getIndentLines(indentId)]);
  if (!indent) notFound();

  const s = await createClient();
  const itemIds = [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))];
  const uomIds = [...new Set(lines.map((l) => l.uom_id).filter((x): x is string => !!x))];
  const locationId = (indent as unknown as { location_id?: string | null }).location_id ?? null;
  // Names, never uuids: `creator_names` is the SECURITY DEFINER lookup withCreators uses.
  const personIds = [indent.created_by, indent.user_approved_by, indent.md_approved_by].filter((x): x is string => !!x);
  const [{ data: co }, { data: unit }, { data: items }, { data: uoms }, { data: so }, { data: names }] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    locationId ? s.from("locations").select("name, gst_number").eq("id", locationId).maybeSingle() : Promise.resolve({ data: null }),
    itemIds.length ? s.from("items").select("id, name").in("id", itemIds) : Promise.resolve({ data: [] }),
    uomIds.length ? s.from("uoms").select("id, code").in("id", uomIds) : Promise.resolve({ data: [] }),
    indent.sales_order_id
      ? s.from("sales_orders").select("order_number").eq("id", indent.sales_order_id).maybeSingle()
      : Promise.resolve({ data: null }),
    personIds.length ? s.rpc("creator_names", { ids: personIds }) : Promise.resolve({ data: [] }),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const u = (unit ?? null) as { name: string | null; gst_number: string | null } | null;
  const itemName = new Map(((items ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]));
  const uomCode = new Map(((uoms ?? []) as { id: string; code: string }[]).map((x) => [x.id, x.code]));
  const nameOf = new Map(((names ?? []) as { id: string; full_name: string | null }[]).map((n) => [n.id, n.full_name]));
  const person = (id: string | null) => (id ? (nameOf.get(id) ?? null) : null);
  const orderNo = (so as { order_number?: string | null } | null)?.order_number ?? null;
  const companyName = cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS";

  const showApproved = lines.some((l) => l.approved_qty != null);
  const total = lines.reduce((t, l) => t + (Number(l.quantity) || 0), 0);
  const totalApproved = lines.reduce((t, l) => t + (Number(l.approved_qty) || 0), 0);
  const units = [...new Set(lines.map((l) => (l.uom_id ? uomCode.get(l.uom_id) : null)).filter(Boolean))];
  const approver = person(indent.md_approved_by) ?? person(indent.user_approved_by);
  const approvedAt = indent.md_approved_at ?? indent.user_approved_at;

  const facts = presentFacts([
    { label: "Department", value: indent.department },
    { label: "Requested By", value: person(indent.created_by) },
    { label: "Indent Date", value: fmtDate(indent.created_at), mono: true },
    { label: "Required By", value: indent.required_date ? fmtDate(indent.required_date) : null, mono: true },
    { label: "Status", value: INDENT_STATUS_LABELS[indent.status] },
    { label: "Order No", value: orderNo, mono: true },
    { label: "Approval Type", value: indent.approval_type },
    { label: "Approved On", value: approvedAt ? fmtDate(approvedAt) : null, mono: true },
  ]);

  return (
    <div>
      <PoPrintToolbar backHref={`/purchase/indents/${indentId}`} backLabel={indent.code ?? "Indent"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: companyName, unit: u?.name ?? null, logo: letterheadLogoOf(c) }}
            kind="Purchase Indent"
            reNo={indent.code}
            meta={
              <span className="tabular-nums">
                {fmtDate(indent.created_at)}
                {indent.status === "cancelled" ? " · CANCELLED" : ""}
              </span>
            }
            dense
          />
          <CompanyLine
            company={{
              address: registeredAddressOf(c),
              phone: cs("phone") ?? cs("mobile"),
              email: cs("email"),
              gstin: u?.gst_number ?? cs("gstin"),
            }}
          />
          <OrderFacts facts={facts} dense />
        </div>

        <SectionCard dense title="Items requested" total={fmtNumber(total)} totalLabel="Total qty">
          <ReportTable bare>
            <thead>
              <tr>
                <Th right>#</Th>
                <Th>Item</Th>
                <Th right>Qty</Th>
                {showApproved ? <Th right>Approved</Th> : null}
                <Th>Unit</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const name = l.item_id ? itemName.get(l.item_id) : null;
                return (
                  <tr key={l.id} style={stripeRow(i)} className="po-keep align-top">
                    <Td right>
                      <span className="text-[#7b8594]">{i + 1}</span>
                    </Td>
                    <Td>
                      <span className="font-semibold">{l.description}</span>
                      {name && name !== l.description ? <div className="text-[10.5px] text-[#7b8594]">{name}</div> : null}
                    </Td>
                    <Td right>{fmtNumber(Number(l.quantity) || 0)}</Td>
                    {showApproved ? <Td right>{l.approved_qty != null ? fmtNumber(Number(l.approved_qty)) : ""}</Td> : null}
                    <Td>{l.uom_id ? (uomCode.get(l.uom_id) ?? "") : ""}</Td>
                  </tr>
                );
              })}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={2} right>
                  Total
                </Td>
                <Td right>{fmtNumber(total)}</Td>
                {showApproved ? <Td right>{fmtNumber(totalApproved)}</Td> : null}
                <Td>{units.length === 1 ? units[0] : " "}</Td>
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        <DocumentFoot remarks={indent.notes} />

        <div className="po-keep">
          <SignOff
            dense
            cells={[
              ["Requested By", person(indent.created_by)],
              ["Checked By", null],
              ["Approved By", approver],
            ]}
          />
        </div>
      </article>
    </div>
  );
}
