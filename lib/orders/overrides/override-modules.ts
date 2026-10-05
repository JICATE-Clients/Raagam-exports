/**
 * PERMISSION OVERRIDES — the vocabulary (spec: doc/email role system.md;
 * findings: doc/order/permission-override-findings.md). TypeScript twin of
 * 0650's key catalog; `npm run check:permission-overrides` holds the two
 * literals together.
 *
 * An override lets a named user (by email) edit an APPROVED order in place for
 * a limited time. What each KEY opens is not declared here — it is the Raise
 * Revision seed (`AMENDMENT_SCOPE_SEED`, 0604 · 0619) for the key's kind, read
 * as it stands. That seed IS the spec's §4.4 field map, and reusing it is what
 * keeps "Price Change" meaning the same tables for a revision and an override.
 *
 * ONE DIFFERENCE FROM A REVISION, deliberately: `overrideScopeOf` unions the
 * STORED seed only — never `scopeFromJson`, which lays 0627's whole-document
 * overlay on top. A revision opens a picked module whole; an override is
 * exactly as narrow as its key (R-17), or "price change only" would mean
 * "the whole order".
 *
 * Client-safe (no `server-only`): the admin screen, the editors and the
 * checker all read it.
 */

import {
  AMENDMENT_ENTRY_TYPES,
  AMENDMENT_MODULES,
  ORDER_CHANGE_KINDS,
  areaOpen,
  unionScope,
  type AmendmentArea,
  type AmendmentEntryType,
  type AmendmentModule,
  type FrozenScope,
} from "@/lib/orders/amendments/amendment-entry";
import type { StatusTone } from "@/lib/ui/tone";

// ---------------------------------------------------------------------------
// The keys (spec §3.1 → findings §8)
// ---------------------------------------------------------------------------

/** The eight keys, in the Raise Revision screen's order (spec §7.1). */
export const OVERRIDE_KEYS = [
  ...ORDER_CHANGE_KINDS,
  "material_bom",
  "fabric_bom",
  "order_budget",
] as const;
export type OverrideKey = (typeof OVERRIDE_KEYS)[number];

export function isOverrideKey(v: string): v is OverrideKey {
  return (OVERRIDE_KEYS as readonly string[]).includes(v);
}

/** Key → the revision kind whose seed says what it opens. SQL twin:
 *  `permission_override_kind()` (0650). */
export const OVERRIDE_KEY_KIND: Readonly<Record<OverrideKey, AmendmentEntryType>> = {
  qty_addition: "qty_addition",
  qty_cancellation: "qty_cancellation",
  price_change: "price_change",
  delivery_date_ext: "delivery_date_ext",
  combo_colour_change: "combo_colour_change",
  material_bom: "material_bom_revision",
  fabric_bom: "fabric_bom_revision",
  order_budget: "budget_revision",
};

/** Key → the editor it unlocks (the argument `assertOrderWritable` takes). */
export const OVERRIDE_KEY_AREA: Readonly<Record<OverrideKey, AmendmentArea>> = {
  qty_addition: "order",
  qty_cancellation: "order",
  price_change: "order",
  delivery_date_ext: "order",
  combo_colour_change: "order",
  material_bom: "material_bom",
  fabric_bom: "fabric_bom",
  order_budget: "budget",
};

const KIND_LABEL = new Map<string, string>(AMENDMENT_ENTRY_TYPES.map((t) => [t.value, t.label]));

/** The label the Raise Revision screen prints for the same choice. */
export function overrideKeyLabel(key: string): string {
  return isOverrideKey(key) ? KIND_LABEL.get(OVERRIDE_KEY_KIND[key]) ?? key : key;
}

/**
 * The admin screen's checkbox groups — Order Entry with its five kinds, then
 * the three modules, worded exactly as Raise Revision (spec §7.1).
 */
export const OVERRIDE_GROUPS: readonly { module: AmendmentModule; label: string; keys: readonly OverrideKey[] }[] =
  AMENDMENT_MODULES.map((m) => ({
    module: m.key,
    label: m.label,
    keys: m.key === "order_entry" ? [...ORDER_CHANGE_KINDS] : [m.key as OverrideKey],
  }));

