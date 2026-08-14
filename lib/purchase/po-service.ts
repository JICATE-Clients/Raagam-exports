import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Vendor,
  Rfq,
  RfqLine,
  RfqQuote,
  RfqQuoteLine,
  PurchaseOrder,
  PoLineItem,
  PoItemGroup,
  PoSizeDelivery,
  PoDeliverySize,
  PoItemSizeDelivery,
  PoAdditionalCharge,
} from "@/lib/purchase/types";
import type { Currency, Item, Uom } from "@/lib/masters/types";
import { withCreators } from "@/lib/created-by";

// ---------- derived types ----------

export type VendorForPicker = { id: string; name: string; code: string | null };
export type BudgetForPicker = {
  id: string;
  code: string | null;
  name: string;
  currency_code: string | null;
};
export type LocationForPicker = { id: string; code: string; name: string };
export type BudgetLineRow = {
  id: string;
  description: string;
  quantity: number;
  unit_cost: number;
  sort_order: number;
};
export type RfqQuoteWithVendor = RfqQuote & { vendor_name: string | null };
export type RfqWithDetails = Rfq & {
  lines: RfqLine[];
  quotes: RfqQuoteWithVendor[];
};
export type PoWithVendor = PurchaseOrder & { vendor_name: string | null };
export type PoWithDetails = PoWithVendor & {
  lines: PoLineItem[];
  item_groups: PoItemGroup[];
  additional_charges: PoAdditionalCharge[];
};

// ---------- vendors ----------

export async function listVendors(): Promise<Vendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("*")
    .order("name");
  return withCreators((data ?? []) as Vendor[]);
}

export async function getVendor(id: string): Promise<Vendor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as Vendor | null;
}

export async function getVendorsForPicker(): Promise<VendorForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as VendorForPicker[];
}

// ---------- RFQs ----------

export async function listRfqs(): Promise<Rfq[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rfqs")
    .select("*")
    .order("created_at", { ascending: false });
  return withCreators((data ?? []) as Rfq[]);
}

export async function getRfq(id: string): Promise<RfqWithDetails | null> {
  const supabase = await createClient();

  const { data: rfq } = await supabase
    .from("rfqs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!rfq) return null;

  const [{ data: lines }, { data: quotes }] = await Promise.all([
    supabase
      .from("rfq_lines")
      .select("*")
      .eq("rfq_id", id)
      .order("sort_order"),
    supabase
      .from("rfq_quotes")
      .select("*, vendors(name)")
      .eq("rfq_id", id)
      .order("created_at"),
  ]);

  const mappedQuotes: RfqQuoteWithVendor[] = (
    (quotes ?? []) as Record<string, unknown>[]
  ).map((q) => {
    const vendor = q.vendors as { name: string } | null;
    const { vendors: _v, ...rest } = q;
    void _v;
    return {
      ...(rest as unknown as RfqQuote),
      vendor_name: vendor?.name ?? null,
    };
  });

  return {
    ...(rfq as Rfq),
    lines: (lines ?? []) as RfqLine[],
    quotes: mappedQuotes,
  };
}

// ---------- RFQ quote lines (per-line vendor prices) ----------

export async function getRfqQuoteLines(
  quoteId: string,
): Promise<RfqQuoteLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rfq_quote_lines")
    .select("*")
    .eq("rfq_quote_id", quoteId)
    .order("created_at");
  return (data ?? []) as RfqQuoteLine[];
}

export type QuoteComparisonRow = {
  rfq_line_id: string;
  description: string;
  quantity: number;
  quotes: {
    quote_id: string;
    vendor_id: string;
    vendor_name: string | null;
    unit_price: number;
    amount: number;
    lead_days: number | null;
  }[];
};

