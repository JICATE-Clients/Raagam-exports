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
  /**
   * Registered 2026-09-09, when the Inactive switch came OFF the Customer
   * editor's Identity row. That is the 08-17 rule arriving one master later, and
   * the order matters: the row action has to exist before the field goes, or
   * blocking a customer stops being possible at all rather than moving.
   *
   * `inactive`, catalog-confirmed — 0299 renamed `customers.blocked` to
   * `inactive`, and `customerInput`, the list's Status column and
   * `customer-actions.ts` all read that spelling. Paths copied from that file's
   * own `rev()`.
   */
  customer: {
    table: "customers",
    column: "inactive",
    module: "masters",
    label: "Customer",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/customer"],
  },
  /**
   * Registered 2026-09-11, alongside `country`, when the Port listing gained the
   * Status switch. It is the only entry here whose column did not already exist:
   * `ports` was one of the three flagless tables AGENTS.md names, so 0547 adds
   * `inactive` and this entry is what makes it reachable.
   *
   * `inactive` is therefore catalog-confirmed by construction — 0547 is the
   * migration that creates it, and it chose that spelling because 0299 put every
   * other Master Data table on it. Paths copied from `port-actions.ts`'s `rev()`.
   */
  port: {
    table: "ports",
    column: "inactive",
    module: "masters",
    label: "Port",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/port"],
  },
  /**
   * Registered 2026-09-11, when Destination joined Country and Port on the
   * Status switch (client 2026-09-11). Same order the rule has always required:
   * the write exists before the editor's Inactive field goes, or blocking a
   * destination stops being possible rather than moving.
   *
   * `inactive`, and the shipped code is the catalog check — `destination-actions.ts`
   * already passes that spelling to `deleteOrDeactivate`, where a wrong column
   * errors rather than degrades. Paths copied from that file's own `rev()`.
   */
  destination: {
    table: "destinations",
    column: "inactive",
    module: "masters",
    label: "Destination",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/destination"],
  },
  /**
   * THE REST OF ASSOCIATES, registered together on 2026-09-11 when the Status
   * switch went from four listings to eleven (client 2026-09-11, the same
   * instruction Country / Port / Destination / Bank answered: a clickable switch
   * in the STATUS column and one `⋮` menu in ACTIONS, on every master of the
   * module). Grouped rather than filed alphabetically because they went in as
   * one change and each carries the same two facts.
   *
   * `inactive` on ALL SIX, and this is the catalog answer rather than the
   * convenient one: 0299 renamed `blocked` → `inactive` on `consignees`,
   * `employees`, `master_vendors` and `payment_terms`, and 0305 did the same for
   * `our_banks` and `zones`. Two of those renames have already bitten this app
   * once each — `zone-actions.ts` wrote `blocked` until 2026-08-10 and
   * `our-bank-actions.ts` until today — which is exactly the failure mode
   * `inactive.ts` warns about: PostgREST errors on a missing column rather than
   * no-opping, so the write fails outright.
   *
   * Paths are copied from each master's own `rev()`, and the last segment is the
   * SUBMODULE SLUG, not the table — `our-banks` and `zones` are plural there
   * while every other Associates route is singular.
   */
  consignee: {
    table: "consignees",
    column: "inactive",
    module: "masters",
    label: "Consignee",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/consignee"],
  },
  payment_term: {
    table: "payment_terms",
    column: "inactive",
    module: "masters",
    label: "Payment Term",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/payment-term"],
  },
  /** `master_vendors`, NEVER the purchase-side `public.vendors` — AGENTS.md
   *  "Nominated vendors" records what pointing at the wrong one costs. */
  vendor: {
    table: "master_vendors",
    column: "inactive",
    module: "masters",
    label: "Vendor",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/vendor"],
  },
  employee: {
    table: "employees",
    column: "inactive",
    module: "masters",
    label: "Employee",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/employee"],
  },
  our_bank: {
    table: "our_banks",
    column: "inactive",
    module: "masters",
    label: "Our Bank",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/our-banks"],
  },
  zone: {
    table: "zones",
    column: "inactive",
    module: "masters",
    label: "Zone",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/zones"],
  },
  /**
   * Applicant · Receivable Term · Notify — the three Associates masters the
   * block above did not reach, registered 2026-09-11 under the same client
   * instruction (a Status switch in the listing, one `⋮` in Actions).
   *
   * `inactive` on all three, and the shipped code is the catalog check rather
   * than a memory of it: `applicantInput`, `receivableTermInput` and
   * `notifyInput` each declare `inactive`, and all three delete paths already
   * hand that spelling to `deleteOrDeactivate` / `deleteParty`, where a wrong
   * column errors outright instead of no-opping.
   *
   * `applicant` and `notify` are PARTY masters (0378): deleting or blocking an
   * Applicant reaches the Customer and Consignee it published. That subtree is
   * `deleteParty`'s business and NOT this entry's — `setMasterActive` switches
   * the one row the operator clicked, which is what a switch in a row promises.
   * The revalidate paths are widened to the published masters' listings for the
   * same reason the applicant action's own `rev()` widens them.
   */
  applicant: {
    table: "applicants",
    column: "inactive",
    module: "masters",
    label: "Applicant",
    revalidate: [
      "/masters",
      "/masters/associates",
      "/masters/associates/applicant",
      "/masters/associates/customer",
      "/masters/associates/consignee",
    ],
  },
  receivable_term: {
    table: "receivable_terms",
    column: "inactive",
    module: "masters",
    label: "Receivable Term",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/receivable-term"],
  },
  /** `notifies` (0239) — NOT `notify_parties`, which does not exist. The label
   *  reads "Notify Party" and the route segment is `notify`; neither is the
   *  table, and a wrong table here fails the write outright rather than
   *  degrading (see the header). Confirmed against 0239 and `deleteNotify`. */
  notify: {
    table: "notifies",
    column: "inactive",
    module: "masters",
    label: "Notify Party",
    revalidate: ["/masters", "/masters/associates", "/masters/associates/notify"],
  },
};

export type ActiveEntityKey = keyof typeof ACTIVE_ENTITIES;

/** The entity, or null for a key that is not registered. Never throws — an
 *  unknown key is a caller error the action reports, not a crash. */
export function getActiveEntity(key: string): ActiveEntity | null {
  return ACTIVE_ENTITIES[key] ?? null;
}
