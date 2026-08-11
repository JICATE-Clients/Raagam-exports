/**
 * Which half of a {code, name} record NAMES it, and how the other half rides
 * along. The one definition — `RecordPicker` renders from it and
 * `scripts/check-picker-identity.mts` proves it — so a call site cannot be
 * reasoning about a different rule from the one that ships.
 */

/**
 * `"name"` — the default and the house rule: the closed field shows the name and
 * the code rides as the row's sublabel. Codes are backend-only
 * (client 2026-07-23), so a Vendor field reads `Kandagiri Spinning`, not
 * `VKS — Kandagiri Spinning`.
 *
 * `"code"` — for a record whose NUMBER is its identity: an SC No, an Enquiry No.
 * There the "name" is a property of the document (its customer), not its name,
 * so showing it alone leaves the operator unable to tell two rows apart —
 * the Garment Order Amendment screen's `SCNo` field listed five rows all reading
 * `Aurelia Retail` (client 2026-08-10). `currency-picker.tsx` already does this
 * for the same reason: an ISO code IS the currency.
 */
export type PickerIdentity = "name" | "code";

/**
 * A value adds nothing beside another when it IS that one, or is already inside
 * it.
 *
 * The same two guards `lookupLabel()` carries in `lib/masters/extras-types.ts`,
 * and they are load-bearing three ways: several call sites pass `code` and
 * `name` as the same value (TA Plan's SC No is `order_number` twice); several
 * pass `name: x.name ?? x.short_name`, so the fallback IS the code (Ports,
 * Destination, Size Group); and three screens pre-compose `"CODE — NAME"` into
 * `name` to work around the code being dropped (`material-hsn-assign-screen`,
 * `process-hsn-assign-screen`, `default-account-head-screen`) — without the
 * containment guard those would read `6109 — T-SHIRTS   6109`.
 */
export function redundantBeside(other: string, primary: string): boolean {
  if (!other) return true;
  const o = other.toUpperCase();
  const p = primary.toUpperCase();
  return o === p || p.includes(o);
}

/**
 * What one picker row displays: `label` in the closed field and the list,
 * `sublabel` muted beside it in the list only (`data-picker.tsx` renders the
 * trigger from `label` alone, which is why a code-identified record must put its
 * code THERE and not in the sublabel).
 */
export function pickerIdentityParts(
  code: string | null | undefined,
  name: string | null | undefined,
  identity: PickerIdentity = "name",
): { label: string; sublabel: string | null } {
  const c = (code ?? "").trim();
  const n = (name ?? "").trim();
  // `&& c` is the fallback that keeps a codeless row from rendering a blank
  // field: an order with no number still shows its customer.
  const codeLeads = identity === "code" && !!c;
  const primary = codeLeads ? c : n;
  const other = codeLeads ? n : c;
  return { label: primary, sublabel: redundantBeside(other, primary) ? null : other };
}
