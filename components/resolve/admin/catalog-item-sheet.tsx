"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { ActiveField } from "@/components/ui/active-field";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useToast } from "@/components/ui/toast";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { saveCatalogItem } from "@/lib/resolve/catalog-actions";
import type { AssistLane } from "@/lib/resolve/assist-types";
import { LANE_ROUTE_COLUMN, type CatalogAreaRow, type CatalogItemRow, type RoutingCode } from "@/lib/resolve/catalog-types";

export const ROUTE_LABEL: Record<AssistLane, string> = {
  fix: "Trade",
  it: "IT Category",
  buy: "",
  concern: "Concern Category",
};

const words = (v: string[] | null | undefined) => (v ?? []).join(", ");

/** AGENTS "Disabled rows": an off code is not offered — except the one a row already holds. */
export function codeOptions(list: RoutingCode[], held: Set<string>) {
  const seen = new Set<string>();
  return list
    .filter((c) => (!c.inactive || held.has(c.code)) && !seen.has(c.code) && seen.add(c.code))
    .map((c) => ({ value: c.code, label: `${c.name}${c.inactive ? " (inactive)" : ""}` }));
}

type Form = {
  area_id: string;
  label: string;
  code: string;
  synonyms: string;
  details: string;
  route: string;
  dangerous: boolean;
  sort: string;
  inactive: boolean;
};
const blankForm = (areaId: string): Form => ({
  area_id: areaId,
  label: "",
  code: "",
  synonyms: "",
  details: "",
  route: "",
  dangerous: false,
  sort: "",
  inactive: false,
});

/** What the sheet is opened on: a new choice (in an area) or an existing one. */
export type CatalogEdit = { kind: "new"; areaId: string } | { kind: "edit"; item: CatalogItemRow };

/**
 * The editor for one Problem Catalog CHOICE (an item) — the same fields,
 * checks and save the catalog's generic master sheet had, lifted out so the
 * area accordion can open it on a row, or on "+ Add choice" with the area
 * already filled in (mobile redesign, 2026-10-26).
 *
 * Kept from the descriptor it replaces: Problem required, unique across the
 * catalog while typing (`useDuplicateName`, same table and column the save's
 * guard checks) with near-miss chips; the code locked once saved; the route
 * picker for the lane's routing column only; Dangerous for Fix and IT only;
 * Sort a whole number. "Delete" is the Active switch — tickets point at a
 * choice, so it is switched off, never removed.
 */
