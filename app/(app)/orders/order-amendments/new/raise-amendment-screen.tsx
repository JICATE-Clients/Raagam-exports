"use client";

/**
 * Orders ▸ Order Amendments ▸ Raise Amendment — the door, as a PAGE
 * (user 2026-09-22, screenshot 3023: "the raise request display as popup
 * panel — make it as page screen"; it was a `size="sm"` sheet until then).
 *
 * Four answers and the entry exists: WHICH order (RE No), WHO asked (origin),
 * WHAT KIND of change (one or more Change Categories) and WHY (remarks,
 * mandatory). The entry no, the date, the frozen baseline and the scope are
 * the server's; the page previews the scope so the operator sees what a
 * category opens BEFORE committing to it — the same union the database
 * freezes (`unionScope` mirrors `order_amendment_record`).
 *
 * AMENDING AGAIN (0618): an order already under an open entry can be picked;
 * the new entry SUPERSEDES the open one and carries the union of both entries'
 * categories. The page says so beside the picked order, so "raise" is never
 * read as "replace what was already opened".
 *
 * A page-level editor with a Save of its own: `data-focus-scope` on the form
 * wrapper so Tab stays inside it (AGENTS.md, "Tab lands on fields"), and
 * `useUnsavedGuard` while anything is typed.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate } from "@/lib/format";
import { today } from "@/lib/calendar";
import {
  AMENDMENT_ENTRY_TYPES,
  AMENDMENT_ORIGINS,
  amendmentTypesLabel,
  openAreasOf,
  unionScope,
  type AmendmentEntryType,
  type AmendmentOrigin,
} from "@/lib/orders/amendments/amendment-entry";
import { raiseOrderAmendment } from "@/lib/orders/order-amendments/actions";
import type { AmendableOrder } from "@/lib/orders/order-amendments/service";

/** What a preview line says the selection opens — the areas' own words. */
const AREA_WORDS: Record<string, string> = {
  orderinfo: "Order Info",
  styles: "Style(s)",
  colors: "Colour / Print Details",
  combos: "Combos",
  packtypes: "Pack type(s)",
  prices: "Prices",
  quantities: "Quantities",
  approvalqty: "Approval Qty",
  delivery_date: "the delivery date",
  excess_pct: "the excess %",
  money_terms: "the currency and ex-rate",
};

