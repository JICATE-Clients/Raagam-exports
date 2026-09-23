import Link from "next/link";
import { VFinalBanner } from "@/components/orders/v-final-banner";
import { vFinalFor } from "@/lib/orders/amendments/v-final";
import { requirePermission } from "@/lib/auth/server";
import { getGarmentOrderSheet } from "@/lib/orders/gos/service";
import { getReportStyleImages } from "@/lib/orders/gos/style-images";
import { isRefusal } from "@/lib/orders/gos/types";
import { GosSheetDocument } from "@/components/orders/gos-sheet";
import { getDocLetterhead } from "@/lib/orders/gos/letterhead";
import { Card, CardBody } from "@/components/ui/card";
import { OrderDocumentTabs } from "@/components/orders/order-document-tabs";

/**
 * THE GARMENT ORDER SHEET, at `/orders/<sales order id>/gos`.
 *
 * ## WHY IT SITS UNDER THE ORDER AND NOT UNDER THE AMENDMENT
 *
 * The floor asks for "the sheet for HO/RE/26-27/0009". The RE Number is a
 * `sales_orders` row; the data is on `garment_order_amendments`, of which an
 * order may have several. Keying the route on the order means the link is
 * stable, shareable and always resolves to the CURRENT directive — a URL
 * pointing at a superseded amendment would hand somebody a sheet that is wrong
 * in a way nothing on it admits. `getGarmentOrderSheet` picks the current
 * amendment and prints its `code` and sequence number so a sheet in a hand can
 * be checked against what the system holds.
 *
 * ## WHY IT IS A PAGE AND NOT A DIALOG
 *
 * It has to be printable, and print is a property of the document, not of a
 * screen — `window.print()` prints the page it is called on. It also has to be
 * a URL somebody can send.
 *
 * ## NO RELOAD GUARD
 *
 * AGENTS.md's standing auto-reload guard covers screens holding editable local
 * state and hand-rolled overlays. This holds neither: it is read-only, has no
 * form and no overlay, so a silent auto-update mid-view costs a re-render of
 * the same document and nothing else. Registering a guard here would be the
 * ungated-`dirty` mistake in reverse — permanently blocking the silent updater
 * on this route to protect nothing.
 */
export default async function GosPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  /** `?version=proposed` — the amendment's in-flight data instead of V_final (0619). */
  searchParams: Promise<{ version?: string }>;
}) {
  await requirePermission("orders", "view");
  const [{ orderId }, { version }] = await Promise.all([params, searchParams]);

  /* V_FINAL (0619, spec §4B): while the order is amending, the sheet is the
     approved version frozen at raise, unless the proposed data is asked for. */
  const vf = await vFinalFor("gos", orderId);
  const proposed = version === "proposed";
  /* The pictures ticked "Print on reports" (user, 2026-09-23) are loaded
     BESIDE the sheet on every render — never frozen with it, because a signed
     URL outlives no amendment. See `getReportStyleImages`. */
  const [sheet, styleImages, company] = await Promise.all([
    vf.state === "frozen" && !proposed ? vf.payload : getGarmentOrderSheet(orderId),
    getReportStyleImages(orderId),
    /* The letterhead, read live like the pictures — not part of what an
       amendment approves, so never frozen (`getDocLetterhead`). */
    getDocLetterhead(orderId),
  ]);

  return (
    <div className="space-y-4">
      {/*
       * The band above the document. `print:hidden` is belt to the print
       * stylesheet's braces — the sheet's CSS removes everything that is not on
       * the path to `.gos-sheet`, and this would go with it regardless, but a
       * toolbar that says it is not part of the document is easier to trust
       * than one that relies on a selector three files away.
       *
       * The Excel / Print / Download PDF buttons sit on the document itself
       * (`GosToolbar`), as on every sibling order document.
       */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href={`/orders/${orderId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to order
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Garment Order Sheet</span>
        </div>
      </div>

      {/* THE SWITCHER ACROSS THE ORDER'S THREE DOCUMENTS (client 2026-09-02).
          Below the breadcrumb rather than inside it: the header row's job is
          "where am I / act on this page", and folding three links into it would
          push the toolbar buttons off the right on a narrow screen. It carries
          its own `print:hidden`. */}
      <OrderDocumentTabs orderId={orderId} current="gos" />

      <VFinalBanner
        state={vf}
        proposed={proposed}
        hrefApproved={`/orders/${orderId}/gos`}
        hrefProposed={`/orders/${orderId}/gos?version=proposed`}
      />


      {isRefusal(sheet) ? (
        /*
         * A REFUSAL IS RENDERED AS THE SENTENCE IT CARRIES, never as an empty
         * sheet. A blank Garment Order Sheet is indistinguishable from an order
         * nobody has entered yet — and on paper there is nobody to disbelieve
         * it. Same rule the size matrix follows inside the document.
         */
        <Card>
          <CardBody>
            <p className="text-sm font-medium">Nothing to print</p>
            <p className="mt-1 text-sm text-muted-foreground">{sheet.refused}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="rounded-md bg-[#f1f3f5] p-4">
          <GosSheetDocument sheet={sheet} company={company} styleImages={styleImages} />
        </div>
      )}
    </div>
  );
}
