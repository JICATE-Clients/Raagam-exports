"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus, TriangleAlert } from "lucide-react";
import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { Button } from "@/components/ui/button";
import { FIELD_WIDTH } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { ASSIST_ICON_NAMES, assistIcon } from "@/components/resolve/chat/assist-icons";
import { CatalogItemSheet, type CatalogEdit } from "@/components/resolve/admin/catalog-item-sheet";
import { useAccordion } from "@/lib/ui/use-accordion";
import { cn } from "@/lib/utils";
import { saveCatalogArea, setCatalogAreaInactive } from "@/lib/resolve/catalog-actions";
import { ASSIST_LANES, type AssistLane } from "@/lib/resolve/assist-types";
import {
  LANE_LABEL,
  LANE_ROUTE_COLUMN,
  type CatalogAreaRow,
  type CatalogItemRow,
  type CatalogRouting,
} from "@/lib/resolve/catalog-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type View = "items" | "areas";

const words = (v: string[] | null | undefined) => (v ?? []).join(", ");

/** The lane's tint on an area tile — the same four hues the chat uses per lane. */
const LANE_TILE: Record<AssistLane, string> = {
  fix: "bg-warning-soft text-warning",
  it: "bg-info-soft text-info",
  buy: "bg-success-soft text-success",
  concern: "bg-accent-soft text-accent",
};

/**
 * Resolve Hub ▸ Administration ▸ Problem Catalog (0751) — the words Raagam
 * Assist offers a reporter, lane by lane: AREAS (level 1, ≤ 8 a lane) and the
 * PROBLEMS under them (level 2, "choices" on screen). Each problem names where
 * it goes BY CODE — a trade for Fix, an IT category for IT, a concern category
 * for Concern; Buy always goes to the unit's Stores owner, so it routes by
 * nothing.
 *
 * THE CHOICES ARE SHOWN THE WAY THE CHAT OFFERS THEM (mobile redesign,
 * 2026-10-26): lane chips, then each area as a fold holding its choices — one
 * area open at a time (`useAccordion`; a search opens every area it matched),
 * each choice with ⚠ when dangerous, where it goes and how often it was
 * picked, and "+ Add choice" inside the area so a new one starts in the right
 * place. A choice opens in `CatalogItemSheet`. The "Areas" view keeps the
 * area master as it was.
 *
 * Shared master data, not per unit (the same factory words everywhere); the
 * routing codes offered are the CURRENT unit's. Switching off a row hides it
 * from the chat — tickets point at a problem, so nothing is deleted.
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
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<CatalogEdit | null>(null);
  const fold = useAccordion(null);

  const laneAreas = useMemo(() => areas.filter((a) => a.lane === lane), [areas, lane]);
  const routeCol = LANE_ROUTE_COLUMN[lane];
  const routeList = useMemo(
    () => (lane === "fix" ? routing.trades : lane === "it" ? routing.it : lane === "concern" ? routing.concern : []),
    [lane, routing],
  );
  const routeName = useMemo(() => new Map(routeList.map((c) => [c.code, c.name])), [routeList]);

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

  // Every word typed must appear in the choice, its search words, or its area.
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (a: CatalogAreaRow, i: CatalogItemRow) => {
    const hay = [i.label, i.code, a.label, ...i.synonyms].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  };
  const groups = laneAreas
    .map((a) => ({
      area: a,
      choices: items.filter((i) => i.area_id === a.id && (!terms.length || matches(a, i))),
    }))
    .filter((g) => !terms.length || g.choices.length > 0);

  const laneCount = (l: AssistLane) =>
    items.filter((i) => !i.inactive && areas.some((a) => a.id === i.area_id && a.lane === l)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Lane"
          role="tablist"
          value={lane}
          onChange={(l) => {
            setLane(l);
            fold.close();
          }}
          options={ASSIST_LANES.map((l) => ({ value: l, label: LANE_LABEL[l], count: laneCount(l) }))}
        />
        <ToggleGroup
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: "items", label: "Choices" },
            { value: "areas", label: "Areas" },
          ]}
        />
      </div>

      {view === "areas" ? (
        <SimpleMasterScreen key={`areas-${lane}`} rows={laneAreas} perms={perms} descriptor={areaDescriptor} />
      ) : (
        <div className="max-w-[48rem] space-y-2">
          {/* caps-input: exempt -- a search query is not a stored value */}
          <Input
            type="search"
            aria-label="Search choices"
            placeholder="Search choices, search words or areas…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {groups.length === 0 && (
            <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
              {terms.length ? "Nothing matches that search." : `No areas in ${LANE_LABEL[lane]} yet — add one under Areas.`}
            </p>
          )}
          {groups.map(({ area, choices }) => {
            // A search opens every area it matched, so no hit sits behind a fold.
            const open = terms.length > 0 || fold.isOpen(area.id);
            const Icon = assistIcon(area.icon);
            const live = choices.filter((c) => !c.inactive).length;
            return (
              <section key={area.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => fold.toggle(area.id)}
                  className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={cn("flex size-9 items-center justify-center rounded-lg", LANE_TILE[lane])}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <Truncated text={area.label} className="text-sm font-semibold" />
                  <span className="flex items-center gap-1.5">
                    {area.inactive && <StatusPill tone="neutral">Inactive</StatusPill>}
                    <span className="text-xs tabular-nums text-muted-foreground">{live}</span>
                  </span>
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
                </button>
                {open && (
                  <div className="border-t border-border">
                    <ul className="divide-y divide-border">
                      {choices.map((c) => {
                        const to = routeCol && c[routeCol] ? routeName.get(c[routeCol] as string) ?? c[routeCol] : null;
                        const where = lane === "buy" ? "Stores" : to ?? "default routing";
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              disabled={!perms.canEdit}
                              onClick={() => setEdit({ kind: "edit", item: c })}
                              className={cn(
                                "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent",
                                c.inactive && "opacity-60",
                              )}
                            >
                              <span className="min-w-0">
                                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                                  {c.dangerous && <TriangleAlert className="size-3.5 shrink-0 text-danger" aria-label="Dangerous" />}
                                  <Truncated text={c.label} />
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  → {where}
                                  {c.dangerous && " · urgent"}
                                </span>
                              </span>
                              <span className="flex items-center gap-1.5">
                                {c.inactive && <StatusPill tone="neutral">Off</StatusPill>}
                                <span className="text-xs font-medium tabular-nums text-muted-foreground">used {c.used_count}×</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {perms.canCreate && (
                      <div className="border-t border-border px-1.5 py-1">
                        <Button variant="ghost" onClick={() => setEdit({ kind: "new", areaId: area.id })}>
                          <Plus aria-hidden />
                          Add choice
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <CatalogItemSheet
        edit={edit}
        onClose={() => setEdit(null)}
        lane={lane}
        areas={laneAreas}
        items={items}
        routeList={routeList}
      />
    </div>
  );
}
