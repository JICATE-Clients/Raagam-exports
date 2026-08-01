import type { Customer } from "./customer-types";

// ============================================================================
// Fetch a party's details from the party it belongs to — "Fetch from Customer"
//
// Ticking Customer ▸ Also Consignee publishes a real consignee row (0371), but
// `partySeed` in party-publish.ts is deliberately narrow — twelve address
// scalars, copied ONCE at birth and never refreshed ("Seeded once at birth,
// never overwritten again"). Everything the operator had already keyed on the
// Customer's General tab, and every Contact and Marking row, stayed behind. So
// did anything typed on the Customer *after* the box was ticked.
//
// This module is the operator-triggered answer: a pure mapping from a loaded
// Customer to the Consignee form's shape, plus a diff so the button can say
// what it is about to do before it does it. No DB access, no `server-only` —
// the Consignee screen already receives full Customer rows (contacts and
// markings embedded by listCustomers), so the fetch is a lookup in an array,
// never a round trip. That is the same shape as every other pick-then-fill in
// this app (orders/process-amendments, orders/ta-plan).
//
// THE ONE RULE THAT MAKES IT SAFE: a fetch only ever BRINGS values. An empty
// field on the Customer never clears a filled one on the Consignee. A customer
// with no e-mail must not wipe the e-mail someone chased down for the delivery
// address.
// ============================================================================

/**
 * Every Consignee header field a Customer can answer, and no others.
 *
 * What is missing here is the substance of the design, so it is written down
 * rather than left to be rediscovered:
 *
 *  · `payment_term_id` — NOT copied, and this is the trap. It looks like the
 *    Customer's `receivable_term_id`, but the two point at different universes:
 *    `receivable_term_id` → `receivable_terms`, `payment_term_id` →
 *    `config_lookups` (kind 'payment_term'). Copying the uuid would write a
 *    `receivable_terms` id into a `config_lookups` FK — the exact class of bug
 *    that already had to be repaired for `state` (0355) and `payment_term`
 *    (0375). It stays a manual field until something reconciles the two.
 *
 *  · `bank_id`, `ac_no`, `tin_no`, `tin_no_2`, `tin_no_3`, `pan_no` — the
 *    `customers` table has no such columns. There is nothing to copy. PAN is
 *    not a loss: the Consignee screen already derives it from a valid GSTIN,
 *    and `gst_no` IS copied.
 *
 *  · `also_notify` — the Consignee's own publish tick box. Copying it would
 *    silently create a Notify-party row from a button labelled "fetch".
 *
 *  · `name` / `code` — a published row's Name already syncs down from its
 *    source and is read-only on this screen; `code` is the Consignee's own,
 *    minted independently by `generateUniqueCode`.
 *
 *  · `inactive`, `is_draft` — status, not detail.
 *
 *  · `customer_id` — the button READS it to know which customer to fetch. It
 *    would be circular to write it back.
 */
export type ConsigneeFetchFields = {
  // Address block — the same twelve `partySeed` already seeds at birth, minus
  // `name`. Repeated here because the fetch must also cover the case where the
  // Customer was filled in AFTER the tick box was set.
  country_id: string;
  street: string;
  city_id: string;
  state_id: string;
  pin: string;
  address_country_id: string;
  land_line: string;
  mobile: string;
  /** NULL = "same as mobile" — a real answer, not a blank. See `isBlank`. */
  whatsapp: string | null;
  email: string;
  web_site: string;
  // General tab — the half that never crossed before.
  currency_1: string;
  currency_2: string;
  currency_3: string;
  ship_mode: string;
  ship_type_id: string;
  pay_mode: string;
  gst_no: string;
};

/** A Contact row, in the Consignee grid's shape. The seven columns match 1:1. */
export type ConsigneeFetchContact = {
  department_id: string;
  contact_name: string;
  designation_id: string;
  land_line: string;
  mobile: string;
  email_id: string;
  internal_department_id: string;
};

export type CustomerFetch = {
  fields: ConsigneeFetchFields;
  contacts: ConsigneeFetchContact[];
  /** Marking text, in grid order. */
  markings: string[];
};

/**
 * Field → the label the Consignee form prints above it, so the confirm strip
 * can name what it is replacing in the operator's own words rather than in
 * column names.
 *
 * `country_id` and `address_country_id` share "Country" on purpose: the screen
 * collapsed two Country boxes into one picker that writes both (client
 * 2026-07-31), so naming them separately would report one change as two.
 * `describeFields` de-duplicates.
 */
