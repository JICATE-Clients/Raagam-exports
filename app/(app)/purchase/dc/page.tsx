import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { listDcRegister } from "@/lib/purchase/dc-register";
import { getProcessDc, listOpenProcessOrders } from "@/lib/stores/process-dc-service";
import { getProductionDc, getProductionDcSetup } from "@/lib/stores/production-dc-service";
import { getItems } from "@/lib/stores/service";
import { getVendorReturn, getVendorReturnLines, getItems as getReturnItems } from "@/lib/stores/extras-service";
import { VENDOR_RETURN_STATUS_LABELS } from "@/lib/stores/extras-types";
import { StatusPill } from "@/components/ui/status-pill";
import { statusTone } from "@/lib/ui/status-tone";
import { ReturnDcDetail } from "./_components/return-dc-detail";
import { PageHeader } from "@/components/ui/page-header";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtNumber } from "@/lib/format";
import { DcRegisterScreen } from "./_components/dc-register-screen";
import { DcDrawer, type NewType } from "./_components/dc-drawer";
import { ProcessDcSendForm } from "../../stores/process-dc/_components/process-dc-send-form";
import { ProcessReceiptForm } from "../../stores/process-dc/_components/process-receipt-form";
import { ProductionDcSendForm } from "../../stores/production-dc/_components/production-dc-send-form";
import { ProductionDcReceiveForm } from "../../stores/production-dc/_components/production-dc-receive-form";
import { GeneralDcSendForm } from "../general-delivery/_components/general-dc-send-form";
import { getGeneralDc, getGeneralDcOptions } from "@/lib/purchase/general-dc-service";

/**
 * PURCHASE ▸ RECEIVING ▸ DELIVERY CHALLANS — THE ONE DC HUB (user 2026-10-31: "consolidate the
 * Delivery Challan screens into a single screen"). The register of every DC (Process,
 * Production, Rejection, Replacement) and, in its place, ONE form the URL opens:
 *
 *   ?new=process|production        → the Send form for that type (DC Type selector on top)
 *   ?new=rejection|replacement     → what is open of that type; they are raised by a GRN
 *   ?edit=<id>&type=…              → a draft reopened in its Send form
 *   ?receive=<id>&type=process     → Receive back (output, used, loss %, draft bill)
 *   ?receive=<id>&type=production  → Receive stock at this unit (shortage + reason)
 *
 * The forms and the stock steps are the ones Stores ▸ Process DC / Production DC used (0784–
 * 0788); those pages now redirect here. Purchase OR Stores may open it: job work is both
 * modules' work and a unit transfer is Stores'.
 */
type Search = { type?: string; new?: string; edit?: string; receive?: string; order?: string; view?: string };

export default async function DcHubPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [purchaseView, storesView] = await Promise.all([can("materials_purchase", "view"), can("stores", "view")]);
  if (!purchaseView && !storesView) await requirePermission("materials_purchase", "view");
  const sp = await searchParams;
  const [rows, canCreate, canDispatch] = await Promise.all([
    listDcRegister(),
    (async () => (await can("stores", "create")) || (await can("materials_purchase", "create")))(),
    // Dispatching a Rejection / Replacement DC is postVendorReturn's own gate: stores:edit.
    can("stores", "edit"),
  ]);
  const type = sp.type ?? null;

  // THE FORM REPLACES THE REGISTER, IN THE PAGE (user 2026-11-02, Raise PO's way) — no
  // drawer over the list, so the sidebar stays and the form uses the full page width.
  const form = await drawer(sp, type, rows);
  return (
    /* No floating "← Back" over an open form (Raise PO's rule); the list keeps it. */
    <div className="space-y-4 [&:has([data-dc-editor])>[data-focus-region=header]>div]:hidden">
      <PageHeader title="Delivery Challans" description="Every DC — job work, unit transfers, rejections and replacements" />
      {form ?? <DcRegisterScreen rows={rows} canCreate={canCreate} canDispatch={canDispatch} initialType={type} />}
    </div>
  );
}

