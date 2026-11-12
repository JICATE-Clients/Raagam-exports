import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getKnitAnalysisSheet, getKnittingOrder } from "@/lib/production/knitting-service";
import { WIDTH_FORM_LABELS } from "@/lib/production/knitting-types";
import { letterheadLogoOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { ReportTable, SectionCard, SheetMasthead, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";

/**
 * KNITTING ANALYSIS — the legacy RP statement's layout (screenshot 4105, user 2026-11-11: "did we
 * follow this format"), read live off one knitting order's posted documents:
 *
 *   header line   Group No (RE) · KO · Fabrication Unit (knitter) · Customer
 *   Knitting Order & Receipt   per KO fabric: KO No/Dt · Item (blend, form) · UOM ·
 *                              Ordered Dia / Wt  ‖  GRN No · Supp DC No · GRN Dt · Supp Dt ·
 *                              Received Dia · Roll · Wt
 *   Yarn Issue & Return        DC by DC: DocNo/Dt · Yarn (Mill) · UOM · Issued Bag / Wt;
 *                              then each return: GRN No · Supp DC · dates · Returned Bag / Wt
 *   the box       YARN TO BE RETURNED : issued − fabric − returned KGS ( % )
 *
 * "GRN No" is the knitting receipt (PRC-…, the Process Receipt series, D4). The MILL is the
 * supplier of the GRN that brought the yarn's lot in. Loss past the Allowed Loss % prints red
 * (spec §5) — the statement flags it; it never blocks the store.
 */
export default async function KnittingAnalysisPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requirePermission("stores", "view");
  const { orderId } = await params;
  const doc = await getKnittingOrder(orderId);
  if (!doc) notFound();
  const sheet = await getKnitAnalysisSheet(doc);

  const s = await createClient();
  const [{ data: co }, { data: po }] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("process_orders").select("location:locations!location_id(name)").eq("id", orderId).maybeSingle(),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const unit = ((po as { location?: { name: string | null } | null } | null)?.location?.name ?? null) as string | null;
  const companyName = cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS";

  const over =
    sheet.to_return_pct != null &&
    (doc.allowed_loss_pct == null ? sheet.to_return_kg > 0.0005 : sheet.to_return_pct > doc.allowed_loss_pct + 0.0005);
  const orderedTotal = sheet.fabrics.reduce((t, f) => t + f.ordered_kg, 0);
  const rollsTotal = sheet.fabrics.reduce((t, f) => t + f.receipts.reduce((u, r) => u + (r.rolls ?? 0), 0), 0);
  const issuedBags = sheet.issues.reduce((t, d) => t + d.lines.reduce((u, l) => u + (l.bags ?? 0), 0), 0);
  const returnedBags = sheet.returns.reduce((t, r) => t + (r.bags ?? 0), 0);
  const muted = "text-[10.5px] text-[#4b5563]";

  return (
    <div>
      <PoPrintToolbar backHref={`/process/knitting-hub/${doc.id}`} backLabel={doc.code ?? "Knitting Order"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep space-y-2">
          <SheetMasthead
            company={{ name: companyName, unit, logo: letterheadLogoOf(c) }}
            kind="Knitting Analysis"
            reNo={doc.code}
            meta={<span className="tabular-nums">Printed {fmtDateTime(new Date().toISOString())}</span>}
            dense
          />
          {/* THE LEGACY HEADER LINE — Group No · KO · Fabrication Unit · Customer, one ruled row. */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-[#17202b] px-3 py-1.5 font-semibold sm:grid-cols-4">
            <div>
              <span className="text-[#4b5563]">Group No : </span>
              <span className="font-mono">{doc.order_number ?? "—"}</span>
            </div>
            <div>
              <span className="text-[#4b5563]">KO : </span>
              <span className="font-mono">{doc.code ?? "—"}</span>
            </div>
            <div>
              <span className="text-[#4b5563]">Fabrication Unit : </span>
              {doc.vendor_name ?? "—"}
            </div>
            <div>
              <span className="text-[#4b5563]">Customer : </span>
              {sheet.customer ?? "—"}
            </div>
          </div>
        </div>

        <SectionCard dense title="Knitting Order & Receipt" total={`${fmtNumber(sheet.fabric_kg)} / ${fmtNumber(orderedTotal)}`} totalLabel="Received / Ordered Wt">
          <ReportTable bare>
            <thead>
              <tr>
                <Th>KO No / KO Dt</Th>
                <Th>Item</Th>
                <Th>UOM</Th>
                <Th>Ordered Dia</Th>
                <Th right>Ordered Wt</Th>
                <Th>GRN No / Supp DC No</Th>
                <Th>GRN Dt / Supp Dt</Th>
                <Th>Recd Dia</Th>
                <Th right>Roll</Th>
                <Th right>Recd Wt</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.fabrics.map((f, i) => {
                const rows = f.receipts.length ? f.receipts : [null];
                return rows.map((r, j) => (
                  <tr key={`${f.id}-${j}`} style={stripeRow(i)} className="po-keep align-top">
                    {j === 0 ? (
                      <>
                        <Td mono>
                          {doc.code ?? ""}
                          <div className={muted}>{fmtDate(doc.order_date)}</div>
                        </Td>
                        <Td>
                          <span className="font-semibold">{f.item}</span>
                          {f.width_form ? <span className={muted}> / {WIDTH_FORM_LABELS[f.width_form as keyof typeof WIDTH_FORM_LABELS] ?? f.width_form}</span> : null}
                        </Td>
                        <Td>KGS</Td>
                        <Td>
                          {f.ordered_dia ? `${f.ordered_dia} DIA` : ""}
                          {f.finish_dia ? <div className={muted}>FIN {f.finish_dia}</div> : null}
                        </Td>
                        <Td right>{fmtNumber(f.ordered_kg)}</Td>
                      </>
                    ) : (
                      <Td colSpan={5}>{""}</Td>
                    )}
                    <Td mono>
                      {r?.grn ?? ""}
                      {r?.supp_dc ? <div className={muted}>{r.supp_dc}</div> : null}
                    </Td>
                    <Td mono>
                      {r ? fmtDate(r.grn_date) : ""}
                      {r?.supp_dt ? <div className={muted}>{fmtDate(r.supp_dt)}</div> : null}
                    </Td>
                    <Td>{r?.dia ?? ""}</Td>
                    <Td right>{r?.rolls ?? ""}</Td>
                    <Td right>{r ? fmtNumber(r.kg) : ""}</Td>
                  </tr>
                ));
              })}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={4} right>
                  Total
                </Td>
                <Td right>{fmtNumber(orderedTotal)}</Td>
                <Td colSpan={3}>{""}</Td>
                <Td right>{rollsTotal || ""}</Td>
                <Td right>{fmtNumber(sheet.fabric_kg)}</Td>
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        <SectionCard dense title="Yarn Issue & Return" total={`${fmtNumber(sheet.issued_kg)}`} totalLabel="Issued Wt">
          <ReportTable bare>
            <thead>
              <tr>
                <Th>Doc No / Doc Dt</Th>
                <Th>Yarn</Th>
                <Th>UOM</Th>
                <Th right>Issued Bag</Th>
                <Th right>Issued Wt</Th>
                <Th>GRN No / Supp DC No</Th>
                <Th>GRN Dt / Supp Dt</Th>
                <Th right>Returned Bag</Th>
                <Th right>Returned Wt</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.issues.flatMap((d, i) =>
                d.lines.map((l, j) => (
                  <tr key={`${d.dc_id}-${j}`} style={stripeRow(i)} className="po-keep align-top">
                    <Td mono>
                      {j === 0 ? (
                        <>
                          {d.doc ?? ""}
                          <div className={muted}>{fmtDate(d.date)}</div>
                        </>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="font-semibold">{l.yarn}</span>
                      {l.mill || l.lot ? (
                        <div className={muted}>{[l.mill ? `Mill: ${l.mill}` : null, l.lot ? `Lot ${l.lot}` : null].filter(Boolean).join(" · ")}</div>
                      ) : null}
                    </Td>
                    <Td>KGS</Td>
                    <Td right>{l.bags ?? ""}</Td>
                    <Td right>{fmtNumber(l.kg)}</Td>
                    <Td colSpan={4}>{""}</Td>
                  </tr>
                )),
              )}
              {sheet.returns.map((r, i) => (
                <tr key={`ret-${i}`} style={stripeRow(i)} className="po-keep align-top">
                  <Td colSpan={1}>{""}</Td>
                  <Td>
                    <span className="font-semibold">{r.yarn}</span>
                    <div className={muted}>returned by the knitter</div>
                  </Td>
                  <Td>KGS</Td>
                  <Td colSpan={2}>{""}</Td>
                  <Td mono>
                    {r.receipt ?? ""}
                    {r.supp_dc ? <div className={muted}>{r.supp_dc}</div> : null}
                  </Td>
                  <Td mono>
                    {fmtDate(r.date)}
                    {r.supp_dt ? <div className={muted}>{fmtDate(r.supp_dt)}</div> : null}
                  </Td>
                  <Td right>{r.bags ?? ""}</Td>
                  <Td right>{fmtNumber(r.kg)}</Td>
                </tr>
              ))}
              {sheet.issues.length === 0 && sheet.returns.length === 0 ? (
                <tr>
                  <Td colSpan={9}>
                    <span className="text-[#7b8594]">No yarn has been sent on this order yet.</span>
                  </Td>
                </tr>
              ) : null}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={3} right>
                  Total
                </Td>
                <Td right>{issuedBags || ""}</Td>
                <Td right>{fmtNumber(sheet.issued_kg)}</Td>
                <Td colSpan={2}>{""}</Td>
                <Td right>{returnedBags || ""}</Td>
                <Td right>{fmtNumber(sheet.returned_kg)}</Td>
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        {/* THE LEGACY BOX — issued − fabric received − yarn returned. Red past the Allowed Loss %. */}
        <div className={`po-keep rounded border-2 px-3 py-2 text-center text-[13px] font-bold ${over ? "border-[#b42318] text-[#b42318]" : "border-[#17202b]"}`}>
          YARN TO BE RETURNED : {fmtNumber(sheet.to_return_kg)} KGS
          {sheet.to_return_pct != null ? ` ( ${fmtNumber(sheet.to_return_pct)} % )` : ""}
          <div className="mt-0.5 text-[11px] font-normal">
            Issued {fmtNumber(sheet.issued_kg)} − Fabric {fmtNumber(sheet.fabric_kg)} − Returned {fmtNumber(sheet.returned_kg)}
            {" · "}
            {doc.allowed_loss_pct == null ? "no Allowed Loss % set" : `allowed ${fmtNumber(doc.allowed_loss_pct)} %`}
            {over ? " · OVER — closing needs the MD's approval" : ""}
            {sheet.written_off_kg ? ` · ${fmtNumber(sheet.written_off_kg)} kg written off at close${doc.close_reason ? ` (${doc.close_reason})` : ""}` : ""}
          </div>
        </div>
      </article>
    </div>
  );
}