export async function getRfqComparison(
  rfqId: string,
): Promise<QuoteComparisonRow[]> {
  const supabase = await createClient();

  const [{ data: lines }, { data: quotes }, { data: quoteLines }] =
    await Promise.all([
      supabase
        .from("rfq_lines")
        .select("*")
        .eq("rfq_id", rfqId)
        .order("sort_order"),
      supabase
        .from("rfq_quotes")
        .select("id, vendor_id, vendors(name)")
        .eq("rfq_id", rfqId),
      supabase
        .from("rfq_quote_lines")
        .select("*, rfq_quotes!inner(rfq_id)")
        .eq("rfq_quotes.rfq_id", rfqId),
    ]);

  const rfqLines = (lines ?? []) as RfqLine[];
  const rfqQuotes = (quotes ?? []) as Record<string, unknown>[];
  const allQuoteLines = (quoteLines ?? []) as Record<string, unknown>[];

  const quoteMap = new Map(
    rfqQuotes.map((q) => [
      q.id as string,
      {
        vendor_id: q.vendor_id as string,
        vendor_name: (q.vendors as { name: string } | null)?.name ?? null,
      },
    ]),
  );

  return rfqLines.map((line) => {
    const lineQuotes = allQuoteLines
      .filter((ql) => (ql as { rfq_line_id: string }).rfq_line_id === line.id)
      .map((ql) => {
        const quoteId = (ql as { rfq_quote_id: string }).rfq_quote_id;
        const vendor = quoteMap.get(quoteId);
        return {
          quote_id: quoteId,
          vendor_id: vendor?.vendor_id ?? "",
          vendor_name: vendor?.vendor_name ?? null,
          unit_price: (ql as { unit_price: number }).unit_price ?? 0,
          amount: (ql as { amount: number }).amount ?? 0,
          lead_days: (ql as { lead_days: number | null }).lead_days ?? null,
        };
      });

    return {
      rfq_line_id: line.id,
      description: line.description,
      quantity: line.quantity,
      quotes: lineQuotes,
    };
  });
}

// ---------- purchase orders ----------

export async function listPurchaseOrders(): Promise<PoWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*, vendors(name)")
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as Record<string, unknown>[]).map((row) => {
    const vendor = row.vendors as { name: string } | null;
    const { vendors: _v, ...rest } = row;
    void _v;
    return {
      ...(rest as unknown as PurchaseOrder),
      vendor_name: vendor?.name ?? null,
    };
  }));
}

export async function getPurchaseOrder(
  id: string,
): Promise<PoWithDetails | null> {
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, vendors(name)")
    .eq("id", id)
    .maybeSingle();
  if (!po) return null;

  const [{ data: lines }, { data: groups }, { data: charges }] =
    await Promise.all([
      supabase
        .from("po_line_items")
        .select("*")
        .eq("purchase_order_id", id)
        .order("sort_order"),
      supabase
        .from("po_item_groups")
        .select("*")
        .eq("purchase_order_id", id)
        .order("sort_order"),
      supabase
        .from("po_additional_charges")
        .select("*")
        .eq("purchase_order_id", id)
        .order("sort_order"),
    ]);

  const poRow = po as Record<string, unknown>;
  const vendor = poRow.vendors as { name: string } | null;
  const { vendors: _v, ...poRest } = poRow;
  void _v;

  return {
    ...(poRest as unknown as PurchaseOrder),
    vendor_name: vendor?.name ?? null,
    lines: (lines ?? []) as PoLineItem[],
    item_groups: (groups ?? []) as PoItemGroup[],
    additional_charges: (charges ?? []) as PoAdditionalCharge[],
  };
}

// ---------- PO hierarchy queries ----------

export async function getPoSizeDeliveries(
  lineItemId: string,
): Promise<PoSizeDelivery[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("po_size_deliveries")
    .select("*")
    .eq("po_line_item_id", lineItemId)
    .order("sort_order");
  return (data ?? []) as PoSizeDelivery[];
}

export async function getPoDeliverySizes(
  sizeDeliveryId: string,
): Promise<PoDeliverySize[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("po_delivery_sizes")
    .select("*")
    .eq("po_size_delivery_id", sizeDeliveryId)
    .order("sort_order");
  return (data ?? []) as PoDeliverySize[];
}

