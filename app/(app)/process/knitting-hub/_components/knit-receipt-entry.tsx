"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { DOC_FRAME } from "@/components/purchase/doc-surface";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";
import type { KnitPartyTarget, KnittingOrder, KnittingOrderListRow } from "@/lib/production/knitting-types";
import { KnittingReceiptPanel, ReceiptHeaderRow } from "./knitting-receipt-panel";

/**
 * PROCESS ▸ KNITTING ▸ FABRIC RECEIPTS / YARN RETURNS ▸ New (user 2026-11-12: "separate child …
 * remove it from here"). Pick the Knitting Order the knitter delivered against, then post on the
 * same panel the order used to carry as tabs 3 and 4 — so the yarn drawn by blend %, the draft
 * bill, the analysis and Close are unchanged. The order is in the URL (?order=), so a link from
 * the Knitting Order lands with it picked.
 */
export function KnitReceiptEntry({
  mode,
  orders,
  waiting,
  doc,
  partyTargets = [],
  stores,
  bins,
  canEdit,
  today,
}: {
  /** Yarn Return only: other knitters' open orders Party Stock may go to (0837). */
  partyTargets?: KnitPartyTarget[];
  mode: "fabric" | "yarn_return";
  orders: KnittingOrderListRow[];
  /** Issued orders whose yarn has not gone out yet — named, so an empty list explains itself. */
  waiting: KnittingOrderListRow[];
  doc: KnittingOrder | null;
  stores: StoreOption[];
  bins: BinOption[];
  canEdit: boolean;
  today: string;
}) {
  const router = useRouter();
  const base = mode === "fabric" ? "/process/knitting-receipts/new" : "/process/knitting-returns/new";
  // The picker is the FIRST field of the panel's one header row (user 2026-11-12).
  const orderField = (
    <Field label="Knitting Order" required w="party">
      <Combobox
        options={orders.map((o) => ({
          value: o.id,
          label: o.code ?? "(no number)",
          sublabel: [o.vendor_name, o.order_number ? `RE ${o.order_number}` : null].filter(Boolean).join(" · ") || undefined,
        }))}
        value={doc?.id ?? ""}
        onChange={(v) => router.push(v ? `${base}?order=${v}` : base)}
        placeholder={orders.length ? "Pick the knitting order" : "No order has yarn at a knitter"}
        required
      />
    </Field>
  );
  return (
    <div className={`${DOC_FRAME} space-y-4 p-4`} data-focus-scope="">
      {doc ? null : <ReceiptHeaderRow isFabric={mode === "fabric"} orderField={orderField} knitter={null} disabled today={today} />}
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {mode === "fabric" ? "Fabric" : "Yarn"} comes back only after yarn has gone to the knitter, and no Knitting Order has yarn out yet.
          {waiting.length ? (
            <>
              {" "}
              Issued, waiting for their yarn:{" "}
              {waiting.map((o, i) => (
                <span key={o.id}>
                  {i ? ", " : ""}
                  <Link href={`/process/knitting-hub/${o.id}`} className="text-primary hover:underline">
                    {o.code ?? "(no number)"}
                  </Link>
                </span>
              ))}
              {" "}— send it from the order with Send Yarn.
            </>
          ) : null}
        </p>
      ) : null}
      {doc ? <KnittingReceiptPanel key={`${mode}-${doc.id}`} mode={mode} doc={doc} orderField={orderField} partyTargets={partyTargets} stores={stores} bins={bins} canEdit={canEdit} today={today} /> : null}
    </div>
  );
}
