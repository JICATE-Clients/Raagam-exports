import "server-only";
import { type createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { deleteOrBlock } from "./delete-guard";
import { generateUniqueCode } from "./auto-code";

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
export type PartySourceColumn =
  | "source_applicant_id"
  | "source_customer_id"
  | "source_consignee_id";

export type PartyLink = {
  /** Master the row is published INTO. */
  table: PartyTargetTable;
  /** Link column on that table (0371). */
  column: PartySourceColumn;
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
    flag: "Also Customer",
    from: "Applicant",
    into: "Customer",
  },
  applicantConsignee: {
    table: "consignees",
    column: "source_applicant_id",
    flag: "Also Consignee",
    from: "Applicant",
    into: "Consignee",
  },
  customerConsignee: {
    table: "consignees",
    column: "source_customer_id",
    flag: "Also Consignee",
    from: "Customer",
    into: "Consignee",
  },
  customerNotify: {
    table: "notifies",
    column: "source_customer_id",
    flag: "Also Notify",
    from: "Customer",
    into: "Notify Party",
  },
  consigneeNotify: {
    table: "notifies",
    column: "source_consignee_id",
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
 * Deliberately absent: `inactive` (an applicant going quiet does not close the
 * customer account — open question in doc/masters-open-questions.md), and every
 * commercial field (GST, TCS, currency, terms). Those belong to the published
 * record, and the source has no business holding an opinion about them.
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

export type DetachedLink = { column: PartySourceColumn; table: PartyTargetTable; id: string };

/**
 * Before deleting a source, hand its published rows back to the world.
 *
 * Without this, `first_referencing_table` (0344) sees the publish link and
 * reports the source as "in use by Customers" — so deleting an applicant would
 * deactivate it instead, for no reason the operator could possibly guess.
 * Unlinked, the published customer survives on its own as an ordinary customer;
 * it may already be on a sales order and must not be dragged down.
 */
export async function detachPublished(
  s: Db,
  links: readonly PartyLink[],
  sourceId: string,
): Promise<{ ok: true; detached: DetachedLink[] } | { ok: false; error: string }> {
  const detached: DetachedLink[] = [];
  for (const link of links) {
    const { data, error } = await s
      .from(link.table)
      .update({ [link.column]: null })
      .eq(link.column, sourceId)
      .select("id");
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      detached.push({ column: link.column, table: link.table, id: (row as { id: string }).id });
    }
  }
  return { ok: true, detached };
}

/**
 * …and put them back if the delete guard only DEACTIVATED the source. A source
 * that still exists still owns what it published — drop the link and its tick
 * box would publish a second, duplicate row on the very next save.
 *
 * Cannot realistically collide: we freed these links moments ago and the
 * partial unique index means nobody else can claim them. If it fails anyway the
 * caller must say so, because the state really is wrong at that point.
 */
export async function reattachPublished(
  s: Db,
  detached: readonly DetachedLink[],
  sourceId: string,
): Promise<string | null> {
  for (const d of detached) {
    const { error } = await s.from(d.table).update({ [d.column]: sourceId }).eq("id", d.id);
    if (error) return error.message;
  }
  return null;
}
