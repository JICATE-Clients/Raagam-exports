import "server-only";
import { revalidatePath } from "next/cache";
import { type createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { deleteOrBlock, humanizeTable } from "./delete-guard";
import { generateUniqueCode } from "./auto-code";
import { originDeleteBlock } from "./party-origin-text";

type Db = Awaited<ReturnType<typeof createClient>>;

// ============================================================================
// Party publishing — the "Also …" tick boxes (0371)
//
// One party is often several things at once: an applicant that is also a
// customer, a customer that is also a consignee. Ticking "Also Customer"
// publishes a REAL row into the Customer master, seeded from the source and
// linked back to it; un-ticking removes that row unless it is in use.
//
// Written once, here, because there are five pairs of it. Five hand-rolled
// copies is how the fourth one ends up missing its un-publish branch and
// quietly leaves an orphan behind.
//
// The split of ownership is the whole design:
//   · NAME belongs to the source          — synced down on every save, and
//                                            read-only on the published row.
//   · EVERYTHING ELSE belongs to the row  — GST, TCS, payment terms, contacts,
//                                            child grids. Seeded once at birth,
//                                            never overwritten again.
// That is why we publish a real row rather than a cross-reference: an applicant
// record cannot hold a customer's GSTIN.
// ============================================================================

export type PartyTargetTable = "customers" | "consignees" | "notifies";
/** Every master that can be the root of a publish chain — the targets plus Applicant, which is only ever a source. */
export type PartyTable = "applicants" | PartyTargetTable;
export type PartySourceColumn =
  | "source_applicant_id"
  | "source_customer_id"
  | "source_consignee_id";

export type PartyLink = {
  /** Master the row is published INTO. */
  table: PartyTargetTable;
  /** Link column on that table (0371). */
  column: PartySourceColumn;
  /** Master the tick box lives on — the table `column` points at. */
  sourceTable: PartyTable;
  /** The tick box, named as the operator sees it: "Also Customer". */
  flag: string;
  /** The master that owns the tick box: "Applicant". */
  from: string;
  /** Singular name of the published thing: "Customer". */
  into: string;
};

export const PARTY_LINKS = {
  applicantCustomer: {
    table: "customers",
    column: "source_applicant_id",
    sourceTable: "applicants",
    flag: "Also Customer",
    from: "Applicant",
    into: "Customer",
  },
  applicantConsignee: {
    table: "consignees",
    column: "source_applicant_id",
    sourceTable: "applicants",
    flag: "Also Consignee",
    from: "Applicant",
    into: "Consignee",
  },
  customerConsignee: {
    table: "consignees",
    column: "source_customer_id",
    sourceTable: "customers",
    flag: "Also Consignee",
    from: "Customer",
    into: "Consignee",
  },
  customerNotify: {
    table: "notifies",
    column: "source_customer_id",
    sourceTable: "customers",
    flag: "Also Notify",
    from: "Customer",
    into: "Notify Party",
  },
  consigneeNotify: {
    table: "notifies",
    column: "source_consignee_id",
    sourceTable: "consignees",
    flag: "Also Notify",
    from: "Consignee",
    into: "Notify Party",
  },
} as const satisfies Record<string, PartyLink>;

/**
 * The block every party master shares — identity plus the postal address and
 * the ways to reach them. Copied ONCE, when the row is born, because an
 * applicant that also ships goods almost always ships from the same address;
 * typing it twice is how the two drift apart.
 *
 * Deliberately absent: `inactive`, and every commercial field (GST, TCS,
 * currency, terms). Those belong to the published record, and the source has no
 * business holding an opinion about them.
 *
 * `inactive` needs a word, because DELETE now propagates and this does not.
 * They are different questions. An applicant going quiet does not close the
 * customer account, so saving an inactive applicant still leaves its customer
 * alone (open question P1). Deleting that applicant is a statement that the
 * party should not exist at all, and takes the whole published subtree with it
 * — see `deleteParty` (P3, answered 2026-07-31).
 */
export type PartySeed = {
  name: string;
  country_id: string | null;
  street: string | null;
  city_id: string | null;
  state_id: string | null;
  pin: string | null;
  address_country_id: string | null;
  land_line: string | null;
  mobile: string | null;
  whatsapp: string | null;
  email: string | null;
  web_site: string | null;
};

/** Pick the shared block off any party master's parsed input. */
export function partySeed(h: Partial<PartySeed> & { name: string }): PartySeed {
  return {
    name: h.name,
    country_id: h.country_id ?? null,
    street: h.street ?? null,
    city_id: h.city_id ?? null,
    state_id: h.state_id ?? null,
    pin: h.pin ?? null,
    address_country_id: h.address_country_id ?? null,
    land_line: h.land_line ?? null,
    mobile: h.mobile ?? null,
    whatsapp: h.whatsapp ?? null,
    email: h.email ?? null,
    web_site: h.web_site ?? null,
  };
}

type Result = { ok: true } | { ok: false; error: string };

/** "In use by Sales Orders — cannot delete." → "in use by Sales Orders" */
function reason(msg: string): string {
  const trimmed = msg.replace(/\s*—\s*cannot delete\.?\s*$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * Reconcile one tick box against the master it publishes into.
 *
 * `on` and nothing published  → insert, seeded + linked.
 * `on` and already published  → sync the name down, touch nothing else.
 * `!on` and a row exists      → delete it, or REFUSE if it is in use.
 *
 * The refusal is the point of the whole feature working in reverse: a customer
 * that is already on a sales order cannot be made to vanish by un-ticking a box
 * on a different screen. `deleteOrBlock` already asks the DB's
 * `first_referencing_table` (0344), which sees SET NULL references too — do not
 * write a second reference check here.
 *
 * Callers must fail the entire save on a refusal. Saving the header while
 * silently leaving the flag on is how the screen ends up lying to the operator.
 */
export async function publishParty(
  s: Db,
  link: PartyLink,
  sourceId: string,
  on: boolean,
  seed: PartySeed,
  /** Extra columns for the INSERT only (e.g. a published consignee's owning customer). */
  extra?: Record<string, unknown>,
): Promise<Result> {
  const { data: existing, error: findErr } = await s
    .from(link.table)
    .select("id")
    .eq(link.column, sourceId)
    .maybeSingle();
  if (findErr) return { ok: false, error: findErr.message };

  if (on) {
    if (existing) {
      // Name only. The rest of this row belongs to whoever has been editing it.
      const { error } = await s.from(link.table).update({ name: seed.name }).eq("id", existing.id);
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    // Publishing CREATES a row in another master, which the caller's own
    // permission check (create-an-applicant, edit-an-applicant) never covered.
    // Left to RLS this comes back as "new row violates row-level security
    // policy", which tells the operator nothing about the box they just ticked.
    if (!(await can("masters", "create"))) {
      return { ok: false, error: `Ticking ${link.flag} creates a ${link.into} — you do not have permission to.` };
    }
    // Its own code, not the source's short name: the two masters number
    // independently and a borrowed code reads like a data-entry mistake.
    const code = await generateUniqueCode(s, link.table, seed.name);
    const { error } = await s
      .from(link.table)
      .insert({ ...seed, ...extra, code, [link.column]: sourceId });
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  if (!existing) return { ok: true };
  // This one is not cosmetic. An RLS DELETE policy FILTERS rows rather than
  // raising — without permission the delete removes nothing and reports no
  // error, so the untick would "succeed" while the published row quietly
  // survived, badge and all. Check up front instead.
  if (!(await can("masters", "delete"))) {
    return { ok: false, error: `Unticking ${link.flag} deletes its ${link.into} — you do not have permission to.` };
  }
  const res = await deleteOrBlock(s, link.table, existing.id);
  if (res.ok) return { ok: true };
  return {
    ok: false,
    error: `Cannot untick ${link.flag} — the ${link.into} it created is ${reason(res.error)}. Remove that reference first.`,
  };
}

// ============================================================================
// Deleting a party — the mirror of publishing it (0378)
//
// A published row exists only as an expression of the tick box that made it, so
// deleting the source takes the whole subtree with it, recursively:
//
//   Applicant ─┬─ Customer ─┬─ Consignee ── Notify
//              │            └─ Notify
//              └─ Consignee ── Notify
//
// ONE FATE: if the root or any node is genuinely in use, NOTHING is deleted —
// every node is marked inactive with its publish links left intact, so the tick
// boxes keep telling the truth. Half a subtree going is the outcome that must
// never happen: a source left alive with its boxes ticked republishes empty
// rows on the very next save.
//
// All of that lives in the `party_delete_subtree` RPC rather than here, for two
// reasons. supabase-js has no transaction, so "one fate" could only be an
// intention in TypeScript. And the verdict is not answerable from this side at
// all: `first_referencing_table` (0344) counts the publish link, the published
// consignee's `customer_id` picker and two cascade grids as "in use", so a
// customer with Also Consignee ticked can never hard-delete. 0378's header has
// the full account.
// ============================================================================

export type PartyDeleteResult =
  | { ok: true; inactive: boolean; usedBy?: string; alsoAffected?: string[] }
  | { ok: false; error: string };

/**
 * All four party pages, always. A subtree delete can reach any of them from any
 * of them, and the four actions used to each revalidate their own guess at the
 * blast radius — `deleteApplicant` missed Notify, which it can now reach two
 * levels down.
 */
export function revalidatePartyMasters(): void {
  revalidatePath("/masters/associates/applicant");
  revalidatePath("/masters/associates/customer");
  revalidatePath("/masters/associates/consignee");
  revalidatePath("/masters/associates/notify");
}

type SubtreeNode = { table: string; label: string; name: string | null };
type SubtreeResult = { inactive: boolean; used_by: string | null; nodes: SubtreeNode[] };

/** Which publish links can be set ON a row of this table — i.e. how it could have been published. */
const SOURCE_LINKS: Record<PartyTable, readonly PartyLink[]> = {
  applicants: [],
  customers: [PARTY_LINKS.applicantCustomer],
  consignees: [PARTY_LINKS.applicantConsignee, PARTY_LINKS.customerConsignee],
  notifies: [PARTY_LINKS.customerNotify, PARTY_LINKS.consigneeNotify],
};

/**
 * A published row cannot be deleted from its own master — deleting it while the
 * flag stayed ticked simply republishes it on the source's next save.
 *
 * The screens already say this (`originDeleteBlock`), but only in the browser.
 * That was cosmetic while a delete affected one row; it is not now. Reaching
 * `deleteCustomer` directly on a published customer would take that customer's
 * own consignee and notify with it, and then the applicant's next save would
 * republish the customer alone — a subtree amputated through a path with no UI.
 *
 * Entry point only. The recursion inside the RPC must of course delete
 * published nodes; that is the entire feature.
 */
async function refusePublishedRoot(s: Db, table: PartyTable, id: string): Promise<string | null> {
  const links = SOURCE_LINKS[table];
  if (links.length === 0) return null;

  const { data, error } = await s
    .from(table)
    .select(links.map((l) => l.column).join(", "))
    .eq("id", id)
    .maybeSingle();
  // Missing row / unreadable: say nothing and let the RPC raise the real error
  // rather than inventing a second, vaguer one here.
  if (error || !data) return null;

  const row = data as unknown as Record<PartySourceColumn, string | null>;
  for (const link of links) {
    const sourceId = row[link.column];
    if (!sourceId) continue;
    const { data: src } = await s
      .from(link.sourceTable)
      .select("name")
      .eq("id", sourceId)
      .maybeSingle();
    return originDeleteBlock({
      from: link.from,
      name: (src as { name?: string } | null)?.name ?? "—",
      flag: link.flag,
    });
  }
  return null;
}

/**
 * Delete a party and everything it published. The four `delete*` actions are
 * one call each; the fate is decided in the DB, atomically.
 *
 * `alsoAffected` lists the published roles that went with it ("Customer",
 * "Consignee") for the toast. Roles, not names: `publishParty` syncs the name
 * down on every save, so naming them would repeat one word four times.
 */
export async function deleteParty(
  s: Db,
  table: PartyTable,
  id: string,
): Promise<PartyDeleteResult> {
  if (!(await can("masters", "delete"))) return { ok: false, error: "Forbidden" };

  const refusal = await refusePublishedRoot(s, table, id);
  if (refusal) return { ok: false, error: refusal };

  const { data, error } = await s.rpc("party_delete_subtree", { p_table: table, p_id: id });
  if (error) return { ok: false, error: error.message };

  revalidatePartyMasters();

  const res = data as SubtreeResult;
  // Node 0 is the row the operator actually clicked; the rest are what it
  // published. Deduped because one party can publish two Notify Parties (one
  // via its customer, one via its consignee) and the toast should say it once.
  const alsoAffected = [...new Set(res.nodes.slice(1).map((n) => n.label))];
  return {
    ok: true,
    inactive: res.inactive,
    usedBy: res.used_by ? humanizeTable(res.used_by) : undefined,
    alsoAffected: alsoAffected.length ? alsoAffected : undefined,
  };
}
