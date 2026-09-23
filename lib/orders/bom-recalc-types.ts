/**
 * WHAT A BOM RECALCULATION ANSWERS (0619) — client-safe, so the amendment
 * screens can name the type without importing a `"use server"` module.
 *
 * `recalculateFabricBomDerived` and `recalculateMaterialBomDerived` recompute a
 * BOM's DERIVED rows (the requirement, the yarn purchase, the header's
 * `computed_*` stamp) from its STORED authored rows and the order's CURRENT
 * production — the writes `BOM_DERIVED_SCOPE` opens under a quantity or
 * colourway amendment while the BOM itself stays read-only.
 *
 * `manualEntries` is the "Manual Entry Needed" list: things the order now asks
 * for that no authored row answers (a new colourway with no fabric weight). The
 * derived rows for everything else are still written; these need the BOM
 * opened by someone whose amendment covers it.
 *
 * `dryRun` carries the stored and recomputed requirement rows side by side
 * (both with `id` / `sno` / `created_at` stripped) — nothing is written.
 */
export type RecalcResult =
  | {
      ok: true;
      changed: { requirements: number; yarns?: number; stages?: number };
      manualEntries: { message: string }[];
      dryRun?: { requirementsBefore: unknown[]; requirementsAfter: unknown[] };
    }
  | { ok: false; error: string };
