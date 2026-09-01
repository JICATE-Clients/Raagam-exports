"use server";

import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { ITEM_SUB_TYPE_OPTIONS } from "./combo-rules";

// ============================================================================
// Order Entry ▸ "Copy From SQ No" (0511)
//
// Client 2026-09-01: "copying from the SQ No should instantly pull the
// structure, estimated compositions, and initial parameters into the Confirmed
// Order (RE) layout to eliminate repetitive manual data entry."
//
//
// ## THE SQ KNOWS NOTHING ABOUT FABRIC, AND THAT IS THE WHOLE SHAPE OF THIS FILE
//
// `sq_details` is 29 commercial columns — quantities, dates, customer, excess,
// rejection, status. It carries no structure, no GSM, no composition. The
// estimation lives in the COSTING engine (0320), and an SQ reaches it only
// through the opportunity both hang off:
//
//     sq_details.opportunity_id  -> opportunities <- cost_sheets.opportunity_id
//     cost_sheets.id             <- ioc_fabric_rates.cost_sheet_id
//
// So the obvious query — join `ioc_fabric_rates` to `sq_details` — has nothing
// to join ON. It would compile, run, and return nothing for every SQ, which is
// the failure mode this repo keeps recording: a feature that looks built and
// answers empty. The two hops are traced from the catalog, not assumed.
//
//
// ## NAMES ARE RESOLVED HERE, NOT ON THE SCREEN
//
// `ioc_fabric_rates` stores `structure_name` and `composition_name` as TEXT —
// it is a costing sheet, written before any of this was a master row. The order
// stores uuids. `getOrderFabricSeed` already records why that translation
// belongs in the service: the screen holds the PICKER lists, which are the
// masters, and "a structure the order names but the master has since
// deactivated would resolve to nothing there, silently turning a seeded row
// into an unlabelled one". Same argument, so the same placement.
//
//
// ## IT ABSTAINS RATHER THAN GUESSES, AT EVERY FORK
//
// A name that matches no master resolves to NULL and the row still comes back —
// carrying the name it could not resolve, so the screen can show the operator
// what the quotation said and let them pick the master themselves. Dropping the
// row would hide an estimate; inventing a category would be worse. This is
// `compositionForStructure`'s rule ("abstain rather than guess"), which the
// combo tree already follows at five forks.
//
//
// ## NOTHING EXERCISES THIS YET
//
// Measured 2026-09-01, before it was written: `sq_details` 0 rows,
// `ioc_fabric_rates` 0 rows, `cost_sheets` 1, `opportunities` 2. There is no
// quotation in the system to copy from, so this is correct by construction and
// UNTESTED against real rows. The first real SQ is the test — check the
// abstentions behave before trusting what it fills in.
// ============================================================================

/** One Style Quotation, as the picker needs it. */
export type SqOption = {
  id: string;
  code: string | null;
  name: string;
};

/** One fabric estimation row of an SQ, with its masters resolved where they resolve. */
export type SqFabricRow = {
  sno: number;
  /** The `categories` row this structure names, or null when nothing matches. */
  structure_id: string | null;
  structure_name: string | null;
  /** The `compositions` row, or null when nothing matches. */
  composition_id: string | null;
  composition_name: string | null;
  gsm: number | null;
  /** solid | melange | yarn_dyed — only when the costing sheet said one of them. */
  item_sub_type: string | null;
  style_ref_no: string | null;
};

export type SqOptionsResult =
  | { ok: true; rows: SqOption[] }
  | { ok: false; error: string };

export type SqFabricResult =
  | { ok: true; rows: SqFabricRow[] }
  | { ok: false; error: string };

/**
 * The quotations an order can be raised from.
 *
 * CANCELLED ONES ARE EXCLUDED. `sq_details.is_cancelled` is the quotation's own
 * withdrawal, and copying a structure out of a cancelled estimate is copying a
 * number nobody stands behind any more. This is the "Disabled rows" rule in its
 * ordinary direction — the one carve-out there (keep the row a record already
 * holds) does not apply, because this list only ever STARTS a copy.
 */
export async function loadSqOptions(): Promise<SqOptionsResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { data, error } = await s
    .from("sq_details")
    .select("id, code, sq_description, sq_date")
    .eq("is_cancelled", false)
    .order("sq_date", { ascending: false });
  if (error) return { ok: false, error: error.message };

  type Row = {
    id: string;
    code: string | null;
    sq_description: string | null;
  };
  return {
    ok: true,
    rows: ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      code: r.code,
      /* THE DESCRIPTION IS THE NAME WHERE THERE IS ONE. A picker showing eight
         rows all reading "HO/SQ/2627/…" differs only in the digits an operator
         has to count; the description is what they actually recognise. Falls
         back to the code so a row is never nameless. */
      name: (r.sq_description ?? "").trim() || (r.code ?? "").trim() || "(untitled SQ)",
    })),
  };
}