export function RaiseAmendmentScreen({
  orders,
  initialOrderId,
}: {
  /** Approved and amending orders — the server's list (`listAmendableOrders`). */
  orders: AmendableOrder[];
  /** From `?order=<id>` (the register's Amend, the order list's [Amend]) — pre-picked, still changeable. */
  initialOrderId?: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [orderId, setOrderId] = useState<string | null>(
    initialOrderId && orders.some((o) => o.id === initialOrderId) ? initialOrderId : null,
  );
  const [source, setSource] = useState<AmendmentOrigin>(AMENDMENT_ORIGINS[0].value);
  const [types, setTypes] = useState<AmendmentEntryType[]>([]);
  const [remarks, setRemarks] = useState("");
  const [tried, setTried] = useState(false);

  const dirty = !!orderId || types.length > 0 || remarks.trim() !== "";
  useUnsavedGuard(dirty || isPending);

  const pickerRows = useMemo<PickerRow[]>(
    () =>
      orders.map((o) => ({
        id: o.id,
        label: o.re_no ?? o.code ?? o.id.slice(0, 8),
        sublabel: [
          o.customer_name,
          o.amending ? `amending — ${o.amending.entry_no ?? "open entry"}` : o.delivery_date ? `Delivery ${fmtDate(o.delivery_date)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        code: o.code,
      })),
    [orders],
  );
  const picked = orders.find((o) => o.id === orderId) ?? null;

  /* THE PREVIEW: what this selection will open, from the same union rule the
     database freezes — including the categories an open entry already
     carries, since a second raise supersedes it with the union. */
  const opens = useMemo(() => {
    const all = [...(picked?.amending?.types ?? []), ...types];
    if (all.length === 0) return null;
    const scope = unionScope(all);
    const areas = openAreasOf(scope).map((a) => AREA_WORDS[a] ?? a);
    const boms = [
      scope.order_fabric_boms ? "the Fabric BOM" : null,
      scope.material_bom_amendments ? "the Material BOM" : null,
    ].filter((x): x is string => !!x);
    return [...areas, ...boms];
  }, [types, picked]);

  const orderError = tried && !orderId ? "Pick the order to amend" : undefined;
  const typesError = tried && types.length === 0 ? "Pick at least one Change Category" : undefined;
  const remarksError = tried && remarks.trim() === "" ? "Say why this order is being amended" : undefined;
  const ready = !!orderId && types.length > 0 && remarks.trim() !== "";

  function toggleType(t: AmendmentEntryType, on: boolean) {
    setTypes((prev) => (on ? (prev.includes(t) ? prev : [...prev, t]) : prev.filter((x) => x !== t)));
  }

  function raise() {
    if (!ready || !orderId) {
      setTried(true);
      return;
    }
    startTransition(async () => {
      const res = await raiseOrderAmendment({ order_id: orderId, origin: source, types, remarks: remarks.trim() });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(
        picked?.amending
          ? `Amendment ${res.entryNo ?? ""} raised — it supersedes ${picked.amending.entry_no ?? "the open entry"} and adds the categories picked`
          : `Amendment ${res.entryNo ?? ""} raised — the order is open for the categories picked`,
      );
      router.push(res.id ? `/orders/order-amendments/${res.id}` : "/orders/order-amendments");
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Raise Amendment"
        description="Name the approved order, who asked, what kind of change and why. Only the categories picked are unlocked; the revised budget then goes back for approval."
        actions={
          <Button variant="outline" size="md" onClick={() => router.push("/orders/order-amendments")}>
            ← Back
          </Button>
        }
      />

      {/* ONE CARD, WIDTH-LAID-OUT (raagam-screen-layout): row 1 is four fields
          off the width steps — Entry No `code` 144 + Date `code` 144 + RE No
          `party` 200 + Origin `code` 144, three 12px gaps = 668px — inside a
          `max-w-[46rem]` (736px) cap with the card's own padding; the category
          grid and the remarks take the full card width beneath. */}
      <Card className="max-w-[46rem]">
        <CardBody>
          <form
            data-focus-scope
            onSubmit={(e) => {
              e.preventDefault();
              raise();
            }}
          >
            <FieldRow>
              <Field label="Entry No" w="code" htmlFor="ra-no">
                <Input id="ra-no" readOnly value="(auto)" />
              </Field>
              <Field label="Date" w="code" htmlFor="ra-date">
                <Input id="ra-date" readOnly value={fmtDate(today())} />
              </Field>
              <Field label="Order Ref No (RE No)" required w="party" htmlFor="ra-order" error={orderError}>
                {/* `compact`: the Field draws the label; the picker's own would
                    print it twice (screenshot 3021). */}
                <DataPicker
                  id="ra-order"
                  label="Order Ref No"
                  title="Orders that can be amended"
                  compact
                  rows={pickerRows}
                  value={orderId}
                  onChange={setOrderId}
                  required
                  invalid={!!orderError}
                  emptyHint="No order to amend — an amendment is raised on an order whose budget has been approved. An open order is edited directly."
                />
              </Field>
              <Field label="Origin" required w="code" htmlFor="ra-origin">
                <Select id="ra-origin" required value={source} onChange={(e) => setSource(e.target.value as AmendmentOrigin)}>
                  {AMENDMENT_ORIGINS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
            {picked && (
              <p className="mt-1 text-xs text-muted-foreground">
                {picked.customer_name ?? "—"}
                {picked.budget_code ? ` · budget ${picked.budget_code}` : ""}
                {picked.approved_at ? ` · approved ${fmtDate(picked.approved_at)}` : ""}
                {picked.delivery_date ? ` · delivery ${fmtDate(picked.delivery_date)}` : ""}
              </p>
            )}
            {picked?.amending && (
              <p className="mt-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning" role="status">
                Amendment {picked.amending.entry_no ?? ""} is already open on this order ({amendmentTypesLabel(picked.amending.types)}).
                This entry will supersede it and keep those categories open along with the ones you pick — nothing already
                changed is lost or re-locked.
              </p>
            )}

            {/* THE CHANGE CATEGORY, A MULTI-SELECT (spec §2): checkboxes, two
                columns, each with a one-line hint of what it opens. */}
            <Field label="Change Category" required className="mt-4" error={typesError}>
              <div
                className="grid gap-x-6 gap-y-2 sm:grid-cols-2"
                role="group"
                aria-label="Change Category"
              >
                {AMENDMENT_ENTRY_TYPES.map((t) => {
                  const on = types.includes(t.value);
                  const already = picked?.amending?.types.includes(t.value) ?? false;
                  return (
                    <label key={t.value} className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-primary"
                        checked={on || already}
                        disabled={already}
                        onChange={(e) => toggleType(t.value, e.target.checked)}
                      />
                      <span>
                        <span className="font-medium">{t.label}</span>
                        {already && <span className="ml-1 text-xs text-muted-foreground">(already open)</span>}
                        <span className="block text-xs text-muted-foreground">{t.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>
            {opens && (
              <p className="mt-2 rounded-md border border-info bg-info-soft px-3 py-2 text-xs text-info" role="status">
                Opens {opens.length > 0 ? opens.join(", ") : "nothing"} — everything else stays as approved.
              </p>
            )}

            {/* Mandatory, holds the cursor while blank. Capitals stay the
                default: the Textarea exemption is withdrawn (AGENTS.md).
                spell-suggest: exempt -- a Textarea: ↓ and Enter mean next line / new line. */}
            <Field label="Amendment Remarks" required htmlFor="ra-remarks" className="mt-4" error={remarksError}>
              <Textarea id="ra-remarks" rows={3} required value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>

            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3" data-focus-region="footer">
              <Button type="button" variant="outline" size="md" onClick={() => router.push("/orders/order-amendments")} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" size="md" disabled={isPending}>
                {isPending ? "Raising…" : "Raise amendment"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