export async function getPoItemSizeDeliveries(
  lineItemId: string,
): Promise<PoItemSizeDelivery[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("po_item_size_deliveries")
    .select("*")
    .eq("po_line_item_id", lineItemId)
    .order("sort_order");
  return (data ?? []) as PoItemSizeDelivery[];
}

// ---------- shared pickers ----------

/**
 * Approved budgets, for the Budget picker on the PO and RFQ forms.
 *
 * IT RETURNS AN EMPTY LIST IN THIS DATABASE, AND THAT IS NOT A BUG TO CHASE.
 * `budgets` was dropped by 0332 with the rest of the Planning module. The
 * rebuild (0369) declares it again but is UNAPPLIED — every number in the
 * 0368-0373 range collides with a live non-planning migration, which
 * `doc/orders-six-step.md` records as the reason the whole rebuild is parked.
 *
 * So PostgREST returns a missing-relation error, `data` is null, and the caller
 * gets `[]`. Both forms hide the Budget field entirely when the list is empty
 * rather than rendering a dropdown with nothing in it, so the operator sees no
 * broken control — which is why this has been quiet.
 *
 * Left in place rather than removed: `purchase_orders.budget_id` and
 * `purchase_indents.budget_id` still exist (0332 only dropped the table they
 * point at), and the day a budget table returns this is the query that feeds
 * them. Deleting it would mean rediscovering the wiring instead of un-parking it.
 *
 * The step-5 Budget the client asked for is a DIFFERENT table —
 * `order_budgets`, hanging off the garment order — see doc/orders-six-step.md.
 * Do not resurrect this one to satisfy that requirement.
 */
export async function getBudgetsForPicker(): Promise<BudgetForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budgets")
    .select("id, code, name, currency_code")
    .eq("status", "approved")
    .order("name");
  return (data ?? []) as BudgetForPicker[];
}

/**
 * Lines of an approved budget, to prefill a PO.
 *
 * WORSE OFF THAN ITS SIBLING ABOVE: `budget_lines` was dropped by 0332 and is
 * **never re-declared anywhere** — not even in the unapplied 0369, whose child
 * tables are the different `budget_purchases` / `budget_processes` /
 * `budget_cmts` shape. So this cannot come back by un-parking the rebuild; it
 * would need writing.
 *
 * Unreachable in practice, because the picker that supplies `budgetId` is empty
 * (see above). `ASSUMPTIONS.md` still describes "PO from budget prefills lines
 * from budget_lines" as live behaviour; it has not been true since 0332.
 */
export async function getBudgetLines(
  budgetId: string,
): Promise<BudgetLineRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budget_lines")
    .select("id, description, quantity, unit_cost, sort_order")
    .eq("budget_id", budgetId)
    .order("sort_order");
  return (data ?? []) as BudgetLineRow[];
}

export async function getCurrencies(): Promise<Currency[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("currencies")
    .select("code, name, symbol")
    .order("name");
  return (data ?? []) as Currency[];
}

export async function getLocations(): Promise<LocationForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as LocationForPicker[];
}

export async function getItems(): Promise<Item[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, code, name, category, uom_id, is_active")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Item[];
}

export async function getUoms(): Promise<Uom[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uoms")
    .select("id, code, name, is_active")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Uom[];
}

/** A garment order a PO line can be bought for (0424). */
export type OrderForPicker = { id: string; order_number: string | null };

/**
 * Orders a purchase can be raised against.
 *
 * Cancelled and closed are excluded: buying for an order nobody is making is
 * the mistake, not a case to support. `listOrderOptions` on the Material BOM
 * side makes the same call, so the two lists agree about what is live.
 */
export async function getOrdersForPicker(): Promise<OrderForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number")
    .not("status", "in", "(cancelled,closed)")
    .order("order_number", { ascending: false });
  return (data ?? []) as OrderForPicker[];
}