const FIELD_LABEL: Record<keyof ConsigneeFetchFields, string> = {
  country_id: "Country",
  address_country_id: "Country",
  street: "Street",
  city_id: "City",
  state_id: "State",
  pin: "Pin",
  land_line: "Land Line",
  mobile: "Mobile",
  whatsapp: "WhatsApp",
  email: "E-Mail",
  web_site: "Web site",
  currency_1: "Currency 1",
  currency_2: "Currency 2",
  currency_3: "Currency 3",
  ship_mode: "Ship Mode",
  ship_type_id: "Ship Type",
  pay_mode: "Pay Mode",
  gst_no: "GST No",
};

const FIELD_KEYS = Object.keys(FIELD_LABEL) as (keyof ConsigneeFetchFields)[];

/** `null`/`undefined` → `""`, the shape every text field on the form holds. */
const s = (v: string | null | undefined): string => v ?? "";

/**
 * Nothing to say. Both spellings of empty count, because the two sides use
 * different ones: the DB stores NULL, the form stores "".
 *
 * `whatsapp` is why this takes `null` as blank rather than as a value. On the
 * form NULL means "same as mobile" — an answer, not a gap — but it is also what
 * a Customer that simply never filled the box holds. Treating it as blank means
 * such a customer leaves the Consignee's WhatsApp alone, which is right either
 * way: if the mobile was copied too, "same as mobile" needs no copying.
 */
const isBlank = (v: string | null | undefined): boolean => v == null || v.trim() === "";

/** True when a fetched Contact row carries anything at all worth copying. */
function contactHasContent(c: ConsigneeFetchContact): boolean {
  return (
    !isBlank(c.department_id) ||
    !isBlank(c.contact_name) ||
    !isBlank(c.designation_id) ||
    !isBlank(c.land_line) ||
    !isBlank(c.mobile) ||
    !isBlank(c.email_id) ||
    !isBlank(c.internal_department_id)
  );
}

/**
 * The Customer, expressed in the Consignee form's vocabulary.
 *
 * Pure and total: it reads a Customer and returns a candidate for every field
 * it can answer, blanks included. Deciding which of those candidates are
 * allowed to land is `diffFetch`'s job, not this one's — keeping the two apart
 * is what lets the button describe the change before making it.
 */
export function customerToConsigneeFields(c: Customer): CustomerFetch {
  return {
    fields: {
      country_id: s(c.country_id),
      street: s(c.street),
      city_id: s(c.city_id),
      state_id: s(c.state_id),
      pin: s(c.pin),
      address_country_id: s(c.address_country_id),
      land_line: s(c.land_line),
      mobile: s(c.mobile),
      whatsapp: c.whatsapp,
      email: s(c.email),
      web_site: s(c.web_site),
      currency_1: s(c.currency_1),
      currency_2: s(c.currency_2),
      currency_3: s(c.currency_3),
      ship_mode: s(c.ship_mode),
      ship_type_id: s(c.ship_type_id),
      pay_mode: s(c.pay_mode),
      gst_no: s(c.gst_no),
    },
    contacts: (c.contacts ?? [])
      .map((r) => ({
        department_id: s(r.department_id),
        contact_name: s(r.contact_name),
        designation_id: s(r.designation_id),
        land_line: s(r.land_line),
        mobile: s(r.mobile),
        email_id: s(r.email_id),
        internal_department_id: s(r.internal_department_id),
      }))
      .filter(contactHasContent),
    markings: (c.markings ?? []).map((m) => s(m.marking)).filter((m) => !isBlank(m)),
  };
}

export type FetchPlan = {
  /** Only the fields that will actually change — hand straight to `set()`. */
  patch: Partial<ConsigneeFetchFields>;
  /** Labels of fields landing in an empty box. Applied without asking. */
  fills: string[];
  /** Labels of fields overwriting a DIFFERENT value. These need a confirm. */
  replaces: string[];
  /** Contact rows to copy, or null to leave the grid alone. */
  contacts: ConsigneeFetchContact[] | null;
  /** Marking rows to copy, or null to leave the grid alone. */
  markings: string[] | null;
  /** How many real rows the grids would displace. Non-zero ⇒ confirm. */
  replacedContacts: number;
  replacedMarkings: number;
  /** Nothing would change — the button should say so rather than flash a toast. */
  empty: boolean;
};

/**
 * What a fetch would actually do to the form as it stands.
 *
 * Four outcomes per field, and only the third one is a question:
 *   incoming blank                      → skip. A fetch never clears.
 *   incoming = current                  → skip. Not a change.
 *   current blank                       → fill, silently.
 *   current filled and different        → replace, but say so first.
 *
 * The grids are all-or-nothing: a Contact list cannot be merged with another
 * Contact list, because "is this the same person twice?" has no answer a
 * computer can give. So they are copied whole, or not at all, and a grid
 * holding real rows counts as a replacement.
 */