/** The three the order's own Fabric Type column accepts. */
const SUB_TYPES = new Set<string>(ITEM_SUB_TYPE_OPTIONS.map((o) => o.value));

/**
 * One SQ's fabric estimation rows, masters resolved where they resolve.
 *
 * TWO HOPS AND A THIRD LOOKUP, all in one round trip each, because this runs on
 * a click rather than on a keystroke.
 */
export async function loadSqFabricEstimation(
  sqDetailId: string,
): Promise<SqFabricResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();

  const { data: sq, error: sqErr } = await s
    .from("sq_details")
    .select("opportunity_id")
    .eq("id", sqDetailId)
    .maybeSingle();
  if (sqErr) return { ok: false, error: sqErr.message };
  /* AN SQ WITH NO OPPORTUNITY IS NOT AN ERROR. `opportunity_id` is nullable, and
     a quotation raised outside an opportunity simply has no costing sheet to
     reach. Empty-and-explain belongs to the caller; here it is an empty list. */
  if (!sq?.opportunity_id) return { ok: true, rows: [] };

  const { data: sheets, error: sheetErr } = await s
    .from("cost_sheets")
    .select("id")
    .eq("opportunity_id", sq.opportunity_id);
  if (sheetErr) return { ok: false, error: sheetErr.message };
  const sheetIds = ((sheets ?? []) as { id: string }[]).map((r) => r.id);
  if (!sheetIds.length) return { ok: true, rows: [] };

  const { data: rates, error: rateErr } = await s
    .from("ioc_fabric_rates")
    .select(
      "sno, structure_name, composition_name, gsm, fabric_sub_type, style_ref_no",
    )
    .in("cost_sheet_id", sheetIds)
    .order("sno");
  if (rateErr) return { ok: false, error: rateErr.message };

  type Rate = {
    sno: number | null;
    structure_name: string | null;
    composition_name: string | null;
    gsm: number | null;
    fabric_sub_type: string | null;
    style_ref_no: string | null;
  };
  const raw = (rates ?? []) as unknown as Rate[];
  if (!raw.length) return { ok: true, rows: [] };

  /* RESOLVED IN TWO BULK READS, not one per row. A cost sheet legitimately
     carries a dozen fabrics, and a lookup per row would be a dozen round trips
     for a button press. Matched case-insensitively on the trimmed name because
     both sides are stored in capitals (AGENTS.md, "CAPITALS") but the costing
     sheet predates that rule. */
  const norm = (v: string | null) => (v ?? "").trim().toUpperCase();
  const wantStructures = [...new Set(raw.map((r) => norm(r.structure_name)).filter(Boolean))];
  const wantCompositions = [...new Set(raw.map((r) => norm(r.composition_name)).filter(Boolean))];

  const [catRes, compRes] = await Promise.all([
    wantStructures.length
      ? s.from("categories").select("id, name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    wantCompositions.length
      ? s.from("compositions").select("id, name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const byName = (rows: { id: string; name: string | null }[] | null) => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) {
      const k = norm(r.name);
      /* FIRST WINS, and a SECOND row of the same name is left unresolved rather
         than picked between. Two categories called COTTON is a masters problem;
         quietly choosing one of them here would make a copy that cannot be
         explained and that a re-run could answer differently. */
      if (k && !m.has(k)) m.set(k, r.id);
    }
    return m;
  };
  const cats = byName((catRes.data ?? []) as { id: string; name: string | null }[]);
  const comps = byName((compRes.data ?? []) as { id: string; name: string | null }[]);

  return {
    ok: true,
    rows: raw.map((r, i) => ({
      sno: r.sno ?? i + 1,
      structure_id: cats.get(norm(r.structure_name)) ?? null,
      structure_name: (r.structure_name ?? "").trim() || null,
      composition_id: comps.get(norm(r.composition_name)) ?? null,
      composition_name: (r.composition_name ?? "").trim() || null,
      gsm: r.gsm,
      /* ONLY A VALUE THE ORDER'S OWN COLUMN ACCEPTS. `ioc_fabric_rates` is a
         costing sheet with a free-text sub type; `item_sub_type` has a CHECK of
         exactly solid | melange | yarn_dyed (0480 withdrew `printed`). Anything
         else abstains rather than arriving as a value the combo cell cannot
         show and the server would reject on save. */
      item_sub_type: SUB_TYPES.has(norm(r.fabric_sub_type).toLowerCase())
        ? norm(r.fabric_sub_type).toLowerCase()
        : null,
      style_ref_no: (r.style_ref_no ?? "").trim() || null,
    })),
  };
}