// ---------------------------------------------------------------------------
// What a set of keys opens
// ---------------------------------------------------------------------------

/** The tables / columns a set of active keys opens — the per-kind seed,
 *  unioned, with NO whole-document overlay (R-17). */
export function overrideScopeOf(keys: readonly string[]): FrozenScope {
  return unionScope(keys.filter(isOverrideKey).map((k) => OVERRIDE_KEY_KIND[k]));
}

/**
 * Read the scope `order_override_scope()` returns. A PLAIN parse — never
 * `scopeFromJson`, which lays 0627's whole-document overlay and the files
 * overlay over what it reads: right for a revision's frozen scope, and
 * exactly wrong here, where the scope must be as narrow as the keys (R-17).
 */
export function overrideScopeFromJson(json: unknown): FrozenScope {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const out: Record<string, { columns: string[] | null; insert: boolean; delete: boolean }> = {};
  for (const [table, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const e = v as Record<string, unknown>;
    out[table] = {
      columns: Array.isArray(e.columns) ? e.columns.filter((c): c is string => typeof c === "string") : null,
      insert: e.insert === true,
      delete: e.delete === true,
    };
  }
  return out;
}

/**
 * D-6 for quantities: Quantity Addition only raises the order's total pieces,
 * Quantity Cancellation only lowers it; holding both allows either. Checked by
 * the save action against the STORED total, because the quantity grids are
 * saved by delete-and-reinsert and no single statement the trigger sees
 * carries a total. Keys that name neither leave quantities shut anyway (the
 * trigger refuses those tables), so there is nothing to judge.
 */
export function qtyDirectionProblem(keys: readonly string[], before: number, after: number): string | null {
  const add = keys.includes("qty_addition");
  const cancel = keys.includes("qty_cancellation");
  if (add === cancel) return null;
  if (add && after < before) {
    return `Quantity Addition only increases the order — this save would reduce it from ${before} to ${after} pieces. Raise an Order Revision to cancel quantity.`;
  }
  if (cancel && after > before) {
    return `Quantity Cancellation only reduces the order — this save would raise it from ${before} to ${after} pieces. Raise an Order Revision to add quantity.`;
  }
  return null;
}

/** What one editor needs to show override edit mode on the open record. */
export type AreaOverride = {
  /** The caller's live keys that open THIS editor — offered in the commit dialog. */
  keys: OverrideKey[];
  /** The earliest of those keys' expiries — what the banner warns about. */
  expiresAt: string;
  /** "V{n}" — the approved version the save edits in place (R-6). */
  version: string;
};

/**
 * Does an override apply to this editor on this record? Pure, for a const in
 * render (the editors are below early returns — no hooks).
 *
 * `approvedOrderId` is the APPROVED document locking the record — the page's
 * `raiseFor[doc]` for an order or BOM, the budget's order when the budget is
 * approved. It is absent for an open order (nothing to override), a pending
 * one (with the MD — C-3) and an amending one (the revision is the channel —
 * C-3), which is exactly when override mode must not appear.
 */
export function areaOverride(
  state: { keys: readonly { key: string; expiresAt: string }[]; versions: Readonly<Record<string, string>> } | null | undefined,
  area: AmendmentArea,
  approvedOrderId: string | null | undefined,
): AreaOverride | null {
  if (!state || !approvedOrderId) return null;
  const live = state.keys.filter((k) => isOverrideKey(k.key) && OVERRIDE_KEY_AREA[k.key] === area);
  if (live.length === 0) return null;
  return {
    keys: live.map((k) => k.key as OverrideKey),
    expiresAt: live.map((k) => k.expiresAt).sort()[0],
    version: state.versions[approvedOrderId] ?? "V0",
  };
}

const titleCase = (snake: string) =>
  snake
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * The audit row's TABLE, in the operator's words — "Order Entry · Style Prices",
 * "Fabric BOM · Yarns". The Override Edit Report's grouping column. Unknown
 * tables fall through title-cased rather than hidden: a report that drops a
 * row it cannot name is the silent kind of wrong.
 */
export function overrideTableLabel(table: string): string {
  if (table === "garment_order_amendments") return "Order Entry · Header";
  if (table === "order_fabric_boms") return "Fabric Plan · Header";
  if (table === "material_bom_amendments") return "Accessories Plan · Header";
  if (table === "order_budgets") return "Order Budget · Header";
  const prefixes: [string, string][] = [
    ["garment_order_amendment_", "Order Entry"],
    ["order_fabric_bom_", "Fabric Plan"],
    ["material_bom_amendment_", "Accessories Plan"],
    ["order_budget_", "Order Budget"],
  ];
  for (const [p, label] of prefixes) {
    if (table.startsWith(p)) return `${label} · ${titleCase(table.slice(p.length))}`;
  }
  return titleCase(table);
}

/** The audit row's FIELD — "fob_selling_price" → "Fob Selling Price"; the
 *  "(recalc)" suffix and the row markers ("(row added)") pass through. */
export function overrideFieldLabel(field: string): string {
  if (field.startsWith("(")) return field;
  const m = field.match(/^(.*?)( \(recalc\))?$/);
  return titleCase(m?.[1] ?? field) + (m?.[2] ?? "");
}

/** Which editors a set of keys unlocks at all. */
export function overrideAreasOf(keys: readonly string[]): AmendmentArea[] {
  const scope = overrideScopeOf(keys);
  return (["order", "fabric_bom", "material_bom", "budget"] as const).filter((a) => areaOpen(scope, a));
}

// ---------------------------------------------------------------------------
// Rules the grant and the commit are held to
// ---------------------------------------------------------------------------

/** D-3: an expiry is always required, and never more than this far out. */
export const OVERRIDE_MAX_DAYS = 30;
/** R-16: a grant, a revoke and every commit carry a reason at least this long. */
export const OVERRIDE_MIN_REASON = 10;
/** An override commit left open longer than this is closed `expired` and
 *  stops letting writes through — a save never takes this long. */
export const OVERRIDE_COMMIT_TTL_MINUTES = 30;
/** The admin screen's quick picks (spec §7.1). */
export const OVERRIDE_QUICK_DAYS = [1, 3, 7] as const;

/** R-1: emails are compared lower-cased and trimmed. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function reasonProblem(reason: string | null | undefined): string | null {
  const n = (reason ?? "").trim().length;
  return n >= OVERRIDE_MIN_REASON ? null : `Give a reason of at least ${OVERRIDE_MIN_REASON} characters.`;
}

/** D-3: after now, and no more than `OVERRIDE_MAX_DAYS` from now. The grant
 *  RPC applies the same rule against the database clock; this is the screen's
 *  early answer. */
export function expiryProblem(expiry: Date, now: Date): string | null {
  if (Number.isNaN(expiry.getTime())) return "Choose when the access expires.";
  if (expiry.getTime() <= now.getTime()) return "The expiry must be in the future.";
  if (expiry.getTime() > now.getTime() + OVERRIDE_MAX_DAYS * 86_400_000) {
    return `Access can be granted for at most ${OVERRIDE_MAX_DAYS} days.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A grant's status (the admin table's badge)
// ---------------------------------------------------------------------------

export type OverrideGrantStatus = "active" | "expired" | "revoked" | "disabled";

export type GrantStatusInput = {
  can_edit: boolean;
  revoked_at: string | null;
  override_expiry: string;
};

/**
 * R-2 on the grant row alone (the grantee's profile being active is the other
 * half, checked where the profile is at hand). Revoked wins over expired: a
 * revoke is a decision someone made, an expiry is only the clock, and the
 * badge should say the stronger thing. `disabled` is a row with
 * `can_edit = false` — never written by the grant RPC, but R-2 names it.
 */
export function grantStatusOf(g: GrantStatusInput, now: Date): OverrideGrantStatus {
  if (g.revoked_at) return "revoked";
  if (new Date(g.override_expiry).getTime() <= now.getTime()) return "expired";
  if (!g.can_edit) return "disabled";
  return "active";
}

export const GRANT_STATUS_LABEL: Readonly<Record<OverrideGrantStatus, string>> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  disabled: "Disabled",
};

export const GRANT_STATUS_TONE: Readonly<Record<OverrideGrantStatus, StatusTone>> = {
  active: "success",
  expired: "neutral",
  revoked: "danger",
  disabled: "neutral",
};