export function diffFetch(
  current: ConsigneeFetchFields,
  currentContacts: readonly ConsigneeFetchContact[],
  currentMarkings: readonly string[],
  incoming: CustomerFetch,
): FetchPlan {
  const patch: Partial<ConsigneeFetchFields> = {};
  const fills: string[] = [];
  const replaces: string[] = [];

  for (const key of FIELD_KEYS) {
    const next = incoming.fields[key];
    if (isBlank(next)) continue;
    const now = current[key];
    if (s(now).trim() === s(next).trim()) continue;
    // `next` is typed per-key on both sides; the index write needs the widening.
    (patch as Record<string, string | null>)[key] = next;
    (isBlank(now) ? fills : replaces).push(FIELD_LABEL[key]);
  }

  // A grid the fetch would leave exactly as it already is is not a change, and
  // must not be re-applied: setting identical rows would still mint new keys,
  // move the dirty snapshot and arm the unsaved-work guard over nothing.
  const contacts =
    incoming.contacts.length && contactsDiffer(incoming.contacts, currentContacts)
      ? incoming.contacts
      : null;
  const markings =
    incoming.markings.length && markingsDiffer(incoming.markings, currentMarkings)
      ? incoming.markings
      : null;

  return {
    patch,
    fills: dedupe(fills),
    replaces: dedupe(replaces),
    contacts,
    markings,
    replacedContacts: contacts ? currentContacts.filter(contactHasContent).length : 0,
    replacedMarkings: markings ? currentMarkings.filter((m) => !isBlank(m)).length : 0,
    empty: Object.keys(patch).length === 0 && !contacts && !markings,
  };
}

/** Country appears twice (see FIELD_LABEL) and must be counted once. */
function dedupe(labels: string[]): string[] {
  return [...new Set(labels)];
}

/**
 * Would copying these rows in actually change the grid? Compared against the
 * grid's REAL rows only — the Contact grid always carries one blank scaffolding
 * row, and counting that as content would report every fetch as a replacement.
 */
function contactsDiffer(
  next: readonly ConsigneeFetchContact[],
  current: readonly ConsigneeFetchContact[],
): boolean {
  const real = current.filter(contactHasContent);
  if (real.length !== next.length) return true;
  return next.some((r, i) => JSON.stringify(r) !== JSON.stringify(real[i]));
}

function markingsDiffer(next: readonly string[], current: readonly string[]): boolean {
  const real = current.filter((m) => !isBlank(m));
  if (real.length !== next.length) return true;
  return next.some((m, i) => m !== real[i]);
}

/**
 * "Street, Pin and GST No" — an Oxford-comma-free list for a one-line confirm.
 * Truncates at four, because the strip has to fit beside a button and a list of
 * eighteen field names is not read, it is skipped.
 */
export function describeFields(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length <= 4) {
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  }
  return `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more`;
}

/**
 * The General-tab columns a Customer can seed into a consignee at BIRTH, on top
 * of `partySeed`'s address block. Used by customer-actions' publish step so a
 * freshly published consignee is not born needing the button on day one.
 *
 * Address fields are absent because `partySeed` already carries them, and the
 * child grids because an INSERT of one row cannot reach them — that is what
 * "Fetch from Customer" is for. Blank values are dropped rather than written as
 * nulls, so the INSERT leaves those columns to their defaults.
 *
 * Typed structurally, not as `Customer`: the caller holds a parsed
 * `CustomerInput`, whose optional text fields are `string | null | undefined`.
 * Taking the seven fields it actually reads keeps both shapes usable without a
 * cast and without this file importing the Zod types.
 *
 * Every key is OPTIONAL, not merely nullable. On `CustomerInput` these come off
 * `nullableText`, which makes the PROPERTY optional as well as its value — and
 * a `foo?: string | null` argument does not satisfy a `foo: string | null`
 * parameter however wide the value union is. `isBlank` covers absent, null and
 * "" identically, so nothing downstream has to care which one arrived.
 */
type MaybeText = string | null | undefined;

export function customerGeneralSeed(c: {
  currency_1?: MaybeText;
  currency_2?: MaybeText;
  currency_3?: MaybeText;
  ship_mode?: MaybeText;
  ship_type_id?: MaybeText;
  pay_mode?: MaybeText;
  gst_no?: MaybeText;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [
    "currency_1",
    "currency_2",
    "currency_3",
    "ship_mode",
    "ship_type_id",
    "pay_mode",
    "gst_no",
  ] as const) {
    const v = c[key];
    if (!isBlank(v)) out[key] = (v as string).trim();
  }
  return out;
}
