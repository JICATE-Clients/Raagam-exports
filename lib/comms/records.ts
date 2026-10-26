import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import type { Module } from "@/lib/auth/types";
import {
  RECORD_KINDS,
  recordHref,
  recordKey,
  type RecordKind,
  type RecordPreview,
  type RecordRef,
} from "./types";

/**
 * ERP record links in messages (doc/slack.md/slack §8, comms phase 6).
 *
 * TWO GATES, BOTH THE VIEWER'S OWN, ON EVERY READ:
 *   1. the record's MODULE view permission (`can(module, "view")`) — the same
 *      permission the record's own screen requires; and
 *   2. the ROW itself, read with the viewer's session, so RLS (unit scoping,
 *      order access) decides exactly as it does on that screen.
 * A link a viewer fails either gate on resolves to nothing — the chip says
 * "not available to you", and neither the number nor the vendor leaks.
 *
 * NEVER the admin client here. A preview read with the service role would be
 * the link granting access, which is the one thing the spec forbids outright.
 *
 * NO AMOUNTS. The preview is number, party, status and date. A PO's total or
 * an order's FOB is not needed to recognise the document, and a chat is read
 * far more widely than the purchase screens are.
 *
 * Embeds name the FK column (`vendors!vendor_id`): purchase_orders has a
 * second FK to vendors (agent_id), and a bare `vendors(...)` is PGRST201-
 * ambiguous (AGENTS.md "A second FK breaks every existing embed").
 */

type Reader = {
  table: string;
  select: string;
  /** The column the operator searches by — the document number. */
  numberColumn: string;
  map: (row: Record<string, unknown>) => Omit<RecordPreview, "kind" | "href">;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const READERS: Record<RecordKind, Reader> = {
  purchase_order: {
    table: "purchase_orders",
    select: "id, code, status, order_date, vendors!vendor_id(name)",
    numberColumn: "code",
    map: (r) => ({
      id: r.id as string,
      number: (r.code as string | null) ?? "PO",
      party: one(r.vendors as { name: string } | { name: string }[] | null)?.name ?? null,
      status: (r.status as string | null) ?? null,
      date: (r.order_date as string | null) ?? null,
    }),
  },
  purchase_indent: {
    table: "purchase_indents",
    select: "id, code, status, department, required_date",
    numberColumn: "code",
    map: (r) => ({
      id: r.id as string,
      number: (r.code as string | null) ?? "Indent",
      party: (r.department as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      date: (r.required_date as string | null) ?? null,
    }),
  },
  sales_order: {
    table: "sales_orders",
    select: "id, order_number, status, ship_date, buyers!buyer_id(name)",
    numberColumn: "order_number",
    map: (r) => ({
      id: r.id as string,
      number: (r.order_number as string | null) ?? "Order",
      party: one(r.buyers as { name: string } | { name: string }[] | null)?.name ?? null,
      status: (r.status as string | null) ?? null,
      date: (r.ship_date as string | null) ?? null,
    }),
  },
};

const MAX_REFS = 50;

/**
 * Previews for the refs the caller may see, keyed by `recordKey`. A ref the
 * caller may not see is simply absent — the caller cannot tell "no such
 * record" from "not yours", and that is deliberate (guessed ids, spec §10).
 * One query per KIND, never one per link.
 */
export async function resolveRecords(refs: RecordRef[]): Promise<Record<string, RecordPreview>> {
  const out: Record<string, RecordPreview> = {};
  const byKind = new Map<RecordKind, string[]>();
  for (const r of refs.slice(0, MAX_REFS)) {
    const list = byKind.get(r.kind) ?? [];
    if (!list.includes(r.id)) list.push(r.id);
    byKind.set(r.kind, list);
  }
  if (byKind.size === 0) return out;

  const s = await createClient();
  await Promise.all(
    [...byKind].map(async ([kind, ids]) => {
      if (!(await can(RECORD_KINDS[kind].module as Module, "view"))) return;
      const reader = READERS[kind];
      const { data, error } = await s.from(reader.table).select(reader.select).in("id", ids);
      if (error) throw new Error(`Could not read linked ${RECORD_KINDS[kind].label.toLowerCase()}s: ${error.message}`);
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
        const p = reader.map(row);
        out[recordKey(kind, p.id)] = { ...p, kind, href: recordHref(kind, p.id) };
      }
    }),
  );
  return out;
}

/**
 * Records of one kind whose number matches, for the composer's "Link a record"
 * picker — newest first, through the caller's own RLS. Null when the caller
 * lacks the module's view permission, so the picker can say so instead of
 * showing an empty list that reads as "no such PO".
 */
export async function searchRecords(kind: RecordKind, query: string, limit = 10): Promise<RecordPreview[] | null> {
  if (!(await can(RECORD_KINDS[kind].module as Module, "view"))) return null;
  const reader = READERS[kind];
  const s = await createClient();
  let q = s
    .from(reader.table)
    .select(reader.select)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 20));
  const term = query.trim();
  if (term) q = q.ilike(reader.numberColumn, `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const { data, error } = await q;
  if (error) throw new Error(`Could not search ${RECORD_KINDS[kind].label.toLowerCase()}s: ${error.message}`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const p = reader.map(row);
    return { ...p, kind, href: recordHref(kind, p.id) };
  });
}
