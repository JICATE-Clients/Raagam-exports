/**
 * Which half of a {code, name} record NAMES it, and how the other half rides
 * along. The one definition — `RecordPicker` renders from it and
 * `scripts/check-picker-identity.mts` proves it — so a call site cannot be
 * reasoning about a different rule from the one that ships.
 */

/**
 * `"name"` — the default and the house rule: the closed field AND the list show
 * the name, and nothing else. Codes are backend-only (client 2026-07-23), so a
 * Vendor field reads `Kandagiri Spinning`, not `VKS — Kandagiri Spinning` and
 * not `Kandagiri Spinning   VKS`.
 *
 * `"code"` — for a record whose NUMBER is its identity: an SC No, an Enquiry No.
 * There the "name" is a property of the document (its customer), not its name,
 * so showing it alone leaves the operator unable to tell two rows apart —
 * the Garment Order Amendment screen's `SCNo` field listed five rows all reading
 * `Aurelia Retail` (client 2026-08-10). `currency-picker.tsx` already does this
 * for the same reason: an ISO code IS the currency.
 *
 * ## `"name-only"` IS GONE, BECAUSE `"name"` NOW MEANS WHAT IT MEANT
 *
 * It existed for one thing — suppressing the code beside the name — and that is
 * now the behaviour of the default. Keeping a second word for it would leave two
 * ways to say one thing, which is how `employee-picker.tsx` ended up
 * hand-rolling `sublabel: i.code` and bypassing this file entirely.
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
/**
 * The longest an auto-generated code can be — `generateUniqueCode` slices to 10
 * (`lib/masters/auto-code.ts`). Read from there in prose rather than imported,
 * because that module is server-side and this one runs in the browser.
 */
const AUTO_CODE_MAX = 10;