async function drawer(sp: Search, type: string | null, rows: Awaited<ReturnType<typeof listDcRegister>>) {
  const newType = (["process", "production", "general", "rejection", "replacement"] as const).find((t) => t === sp.new) ?? null;

  // VIEW A REJECTION / REPLACEMENT DC — opened, dispatched and printed HERE (user 2026-11-02,
  // two-screen return plan: GRN raises it, this screen sends it). The old Vendor Returns
  // pages redirect to this.
  if (sp.view) {
    const [doc, lines, items, canEdit, canDelete] = await Promise.all([
      getVendorReturn(sp.view),
      getVendorReturnLines(sp.view),
      getReturnItems(),
      can("stores", "edit"),
      can("stores", "delete"),
    ]);
    if (!doc) notFound();
    const kindWord = doc.dc_kind === "replacement" ? "Replacement DC" : "Rejection DC";
    const sent = doc.status !== "draft" && doc.status !== "cancelled";
    return (
      <DcDrawer title={`${kindWord} ${doc.code ?? ""}`.trim()} type={type} showBack>
        <div className="max-w-[48rem] space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusPill tone={statusTone(doc.status, { replaced: "info", closed: "success" })}>{VENDOR_RETURN_STATUS_LABELS[doc.status]}</StatusPill>
            <span className="text-muted-foreground">{fmtDate(doc.return_date)}</span>
            {doc.reason ? <span className="text-muted-foreground">{doc.reason}</span> : null}
            {/* The return slip prints once the DC has gone out (plan: Dispatch, then print). */}
            {sent ? (
              <Link href={`/purchase/vendor-returns/${doc.id}/print`} className="font-semibold text-primary hover:underline">
                Print DC
              </Link>
            ) : null}
          </div>
          <ReturnDcDetail
            docId={doc.id}
            status={doc.status}
            lines={lines}
            items={items}
            canEdit={canEdit}
            canDelete={canDelete}
            fromGrn={!!doc.grn_id}
          />
        </div>
      </DcDrawer>
    );
  }

  // RECEIVE — back from a processor, or stock arriving at this unit.
  if (sp.receive) {
    // A returnable General DC comes back on its own screen, Delivery Return (0797).
    if (sp.type === "general") redirect(`/purchase/delivery-returns?dc=${sp.receive}`);
    if (sp.type === "production") {
      const [dc, setup] = await Promise.all([getProductionDc(sp.receive), getProductionDcSetup()]);
      if (!dc) notFound();
      return (
        <DcDrawer title={`Receive stock · ${dc.code ?? "Production DC"}`} type={type}>
          <ProductionDcReceiveForm dc={dc} stores={setup.stores} bins={setup.bins} home={`/purchase/dc?type=production`} />
        </DcDrawer>
      );
    }
    const [dc, setup, items] = await Promise.all([getProcessDc(sp.receive), getProductionDcSetup(), getItems()]);
    if (!dc) notFound();
    return (
      <DcDrawer title={`Receive back · ${dc.code ?? "Process DC"}`} type={type}>
        <ProcessReceiptForm dc={dc} items={items} stores={setup.stores} bins={setup.bins} home={`/purchase/dc?type=process`} />
      </DcDrawer>
    );
  }

  // EDIT A DRAFT, or NEW.
  const formType = sp.edit ? (sp.type === "production" ? "production" : sp.type === "general" ? "general" : "process") : newType;
  if (!formType) return null;

  if (formType === "process") {
    const [orders, setup, dc] = await Promise.all([
      listOpenProcessOrders(),
      getProductionDcSetup(),
      sp.edit ? getProcessDc(sp.edit) : Promise.resolve(null),
    ]);
    if (sp.edit && !dc) notFound();
    return (
      <DcDrawer title={dc ? `Process DC ${dc.code ?? ""}` : "New Delivery Challan"} type={type} chooser={sp.edit ? null : "process"}>
        {setup.unit ? (
          <ProcessDcSendForm
            orders={orders}
            stores={setup.stores}
            bins={setup.bins}
            stock={setup.stock}
            existing={dc && dc.status === "draft" ? dc : null}
            initialOrderId={sp.order ?? null}
            home={`/purchase/dc?type=process`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Pick your working unit in the top bar first.</p>
        )}
      </DcDrawer>
    );
  }

  // GENERAL DC (0796): out to a party — repair, sample, loan, gift; returnable or not.
  if (formType === "general") {
    const [setup, options, dc] = await Promise.all([
      getProductionDcSetup(),
      getGeneralDcOptions(),
      sp.edit ? getGeneralDc(sp.edit) : Promise.resolve(null),
    ]);
    if (sp.edit && !dc) notFound();
    return (
      <DcDrawer title={dc ? `General DC ${dc.code ?? ""}` : "New Delivery Challan"} type={type} chooser={sp.edit ? null : "general"}>
        {setup.unit ? (
          <GeneralDcSendForm
            unit={setup.unit}
            stores={setup.stores}
            bins={setup.bins}
            stock={setup.stock}
            vendors={options.vendors}
            uoms={options.uoms}
            existing={dc && dc.status === "draft" ? dc : null}
            home={`/purchase/dc?type=general`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Pick your working unit in the top bar first.</p>
        )}
      </DcDrawer>
    );
  }

  if (formType === "production") {
    const [setup, dc] = await Promise.all([getProductionDcSetup(), sp.edit ? getProductionDc(sp.edit) : Promise.resolve(null)]);
    if (sp.edit && !dc) notFound();
    return (
      <DcDrawer title={dc ? `Production DC ${dc.code ?? ""}` : "New Delivery Challan"} type={type} chooser={sp.edit ? null : "production"}>
        {setup.unit ? (
          <ProductionDcSendForm
            unit={setup.unit}
            toUnits={setup.toUnits}
            stores={setup.stores}
            bins={setup.bins}
            stock={setup.stock}
            existing={dc && dc.status === "draft" && dc.outgoing ? dc : null}
            home={`/purchase/dc?type=production`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Pick your working unit in the top bar first.</p>
        )}
      </DcDrawer>
    );
  }

  // REJECTION / REPLACEMENT — raised by a GRN, never typed: posting QC-failed goods is what
  // books them to the Rejection store and raises the Debit Note (0780 · 0781). The drawer
  // shows the ones still open and where each is worked.
  const kind = formType as Extract<NewType, "rejection" | "replacement">;
  const open = rows.filter((r) => r.kind === kind && !["closed", "replaced", "cancelled"].includes(r.status));
  return (
    <DcDrawer title="New Delivery Challan" type={type} chooser={kind} showBack>
      <div className="max-w-[48rem] space-y-3">
        <p className="text-sm">
          {kind === "rejection"
            ? "A Rejection DC is raised when a GRN is posted with a QC-failed line marked Rejection — it carries the Debit Note and reopens the requirement."
            : "A Replacement DC is raised when a GRN is posted with a QC-failed line marked Replacement. When the vendor resends, receive it on Goods Receipts: its Pending row opens a Replacement GRN locked to this DC's vendor."}
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/purchase/grn" className="font-semibold text-primary hover:underline">
            Go to Goods Receipts
          </Link>
        </div>
        <h3 className="pt-2 text-sm font-semibold">
          Open {kind === "rejection" ? "Rejection" : "Replacement"} DCs ({open.length})
        </h3>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">None open.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {open.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <Link href={r.href} className="font-mono text-xs font-medium text-primary hover:underline">
                  {r.code ?? "—"}
                </Link>
                <Truncated className="min-w-0 flex-1">{r.party}</Truncated>
                <span className="text-muted-foreground">{r.against ?? ""}</span>
                <span className="text-muted-foreground">{fmtDate(r.date)}</span>
                <span className="tabular-nums">
                  {fmtNumber(r.qty)}
                  {r.outstanding > 0 ? ` · ${fmtNumber(r.outstanding)} still owed` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DcDrawer>
  );
}
