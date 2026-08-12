"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { componentInput, type ComponentInput } from "./component-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/components");
}

/** Drop blank coordinate rows and renumber sno 1..n. */
function normalizeCoordinates(data: ComponentInput): { sno: number; coordinate: string }[] {
  return (data.coordinates ?? [])
    .map((c) => ({ ...c, coordinate: c.coordinate.trim() }))
    .filter((c) => c.coordinate.length > 0)
    .map((c, i) => ({ sno: i + 1, coordinate: c.coordinate }));
}

export async function createComponent(data: ComponentInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = componentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { coordinates: _drop, ...header } = p.data;
  void _drop;
  const dup = await checkDuplicateName(s, "components", header.short_name, { nameColumn: "short_name" });
  if (!dup.ok) return fail(dup.error);
  const { data: created, error } = await s
    .from("components")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeCoordinates(p.data);
  if (rows.length) {
    const { error: cErr } = await s
      .from("component_coordinates")
      .insert(rows.map((r) => ({ ...r, component_id: created.id })));
    if (cErr) return fail(cErr.message);
  }
  rev();
  return { ok: true };
}

/**
 * "+ Add" on a Component picker — creates the row AND hands back its id, so the
 * field the operator opened can select what they just typed.
 *
 * A separate export rather than a wider return on `createComponent`, following
 * `createCountryQuick` and `quickCreateMaterial`: those callers check `ok` and
 * nothing else, and this is additive.
 *
 * NAME-ONLY IS COMPLETE HERE, which is the whole reason a Component picker can
 * offer inline create at all. The Components master screen asks for the name and
 * the status and nothing else (client 2026-08-05, "remove the description field
 * and maintain only name … and that check box"), so this writes exactly what
 * that screen writes: `description`, `all_coordinates` and the coordinate list
 * are left to the table's own defaults, and a row born here is indistinguishable
 * from one born on the master. That is NOT true of most `RecordPicker` targets —
 * a name-only Vendor is unusable — which is why the affordance belongs on this
 * master and not on that shared picker.
 *
 * Same duplicate guard as `createComponent`. It is the guard that matters: the
 * operator cannot see the master list from a Style row, so nothing on screen
 * tells them COLLAR already exists.
 */
export async function createComponentQuick(
  name: string,
): Promise<{ ok: true; id: string } | Failure> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = componentInput.safeParse({ short_name: name, inactive: false });
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { coordinates: _drop, ...header } = p.data;
  void _drop;
  const dup = await checkDuplicateName(s, "components", header.short_name, {
    nameColumn: "short_name",
  });
  if (!dup.ok) return fail(dup.error);
  const { data: created, error } = await s
    .from("components")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: created.id };
}

export async function updateComponent(id: string, data: ComponentInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = componentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { coordinates: _drop, ...header } = p.data;
  void _drop;
  const dup = await checkDuplicateName(s, "components", header.short_name, {
    nameColumn: "short_name",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("components").update(header).eq("id", id);
  if (error) return fail(error.message);
  // NOT SENT = NOT CHANGED. The screen asks for the Name alone now, so a rename
  // must not touch a component's coordinate list — and this replaces that list
  // WHOLESALE, so an absent `coordinates` reaching here as `[]` would delete it
  // rather than leave it. `[]` still clears, deliberately: that is a caller
  // saying "no coordinates", which is a different statement from not saying
  // anything. Same rule for the header keys, which Zod simply omits.
  if (p.data.coordinates !== undefined) {
    const { error: delErr } = await s.from("component_coordinates").delete().eq("component_id", id);
    if (delErr) return fail(delErr.message);
    const rows = normalizeCoordinates(p.data);
    if (rows.length) {
      const { error: cErr } = await s
        .from("component_coordinates")
        .insert(rows.map((r) => ({ ...r, component_id: id })));
      if (cErr) return fail(cErr.message);
    }
  }
  rev();
  return { ok: true };
}

export async function deleteComponent(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // `inactive`, not "blocked": `components` has no `blocked` column (0228), so
  // the soft-disable patch would have failed on the day a component was first
  // in use — the one path that never ran, because `component_coordinates` is its
  // only referrer and that FK cascades (0344 ignores CASCADE by design).
  const res = await deleteOrDeactivate(s, "components", id, "inactive"); // coordinates cascade
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