/** Uppercase with every non-alphanumeric removed — what `generateUniqueCode` does. */
function squash(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export function redundantBeside(other: string, primary: string): boolean {
  if (!other) return true;
  const o = other.toUpperCase();
  const p = primary.toUpperCase();
  if (o === p || p.includes(o)) return true;

  /**
   * ## AN AUTO-GENERATED CODE IS THE NAME AGAIN, WITH THE SPACES TAKEN OUT
   *
   * Client 2026-08-31, screenshot 2558: the Customer list read
   * `AARSAN AMERICAS LLC   AARSANAMER` and `ASMARA   ASMARA3` — *"customer value
   * showing two times ... no need that second time customer name ... this kind
   * of this is a lot of place, fix it global"*.
   *
   * `generateUniqueCode` builds the code FROM the name: uppercase, strip
   * everything non-alphanumeric, truncate to `AUTO_CODE_MAX`, then a collision
   * integer. So it is not a second fact about the record — it is the first one,
   * squashed. And **removing the spaces is exactly what defeats the containment
   * guard above**: `"AARSAN AMERICAS LLC".includes("AARSANAMER")` is false.
   *
   * ## WHY THIS RATHER THAN MAKING `name-only` THE DEFAULT
   *
   * That was the other way to answer "fix it global", and it is worse. The
   * sublabel is also how a row is FOUND — `DataPicker` searches `label +
   * sublabel` — so defaulting to `name-only` would silently drop every code from
   * search, including the ones operators actually type: an HSN, an account head,
   * a ledger code. Those are not repeats of the name and were never the
   * complaint. This clause removes exactly the duplication that was reported and
   * leaves every code that carries information.
   *
   * ## THE LENGTH RULE IS WHAT SEPARATES THEM
   *
   * A derived code is either the WHOLE squashed name (short names) or a
   * `AUTO_CODE_MAX`-character truncation of it (long ones) — never a two-letter
   * prefix. So a match only counts when it is at least
   * `min(name length, AUTO_CODE_MAX)` characters. Without that floor, `AH001`
   * beside `AH Sundry Debtors` would fold on the shared `AH` and a real account
   * code would vanish.
   *
   * The trailing-digit strip is the collision suffix (`ASMARA` → `ASMARA3`), and
   * it is guarded on a non-empty remainder: a purely numeric code like an HSN
   * `6109` strips to `""`, and an empty prefix matches everything.
   */
  const os = squash(other);
  const ps = squash(primary);
  if (!os || !ps) return false;
  const floor = Math.min(ps.length, AUTO_CODE_MAX);
  if (ps.startsWith(os)) return os.length >= floor;
  const base = os.replace(/[0-9]+$/, "");
  return !!base && ps.startsWith(base) && base.length >= floor;
}

/**
 * What one picker row displays, and what it can be FOUND by:
 *
 *   `label`    — the closed field and the list
 *   `sublabel` — muted beside the label, IN THE LIST ONLY, and only for a
 *                code-led row (`data-picker.tsx` renders the trigger from
 *                `label` alone, which is why a code-identified record must put
 *                its code THERE and not in the sublabel)
 *   `search`   — matched by the filter and rendered NOWHERE
 *
 * The third field is what let the name-led branch stop printing codes without
 * making them unfindable. See the note inside.
 */
export function pickerIdentityParts(
  code: string | null | undefined,
  name: string | null | undefined,
  identity: PickerIdentity = "name",
): { label: string; sublabel: string | null; search: string | null } {
  const c = (code ?? "").trim();
  const n = (name ?? "").trim();

  /**
   * ## A NAME-LED ROW NO LONGER DISPLAYS ITS CODE AT ALL
   *
   * Client 2026-08-31, screenshot 2571 — the Merchandiser field listing
   * `SAMPLE MERCHANDISER   EMP-MERCH-01`: *"already I told, no need to add that
   * sub-name behind the value … this is already we fixed in customer field,
   * again it's happening in merchandiser field … we need to fix it globally."*
   *
   * THIS IS THE THIRD TIME AND THE RULE IS WHAT WAS WRONG, NOT THE CALL SITE.
   * Material (08-28, screenshot 2531) was answered with a `name-only` opt-in at
   * one call site. Customer (08-31, screenshot 2558) was answered with the
   * `redundantBeside` auto-code clause below. Both were narrower than the
   * instruction, so the next field with a code that is not a squashed copy of
   * its name reported the same bug again — and `EMP-MERCH-01` is exactly that:
   * hand-typed, unrelated to the name, so every duplication guard correctly let
   * it through. AGENTS.md: *"A per-component fix for a contract-level rule
   * always leaves a remainder."*
   *
   * ## THE OBJECTION THAT KEPT THIS NARROW, AND WHY IT NO LONGER HOLDS
   *
   * This file used to argue against exactly this change: *"the sublabel is also
   * how a row is FOUND — `DataPicker` searches `label + sublabel` — so
   * defaulting to name-only would silently drop every code from search,
   * including the ones operators actually type: an HSN, an account head, a
   * ledger code."*
   *
   * That was true and it is now answered rather than overruled. The objection
   * assumed DISPLAY and SEARCH are the same string. They are separated: the code
   * is returned as `search`, which the pickers add to their filter and render
   * NOWHERE. An operator can still type `EMP-MERCH-01`, or an HSN, or a ledger
   * code, and land on the row. Nothing is lost — the code simply stops being
   * printed at the operator.
   *
   * `identity: "code"` is untouched, and the distinction is the whole shape of
   * every complaint so far: each one has been a CODE shown after a NAME. A NAME
   * shown after a code was never reported — it was *requested* (2026-08-10), and
   * it is what stops five SC No rows all reading `Aurelia Retail`.
   */
  if (identity !== "code") {
    // `n || c` keeps a codeless row from rendering a blank field: an order with
    // no number still shows its customer.
    return { label: n || c, sublabel: null, search: c || null };
  }

  // `&& c` is the same fallback in the other direction.
  const codeLeads = !!c;
  const primary = codeLeads ? c : n;
  const other = codeLeads ? n : c;
  return {
    label: primary,
    sublabel: redundantBeside(other, primary) ? null : other,
    search: null,
  };
}
