"use client";

import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldRow } from "@/components/ui/field";
import { DOC_FRAME } from "@/components/purchase/doc-surface";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";
import type { KnittingOrder, KnittingOrderListRow } from "@/lib/production/knitting-types";
import { KnittingReceiptPanel } from "./knitting-receipt-panel";

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
  doc,
  stores,
  bins,
  canEdit,
  today,
}: {
  mode: "fabric" | "yarn_return";
  orders: KnittingOrderListRow[];
  doc: KnittingOrder | null;
  stores: StoreOption[];
  bins: BinOption[];
  canEdit: boolean;
  today: string;
}) {
  const router = useRouter();
  const base = mode === "fabric" ? "/process/knitting-receipts/new" : "/process/knitting-returns/new";
  return (
    <div className={`${DOC_FRAME} space-y-4 p-4`} data-focus-scope="">
      <FieldRow>
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
      </FieldRow>
      {doc ? <KnittingReceiptPanel key={`${mode}-${doc.id}`} mode={mode} doc={doc} stores={stores} bins={bins} canEdit={canEdit} today={today} /> : null}
    </div>
  );
}
