"use client";

import { useMemo, useState } from "react";
import {
  SimpleMasterScreen,
  type SimpleField,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { FIELD_WIDTH } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/segmented";
import { ASSIST_ICON_NAMES } from "@/components/resolve/chat/assist-icons";
import { saveCatalogArea, saveCatalogItem, setCatalogAreaInactive, setCatalogItemInactive } from "@/lib/resolve/catalog-actions";
import { ASSIST_LANES, type AssistLane } from "@/lib/resolve/assist-types";
import {
  LANE_LABEL,
  LANE_ROUTE_COLUMN,
  type CatalogAreaRow,
  type CatalogItemRow,
  type CatalogRouting,
  type RoutingCode,
} from "@/lib/resolve/catalog-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type View = "items" | "areas";
type ItemRow = CatalogItemRow & { area_label: string };

const ROUTE_LABEL: Record<AssistLane, string> = {
  fix: "Trade",
  it: "IT Category",
  buy: "",
  concern: "Complaint Category",
};

const words = (v: string[] | null | undefined) => (v ?? []).join(", ");

/** AGENTS "Disabled rows": an off code is not offered — except the one a row already holds. */
function codeOptions(list: RoutingCode[], held: Set<string>) {
  const seen = new Set<string>();
  return list
    .filter((c) => (!c.inactive || held.has(c.code)) && !seen.has(c.code) && seen.add(c.code))
    .map((c) => ({ value: c.code, label: `${c.name}${c.inactive ? " (inactive)" : ""}` }));
}

/**
 * Resolve Hub ▸ Administration ▸ Problem Catalog (0751) — the words Raagam
 * Assist offers a reporter, lane by lane: AREAS (level 1, ≤ 8 a lane) and the
 * PROBLEMS under them (level 2). Each problem names where it goes BY CODE — a
 * trade for Fix, an IT category for IT, a complaint category for Concern; Buy
 * always goes to the unit's Stores owner, so it routes by nothing.
 *
 * Shared master data, not per unit (the same factory words everywhere); the
 * routing codes offered are the CURRENT unit's. Delete switches a row off —
 * tickets point at a problem, and the chat drops an off row by itself.
 *
 * Search words and "what happened" chips are typed comma-separated. A problem
 * with no chips of its own uses its area's. Used is read-only: how many
 * tickets picked it, which is what orders the chat's list.
 */
export function ProblemCatalogScreen({
  areas,
  items,
  routing,
  perms,
}: {
  areas: CatalogAreaRow[];
  items: CatalogItemRow[];
  routing: CatalogRouting;
  perms: Perms;
}) {
  const [lane, setLane] = useState<AssistLane>("fix");
  const [view, setView] = useState<View>("items");

  const laneAreas = useMemo(() => areas.filter((a) => a.lane === lane), [areas, lane]);
  const laneItems = useMemo<ItemRow[]>(() => {
    const byId = new Map(laneAreas.map((a) => [a.id, a.label]));
    return items.filter((i) => byId.has(i.area_id)).map((i) => ({ ...i, area_label: byId.get(i.area_id) ?? "" }));
  }, [items, laneAreas]);

  const itemDescriptor = useMemo<SimpleMasterDescriptor<ItemRow>>(() => {
    const heldAreas = new Set(laneItems.map((i) => i.area_id));
    const areaOptions = laneAreas
      .filter((a) => !a.inactive || heldAreas.has(a.id))
      .map((a) => ({ value: a.id, label: a.inactive ? `${a.label} (inactive)` : a.label }));
    const routeCol = LANE_ROUTE_COLUMN[lane];
    const routeList = lane === "fix" ? routing.trades : lane === "it" ? routing.it : lane === "concern" ? routing.concern : [];
    const routeOptions = routeCol
      ? codeOptions(routeList, new Set(laneItems.map((i) => i[routeCol]).filter((c): c is string => !!c)))
      : [];

    const fields: SimpleField[] = [
      { key: "area_id", label: "Area", kind: "select", required: true, options: areaOptions, widthClass: FIELD_WIDTH.party },
      { key: "label", label: "Problem", required: true, widthClass: FIELD_WIDTH.name },
      { key: "code", label: "Code", mono: true, lockedOnEdit: true, widthClass: FIELD_WIDTH.term },
      { key: "synonyms", label: "Search Words", widthClass: FIELD_WIDTH.name },
      { key: "details", label: "What Happened", widthClass: FIELD_WIDTH.name },
    ];
    if (routeCol) {
      fields.push({ key: "route", label: ROUTE_LABEL[lane], kind: "select", options: routeOptions, widthClass: FIELD_WIDTH.party });
    }
    if (lane === "fix" || lane === "it") {
      fields.push({ key: "dangerous", label: "Dangerous", kind: "checkbox", widthClass: FIELD_WIDTH.hug });
    }
    fields.push({ key: "sort", label: "Sort", widthClass: FIELD_WIDTH.num });

    type Payload = {
      area_id: string;
      label: string;
      code: string;
      synonyms: string;
      details: string;
      dangerous: boolean;
      trade_code: string | null;
      sd_category_code: string | null;
      complaint_category_code: string | null;
      sort: string;
      inactive: boolean;
    };
    return {
      entityLabel: "Problem",
      status: "active",
      editor: "sheet",
      fields,
      extraColumns: [
        {
          header: "Used",
          cell: (r) => <span className="tabular-nums text-sm">{r.used_count}</span>,
        },
      ],
      mobileTitleKey: "label",
      fromRow: (r) => ({
        area_id: r.area_id,
        label: r.label,
        code: r.code,
        synonyms: words(r.synonyms),
        details: words(r.details),
        route: (routeCol && r[routeCol]) || "",
        dangerous: r.dangerous,
        sort: String(r.sort),
      }),
      searchText: (r) => [r.label, r.code, r.area_label, ...r.synonyms].join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      extraFilters: [
        {
          key: "area",
          label: "Area",
          options: laneAreas.map((a) => ({ value: a.id, label: a.label })),
          predicate: (r, v) => r.area_id === v,
        },
      ],
      dupCheck: { table: "rh_catalog_items", fieldKey: "label", nameColumn: "label", label: "problem" },
      spellSuggest: true,
      validate: (v) =>
        !v.area_id ? "Pick the area" : !/^\d{0,4}$/.test(String(v.sort ?? "").trim()) ? "Sort is a whole number" : null,
      toPayload: (v, s): Payload => {
        const route = String(v.route ?? "") || null;
        return {
          area_id: String(v.area_id),
          label: String(v.label),
          code: String(v.code ?? ""),
          synonyms: String(v.synonyms ?? ""),
          details: String(v.details ?? ""),
          dangerous: !!v.dangerous,
          trade_code: routeCol === "trade_code" ? route : null,
          sd_category_code: routeCol === "sd_category_code" ? route : null,
          complaint_category_code: routeCol === "complaint_category_code" ? route : null,
          sort: String(v.sort ?? "").trim() || "0",
          inactive: !s.active,
        };
      },
      actions: {
        create: ((p: Payload) => saveCatalogItem(p)) as never,
        update: ((id: string, p: Payload) => saveCatalogItem({ ...p, id })) as never,
        remove: async (id: string) => {
          const res = await setCatalogItemInactive(id, true);
          return res.ok ? { ok: true as const, inactive: true } : res;
        },
      },
    };
  }, [lane, laneAreas, laneItems, routing]);

  const areaDescriptor = useMemo<SimpleMasterDescriptor<CatalogAreaRow>>(() => {
    const iconOptions = [...new Set([...ASSIST_ICON_NAMES, ...laneAreas.map((a) => a.icon)])]
      .sort()
      .map((n) => ({ value: n, label: n }));
    type Payload = { lane: AssistLane; label: string; code: string; icon: string; details: string; sort: string; inactive: boolean };
    return {
      entityLabel: "Area",
      status: "active",
      editor: "sheet",
      fields: [
        { key: "label", label: "Area", required: true, widthClass: FIELD_WIDTH.party },
        { key: "code", label: "Code", mono: true, lockedOnEdit: true, widthClass: FIELD_WIDTH.code },
        { key: "icon", label: "Icon", kind: "select", required: true, options: iconOptions, widthClass: FIELD_WIDTH.code },
        { key: "details", label: "What Happened", widthClass: FIELD_WIDTH.name },
        { key: "sort", label: "Sort", widthClass: FIELD_WIDTH.num },
      ],
      extraColumns: [
        {
          header: "Problems",
          cell: (r) => <span className="tabular-nums text-sm">{items.filter((i) => i.area_id === r.id && !i.inactive).length}</span>,
        },
      ],
      mobileTitleKey: "label",
      fromRow: (r) => ({ label: r.label, code: r.code, icon: r.icon, details: words(r.details), sort: String(r.sort) }),
      searchText: (r) => [r.label, r.code, ...r.details].join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      dupCheck: { table: "rh_catalog_areas", fieldKey: "label", nameColumn: "label", scope: { lane }, label: "area" },
      spellSuggest: true,
      validate: (v) => (!/^\d{0,4}$/.test(String(v.sort ?? "").trim()) ? "Sort is a whole number" : null),
      toPayload: (v, s): Payload => ({
        lane,
        label: String(v.label),
        code: String(v.code ?? ""),
        icon: String(v.icon || "circle"),
        details: String(v.details ?? ""),
        sort: String(v.sort ?? "").trim() || "0",
        inactive: !s.active,
      }),
      actions: {
        create: ((p: Payload) => saveCatalogArea(p)) as never,
        update: ((id: string, p: Payload) => saveCatalogArea({ ...p, id })) as never,
        remove: async (id: string) => {
          const res = await setCatalogAreaInactive(id, true);
          return res.ok ? { ok: true as const, inactive: true } : res;
        },
      },
    };
  }, [lane, laneAreas, items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Lane"
          role="tablist"
          value={lane}
          onChange={setLane}
          options={ASSIST_LANES.map((l) => ({
            value: l,
            label: LANE_LABEL[l],
            count: items.filter((i) => !i.inactive && areas.some((a) => a.id === i.area_id && a.lane === l)).length,
          }))}
        />
        <ToggleGroup
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: "items", label: "Problems" },
            { value: "areas", label: "Areas" },
          ]}
        />
      </div>
      {view === "items" ? (
        <SimpleMasterScreen key={`items-${lane}`} rows={laneItems} perms={perms} descriptor={itemDescriptor} />
      ) : (
        <SimpleMasterScreen key={`areas-${lane}`} rows={laneAreas} perms={perms} descriptor={areaDescriptor} />
      )}
    </div>
  );
}
