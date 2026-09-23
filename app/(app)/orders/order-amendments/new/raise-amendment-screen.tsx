"use client";

/**
 * Orders ▸ Order Amendments ▸ Raise Amendment — the door, as a PAGE
 * (user 2026-09-22, screenshot 3023: "the raise request display as popup
 * panel — make it as page screen"; it was a `size="sm"` sheet until then).
 *
 * Four answers and the entry exists: WHICH order (RE No), WHO asked (origin),
 * WHICH MODULES the change touches and WHY (remarks, mandatory).
 *
 * THE MODULE CATEGORY (doc/order/amenment update.md §2, 0619): Order Entry ·
 * Material BOM · Fabric BOM · Order Budget, the spec's four checkboxes in its
 * order. Only the modules ticked are unlocked — "selecting Order Entry and
 * Fabric BOM keeps Material BOM read-only". Order Entry carries its own detail
 * (PO Qty, Delivery Date, FOB Price, Color Combos), at least one required, so
 * the unlock inside the order stays as narrow as the change. A BOM that is not
 * ticked is still RECALCULATED when quantities or colourways move — its
 * figures, never its authored rows — and the preview says so. The entry no, the date, the frozen baseline and the scope are
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
  AMENDMENT_MODULES,
  AMENDMENT_ORIGINS,
  ORDER_CHANGE_KINDS,
  areaOpen,
  areaRecalculable,
  entryScopeLabel,
  kindsForSelection,
  moduleSelectionProblem,
  modulesOf,
  openAreasOf,
  unionScope,
  type AmendmentModule,
  type AmendmentOrigin,
  type OrderChangeKind,
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
  const [modules, setModules] = useState<AmendmentModule[]>([]);
  const [orderKinds, setOrderKinds] = useState<OrderChangeKind[]>([]);
  const [remarks, setRemarks] = useState("");
  const [tried, setTried] = useState(false);

  const dirty = !!orderId || modules.length > 0 || remarks.trim() !== "";
  useUnsavedGuard(dirty || isPending);

  const pickerRows = useMemo<PickerRow[]>(
    () =>
      orders.map((o) => ({
        id: o.id,
        label: o.re_no ?? o.code ?? o.id.slice(0, 8),
        sublabel: [
          o.customer_name,
          o.amending ? `under revision — ${o.amending.entry_no ?? "open entry"}` : o.delivery_date ? `Delivery ${fmtDate(o.delivery_date)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        code: o.code,
      })),
    [orders],
  );
  const picked = orders.find((o) => o.id === orderId) ?? null;

  /* WHAT AN OPEN ENTRY ALREADY CARRIES — a second raise supersedes it with
     the union (0618), so its modules and kinds read as ticked and locked. */
  const alreadyKinds = useMemo(() => picked?.amending?.types ?? [], [picked]);
  const alreadyModules = useMemo(() => modulesOf(alreadyKinds), [alreadyKinds]);

  /* THE PREVIEW: what this selection will open, from the same union rule the
     database freezes — including the kinds an open entry already carries. */
  const opens = useMemo(() => {
    const kinds = [...alreadyKinds, ...kindsForSelection({ modules, orderKinds })];
    if (kinds.length === 0) return null;
    const scope = unionScope(kinds);
    const edit = [
      ...openAreasOf(scope).map((a) => AREA_WORDS[a] ?? a),
      ...(areaOpen(scope, "material_bom") ? ["the Material BOM"] : []),
      ...(areaOpen(scope, "fabric_bom") ? ["the Fabric BOM"] : []),
      ...(areaOpen(scope, "budget") ? ["the Order Budget's heads and rates"] : []),
    ];
    const recalc = (["material_bom", "fabric_bom"] as const)
      .filter((a) => !areaOpen(scope, a) && areaRecalculable(scope, a))
      .map((a) => (a === "material_bom" ? "the Material BOM" : "the Fabric BOM"));
    return { edit, recalc };
  }, [modules, orderKinds, alreadyKinds]);

  const orderError = tried && !orderId ? "Pick the order to revise" : undefined;
  const selectionProblem = moduleSelectionProblem({
    modules: [...new Set([...alreadyModules, ...modules])],
    orderKinds: [...alreadyKinds, ...orderKinds],
  });
  const typesError = tried ? (selectionProblem ?? undefined) : undefined;
  const remarksError = tried && remarks.trim() === "" ? "Say why this order is being revised" : undefined;
  /* Something NEW must be picked: a second raise that adds nothing would only
     re-number the open entry. */
  const addsSomething = kindsForSelection({ modules, orderKinds }).some((k) => !alreadyKinds.includes(k));
  const ready = !!orderId && !selectionProblem && addsSomething && remarks.trim() !== "";

  function toggleModule(m: AmendmentModule, on: boolean) {
    setModules((prev) => (on ? (prev.includes(m) ? prev : [...prev, m]) : prev.filter((x) => x !== m)));
    if (m === "order_entry" && !on) setOrderKinds([]);
  }
  function toggleKind(k: OrderChangeKind, on: boolean) {
    setOrderKinds((prev) => (on ? (prev.includes(k) ? prev : [...prev, k]) : prev.filter((x) => x !== k)));
    if (on) setModules((prev) => (prev.includes("order_entry") ? prev : [...prev, "order_entry"]));
  }

  function raise() {
    if (!ready || !orderId) {
      setTried(true);
      return;
    }
    startTransition(async () => {
      /* An Order Entry tick with no NEW detail (the open entry already carries
         its kinds) is not re-sent: the union keeps what was open. */
      const sendModules = modules.filter((m) => m !== "order_entry" || orderKinds.length > 0);
      const res = await raiseOrderAmendment({
        order_id: orderId,
        origin: source,
        modules: sendModules,
        order_kinds: orderKinds,
        remarks: remarks.trim(),
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(
        picked?.amending
          ? `Revision ${res.entryNo ?? ""} raised — it supersedes ${picked.amending.entry_no ?? "the open entry"} and adds the modules picked`
          : `Revision ${res.entryNo ?? ""} raised — the order is open for the modules picked`,
      );
      if (res.vFinalMissing?.length) {
        toastError(
          `The approved version of ${res.vFinalMissing.length} report${res.vFinalMissing.length === 1 ? "" : "s"} could not be frozen — ` +
            "those reports will print the revision's data with a warning until it is decided",
        );
      }
      router.push(res.id ? `/orders/order-amendments/${res.id}` : "/orders/order-amendments");
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Raise Revision"
        description="Name the approved order, who asked, which modules change and why. Only the modules picked are unlocked; the revised budget then goes to the MD for approval."
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
                  title="Orders that can be revised"
                  compact
                  rows={pickerRows}
                  value={orderId}
                  onChange={setOrderId}
                  required
                  invalid={!!orderError}
                  emptyHint="No order to revise — a revision is raised on an order whose budget has been approved. An open order is edited directly."
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
                Revision {picked.amending.entry_no ?? ""} is already open on this order ({entryScopeLabel(picked.amending.types)}).
                This entry will supersede it and keep those modules open along with the ones you pick — nothing already
                changed is lost or re-locked.
              </p>
            )}

            {/* THE MODULE CATEGORY (spec §2): the four modules, in the spec's
                order, each with the spec's own description. Order Entry's
                detail sits beneath it, indented — ticking a detail ticks
                Order Entry, unticking Order Entry clears its detail. */}
            <Field label="Select Module Category to Revise" required className="mt-4" error={typesError}>
              <div className="space-y-2" role="group" aria-label="Module Category">
                {AMENDMENT_MODULES.map((m, i) => {
                  const already = alreadyModules.includes(m.key);
                  const on = already || modules.includes(m.key);
                  return (
                    <div key={m.key}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-primary"
                          checked={on}
                          disabled={already && m.key !== "order_entry"}
                          onChange={(e) => toggleModule(m.key, e.target.checked)}
                        />
                        <span>
                          <span className="font-medium">
                            {i + 1}. {m.label}
                          </span>
                          {already && <span className="ml-1 text-xs text-muted-foreground">(already open)</span>}
                          <span className="ml-1 text-xs text-muted-foreground">({m.hint})</span>
                        </span>
                      </label>
                      {m.key === "order_entry" && on && (
                        <div
                          className="ml-6 mt-1.5 grid gap-x-6 gap-y-1.5 sm:grid-cols-2"
                          role="group"
                          aria-label="What changes on the order"
                        >
                          {ORDER_CHANGE_KINDS.map((k) => {
                            const t = AMENDMENT_ENTRY_TYPES.find((x) => x.value === k);
                            const kAlready = alreadyKinds.includes(k);
                            return (
                              <label key={k} className="flex cursor-pointer items-start gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 accent-primary"
                                  checked={kAlready || orderKinds.includes(k)}
                                  disabled={kAlready}
                                  onChange={(e) => toggleKind(k, e.target.checked)}
                                />
                                <span>
                                  <span>{t?.label ?? k}</span>
                                  {kAlready && <span className="ml-1 text-xs text-muted-foreground">(already open)</span>}
                                  <span className="block text-xs text-muted-foreground">{t?.hint}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Field>
            {opens && (
              <div className="mt-2 space-y-1 rounded-md border border-info bg-info-soft px-3 py-2 text-xs text-info" role="status">
                <p>
                  Unlocks {opens.edit.length > 0 ? opens.edit.join(", ") : "nothing"} — everything else stays read-only, as
                  approved.
                </p>
                {opens.recalc.length > 0 && (
                  <p>
                    {opens.recalc.join(" and ")} stay{opens.recalc.length === 1 ? "s" : ""} read-only, but{" "}
                    {opens.recalc.length === 1 ? "its" : "their"} quantities and weights recalculate automatically when the
                    order is saved.
                  </p>
                )}
              </div>
            )}
            {tried && !selectionProblem && !addsSomething && (
              <p className="mt-1 text-xs text-danger" role="alert">
                Everything picked is already open on this order — tick a module or change it does not carry yet.
              </p>
            )}

            {/* Mandatory, holds the cursor while blank. Capitals stay the
                default: the Textarea exemption is withdrawn (AGENTS.md).
                spell-suggest: exempt -- a Textarea: ↓ and Enter mean next line / new line. */}
            <Field label="Revision Remarks" required htmlFor="ra-remarks" className="mt-4" error={remarksError}>
              <Textarea id="ra-remarks" rows={3} required value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>

            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3" data-focus-region="footer">
              <Button type="button" variant="outline" size="md" onClick={() => router.push("/orders/order-amendments")} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" size="md" disabled={isPending}>
                {isPending ? "Raising…" : "Raise revision"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