export function CatalogItemSheet({
  edit,
  onClose,
  lane,
  areas,
  items,
  routeList,
}: {
  edit: CatalogEdit | null;
  onClose: () => void;
  lane: AssistLane;
  /** This lane's areas. */
  areas: CatalogAreaRow[];
  /** EVERY item — the duplicate check and the near-miss chips span the catalog. */
  items: CatalogItemRow[];
  routeList: RoutingCode[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const open = edit !== null;
  const editing = edit?.kind === "edit" ? edit.item : null;
  const routeCol = LANE_ROUTE_COLUMN[lane];

  const [form, setForm] = useState<Form>(() => blankForm(""));
  const [dirty, setDirty] = useState(false);
  const [shownFor, setShownFor] = useState<CatalogEdit | null>(null);
  useUnsavedGuard(open && (dirty || isPending));

  // A new edit target re-seeds the form — derived during render, not in an
  // effect, so the first paint already shows the right values.
  if (edit !== shownFor) {
    setShownFor(edit);
    if (edit?.kind === "edit") {
      const r = edit.item;
      setForm({
        area_id: r.area_id,
        label: r.label,
        code: r.code,
        synonyms: words(r.synonyms),
        details: words(r.details),
        route: (routeCol && r[routeCol]) || "",
        dangerous: r.dangerous,
        sort: String(r.sort),
        inactive: r.inactive,
      });
    } else if (edit) {
      setForm(blankForm(edit.areaId));
    }
    setDirty(false);
  }

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const dupError = useDuplicateName({
    table: "rh_catalog_items",
    name: form.label,
    nameColumn: "label",
    label: "problem",
    excludeId: editing?.id,
    enabled: open && !!form.label.trim(),
    rows: items,
    rowId: (r) => r.id,
    rowValue: (r) => r.label,
  });
  const suggestNames = useMemo(
    () => items.filter((i) => i.id !== editing?.id).map((i) => i.label),
    [items, editing?.id],
  );
  const suggest = useSpellSuggest({
    name: form.label,
    names: suggestNames,
    seed: [],
    enabled: open,
    onApply: (v) => set({ label: v }),
  });

  const heldAreas = new Set(items.map((i) => i.area_id));
  const areaOptions = areas
    .filter((a) => !a.inactive || heldAreas.has(a.id) || a.id === form.area_id)
    .map((a) => ({ value: a.id, label: a.inactive ? `${a.label} (inactive)` : a.label }));
  const routeOptions = routeCol
    ? codeOptions(routeList, new Set([...items.map((i) => i[routeCol]), form.route].filter((c): c is string => !!c)))
    : [];

  const sortOk = /^\d{0,4}$/.test(form.sort.trim());
  const canSave = !!form.area_id && !!form.label.trim() && sortOk && !dupError && !isPending;

  function submit() {
    if (!canSave) return;
    const route = form.route || null;
    startTransition(async () => {
      const res = await saveCatalogItem({
        id: editing?.id,
        area_id: form.area_id,
        label: form.label.trim(),
        code: form.code.trim(),
        synonyms: form.synonyms.trim(),
        details: form.details.trim(),
        dangerous: form.dangerous,
        trade_code: routeCol === "trade_code" ? route : null,
        sd_category_code: routeCol === "sd_category_code" ? route : null,
        complaint_category_code: routeCol === "complaint_category_code" ? route : null,
        sort: form.sort.trim() || "0",
        inactive: form.inactive,
      });
      if (res.ok) {
        success(editing ? "Choice updated." : "Choice added.");
        setDirty(false);
        onClose();
        router.refresh();
      } else error(res.error);
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      title={editing ? `Edit ${editing.label}` : "New choice"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={submit}>
            {isPending ? "Saving…" : "Save choice"}
          </Button>
        </>
      }
    >
      {/* 88 status + 200 area + 288 problem + 2 × 12px gap = 600px → 38rem. */}
      <div className="max-w-[46rem] space-y-4">
        <FieldRow>
          <ActiveField id="rh-cat-active" active={!form.inactive} onChange={(on) => set({ inactive: !on })} isNew={!editing} />
          <Field label="Area" required w="party" htmlFor="rh-cat-area">
            <Select id="rh-cat-area" value={form.area_id} onChange={(e) => set({ area_id: e.target.value })}>
              <option value="" />
              {areaOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Problem" required w="name" htmlFor="rh-cat-label">
            <Input
              id="rh-cat-label"
              value={form.label}
              onChange={(e) => set({ label: e.target.value })}
              onKeyDown={suggest.onKeyDown}
              {...dupFieldProps(dupError, "rh-cat-label")}
            />
            <DuplicateError error={dupError} id="rh-cat-label" />
            <SpellSuggestHint
              suggestions={suggest.suggestions}
              existing={suggest.existing}
              activeIndex={suggest.activeIndex}
              duplicate={!!dupError}
              onApply={(v) => set({ label: v })}
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Code" w="term" htmlFor="rh-cat-code" hint={editing ? "Fixed once saved" : "Blank = made from the words"}>
            {editing ? (
              <span id="rh-cat-code" className="flex min-h-9 items-center font-mono text-sm">
                {form.code}
              </span>
            ) : (
              <Input id="rh-cat-code" className="font-mono" value={form.code} onChange={(e) => set({ code: e.target.value })} />
            )}
          </Field>
          {routeCol && (
            <Field label={ROUTE_LABEL[lane]} w="party" htmlFor="rh-cat-route">
              <Select id="rh-cat-route" value={form.route} onChange={(e) => set({ route: e.target.value })}>
                <option value="" />
                {routeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {(lane === "fix" || lane === "it") && (
            <Field label="Dangerous" w="hug" htmlFor="rh-cat-danger">
              <span className="flex min-h-9 items-center">
                <Toggle id="rh-cat-danger" checked={form.dangerous} onChange={(on) => set({ dangerous: on })} tone="primary" />
              </span>
            </Field>
          )}
          <Field label="Sort" w="num" htmlFor="rh-cat-sort" error={sortOk ? undefined : "Sort is a whole number"}>
            <Input id="rh-cat-sort" inputMode="numeric" value={form.sort} onChange={(e) => set({ sort: e.target.value })} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Search Words" w="name" htmlFor="rh-cat-syn" hint="Comma-separated">
            <Input id="rh-cat-syn" value={form.synonyms} onChange={(e) => set({ synonyms: e.target.value })} />
          </Field>
          <Field label="What Happened" w="name" htmlFor="rh-cat-details" hint="Comma-separated chips; blank = the area's">
            <Input id="rh-cat-details" value={form.details} onChange={(e) => set({ details: e.target.value })} />
          </Field>
        </FieldRow>
      </div>
    </Sheet>
  );
}
