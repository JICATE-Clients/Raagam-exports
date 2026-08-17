import type { ActiveColumn } from "@/lib/masters/inactive";
import type { Module } from "@/lib/auth/types";

/**
 * WHICH MASTERS CAN BE BLOCKED FROM THEIR LISTING, and what that means for each.
 *
 * Client rule (2026-08-17): "block option move to that table listing … we are
 * used to give that block while CREATING the data but we need to move this in
 * ACTION only, no more in the creating screen". So the Inactive/Blocked control
 * leaves the form and becomes a row action, on every master that has the flag.
 *
 * ## AN ALLOWLIST, NOT A TABLE NAME FROM THE BROWSER
 *
 * `setMasterActive` takes an ENTITY KEY and looks the table up here. It must
 * never take a table name as an argument: a server action is a public HTTP
 * endpoint, so a caller-supplied table would let anyone UPDATE any table the
 * session's RLS happens to allow. This is the same shape `lib/data-io`'s
 * `bulkSetActive` already uses (`getIoEntity(entityKey)`), and for the same
 * reason.
 *
 * ## THE COLUMN IS PER ENTITY BECAUSE THE SCHEMA SPELLS IT THREE WAYS
 *
 * `inactive` / `blocked` (true = off) and `is_active` (false = off) — see
 * `lib/masters/inactive.ts`, which also records why guessing is fatal rather
 * than merely wrong: NO table carries two of the spellings, and PostgREST
 * answers an UPDATE over a missing column with an ERROR, not a no-op. So a
 * wrong entry here does not degrade, it fails outright.
 *
 * **Read the column from the catalog when adding an entity**, never from
 * memory or from the counts in `inactive.ts` (that list was itself wrong once,
 * and a Component dropdown went silently empty because of it):
 *
 *     select column_name from information_schema.columns
 *      where table_schema = 'public' and table_name = '<t>'
 *        and column_name in ('inactive', 'blocked', 'is_active');
 *
 * ## `revalidate` IS COPIED FROM THE MASTER'S OWN ACTION FILE
 *
 * Each master's `rev()` already names the paths its listing is rendered at, and
 * blocking changes what those pages show. Copying them keeps one fact in two
 * places, which is a cost — but the alternative is importing 40 action modules
 * into one registry, and `revalidatePath` is not exported per entity.
 */
export type ActiveEntity = {
  /** The Postgres table. Never supplied by the caller. */
  table: string;
  /** Which of the three spellings this table uses. Catalog-verified. */
  column: ActiveColumn;
  /** Permission module — `can(module, …)` gates the write. */
  module: Module;
  /** Singular, for the toast: "Bank blocked". */
  label: string;
  /** Every route whose listing shows this master. */
  revalidate: string[];
};

export const ACTIVE_ENTITIES: Record<string, ActiveEntity> = {
  bank: {
    table: "banks",
    column: "inactive",
    module: "masters",
    label: "Bank",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/bank"],
  },
  category: {
    table: "categories",
    column: "inactive",
    module: "masters",
    label: "Category",
    revalidate: ["/masters", "/masters/materials", "/masters/materials/categories"],
  },
  /** Orders module, and the `blocked` spelling — one of only five tables that
   *  kept it when 0299 renamed every other master to `inactive`. */
  style: {
    table: "garment_styles",
    column: "blocked",
    module: "orders",
    label: "Style",
    revalidate: ["/orders/styles", "/orders/all"],
  },
  country: {
    table: "countries",
    column: "inactive",
    module: "masters",
    label: "Country",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/country"],
  },
};

export type ActiveEntityKey = keyof typeof ACTIVE_ENTITIES;

/** The entity, or null for a key that is not registered. Never throws — an
 *  unknown key is a caller error the action reports, not a crash. */
export function getActiveEntity(key: string): ActiveEntity | null {
  return ACTIVE_ENTITIES[key] ?? null;
}
