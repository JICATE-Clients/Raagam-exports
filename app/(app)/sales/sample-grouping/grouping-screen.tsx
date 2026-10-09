"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Layers, LayoutGrid, Plus, Shirt, Users, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/segmented";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Stat } from "@/components/ui/stat";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { SelectionBar } from "@/components/ui/selection-bar";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { createdByFacet, createdDateFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { useToast } from "@/components/ui/toast";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import {
  batchingSaving,
  fmtKg,
  groupNetKg,
  groupingProblem,
  moqOrderWeight,
  purchaseBasis,
  sameGroupKey,
  seasonKey,
} from "@/lib/sales/sample-grouping/calc";
import {
  GROUP_STATUSES,
  GROUP_STATUS_LABEL,
  GROUP_STATUS_TONE,
  type GroupingCandidate,
  type GroupingData,
  type GroupRow,
} from "@/lib/sales/sample-grouping/types";
import { addToSampleGroup, createSampleGroup, deleteSampleGroup } from "@/lib/sales/sample-grouping/actions";
import { GroupSheet } from "./group-sheet";
import { AutoGroupSheet } from "./auto-group-sheet";

/**
 * Sample ▸ Grouping (doc/sample/product-grouping-specification.md).
 *
 * TWO VIEWS OF ONE SEASON, as the spec draws them (§3):
 *   Summary   — for management and the buyer: five figures and one row per
 *               group (the spec's "Client / Executive Summarized View").
 *   Detailed  — for the sample planner: every costed style's fabric, ticked
 *               and batched (the "Developer / Operations Detailed View").
 * The switch is the Season Report's own (PageHeader `actions`, a ToggleGroup),
 * and Season + Year sit under it as that report's do — a PAIR, both views.
 *
 * NOTHING ON THIS SCREEN IS TYPED BUT A GROUP'S TERMS. A row's kilos are its
 * costing's weights × Sample Entry's pieces (lib/sales/sample-grouping/calc.ts);
 * the screen sends candidate keys and the server weighs them again.
 *
 * The view, season and year live in the URL (`?view=&season=&year=`), so a
 * summary can be bookmarked or sent, and a refresh keeps the operator's place.
 */

type View = "summary" | "detailed";
type Pile = "ungrouped" | "grouped" | "all";

const CANDIDATE_FACETS: FacetGroup<GroupingCandidate>[] = [
  {
    title: "Buyer",
    icon: <Users />,
    facets: [
      { key: "buyer", label: "Buyer", value: (c) => c.customer },
      { key: "agent", label: "Agent", value: (c) => c.agent },
    ],
  },
  {
    title: "Fabric",
    icon: <Layers />,
    facets: [
      { key: "structure", label: "Fabric Category", value: (c) => c.fabric_structure, wide: true },
      { key: "blend", label: "Yarn Count / Blend", value: (c) => c.yarn_blend, wide: true },
    ],
  },
];

const GROUP_FACETS: FacetGroup<GroupRow>[] = [
  {
    title: "Group",
    icon: <Layers />,
    facets: [
      {
        key: "status",
        label: "Status",
        all: "All",
        counted: true,
        options: GROUP_STATUSES.map((s) => ({ value: s, label: GROUP_STATUS_LABEL[s] })),
        match: (g, v) => g.status === v,
      },
      { key: "structure", label: "Fabric Category", value: (g) => g.fabric_structure },
    ],
  },
  { title: "Created", icon: <Users />, facets: [createdDateFacet(), createdByFacet()] },
];

const styleLabel = (c: { sample_no: string | null; style_name: string }) => [c.sample_no, c.style_name].filter(Boolean).join(" · ") || "Style";
/** A Draft group follows its costings; past Draft its figures are frozen. */
const kgOfItem = (g: GroupRow, it: GroupRow["items"][number]) => (g.status === "draft" && it.live_kg != null ? it.live_kg : it.calculated_weight_kg);
const groupNet = (g: GroupRow) => (g.status === "draft" ? groupNetKg(g.items.map((it) => kgOfItem(g, it))) : g.net_required_weight_kg);
const groupBuy = (g: GroupRow) => (g.status === "draft" ? moqOrderWeight(groupNet(g), g.moq_kg, g.batch_kg) : g.moq_purchased_weight_kg);

/** Season and Year are a pair the filter states; "" means every season / year. */
const inSeason = (x: { season: string; season_year: number | null }, season: string, year: string) =>
  (!season || seasonKey(x.season) === seasonKey(season)) && (!year || String(x.season_year ?? "") === year);

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-muted text-muted-foreground">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <Shirt className="size-4" aria-hidden />
      )}
    </span>
  );
}

export function GroupingScreen({
  data,
  perms,
  initial,
}: {
  data: GroupingData;
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean; canRaiseIw: boolean };
  initial: { view: View; season: string; year: string };
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<View>(initial.view);
  const [season, setSeason] = useState(initial.season);
  const [year, setYear] = useState(initial.year);
  const [pile, setPile] = useState<Pile>("ungrouped");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [addTo, setAddTo] = useState("");
  const [autoOpen, setAutoOpen] = useState(false);
  const sel = useRowSelection();

  /** Keep the address honest — a refresh or a shared link reopens this view. */
  const remember = (patch: Partial<{ view: string; season: string; year: string }>) => {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(patch)) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    window.history.replaceState(null, "", url);
  };

  // ---- the season the screen is looking at ---------------------------------
  const seasons = useMemo(() => {
    const seen = new Map<string, string>();
    for (const x of [...data.candidates, ...data.groups]) if (x.season.trim()) seen.set(seasonKey(x.season), x.season.trim());
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [data]);
  const years = useMemo(() => {
    const ys = new Set<number>();
    for (const x of [...data.candidates, ...data.groups]) if (x.season_year != null) ys.add(x.season_year);
    return [...ys].sort((a, b) => b - a);
  }, [data]);
  const scopedCandidates = useMemo(() => data.candidates.filter((x) => inSeason(x, season, year)), [data.candidates, season, year]);
  const scopedGroups = useMemo(() => data.groups.filter((x) => inSeason(x, season, year)), [data.groups, season, year]);
  const scopedUncosted = data.uncosted.filter((x) => inSeason(x, season, year));

  // ---- Detailed: the candidates --------------------------------------------
  const candFacets = useFacetFilter(scopedCandidates, CANDIDATE_FACETS);
  const candMatches = candFacets.matches;
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scopedCandidates.filter((c) => {
      if (!candMatches(c)) return false;
      if (!needle) return true;
      return [c.enquiry_no, c.sample_no, c.style_name, c.customer, c.agent, c.fabric_structure, c.yarn_blend, c.group_code].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [scopedCandidates, query, candMatches]);
  const pileOf = (c: GroupingCandidate): Pile => (c.group_code ? "grouped" : "ungrouped");
  const shown = pile === "all" ? searched : searched.filter((c) => pileOf(c) === pile);
  const counts = { ungrouped: searched.filter((c) => !c.group_code).length, grouped: searched.filter((c) => c.group_code).length, all: searched.length };

  const picked = data.candidates.filter((c) => sel.selectedKeys.has(c.key));
  const pickProblem = picked.length ? groupingProblem(picked.map((c) => ({ ...c, label: styleLabel(c) }))) : null;
  const pickedNet = groupNetKg(picked.map((c) => c.kg));
  /** Draft groups these ticks could join — same season, year, structure and blend. */
  const joinable = !pickProblem && picked.length ? data.groups.filter((g) => g.status === "draft" && sameGroupKey(picked[0], g)) : [];

  // ---- Summary: the groups ---------------------------------------------------
  const groupFacets = useFacetFilter(scopedGroups, GROUP_FACETS);
  const groupMatches = groupFacets.matches;
  const groupsShown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scopedGroups.filter((g) => {
      if (!groupMatches(g)) return false;
      if (!needle) return true;
      return [g.group_code, g.fabric_structure, g.yarn_blend, g.iwo_code, ...g.items.map((it) => it.sample_no)].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [scopedGroups, query, groupMatches]);

  const pendingStyles = new Set(scopedCandidates.filter((c) => !c.group_code && c.kg != null && c.kg > 0).map((c) => c.style_id)).size;
  const activeGroups = scopedGroups.filter((g) => g.status !== "completed").length;
  const netAll = groupNetKg(scopedGroups.map(groupNet));
  const buyAll = groupNetKg(scopedGroups.map(groupBuy));
  const saving = batchingSaving(scopedGroups.map((g) => ({ itemKg: g.items.map((it) => kgOfItem(g, it)), moqKg: g.moq_kg, batchKg: g.batch_kg })));
  const open = openId ? (data.groups.find((g) => g.id === openId) ?? null) : null;

  // ---- writes ------------------------------------------------------------------
  const create = () =>
    startTransition(async () => {
      const res = await createSampleGroup([...sel.selectedKeys]);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(`${res.code} created with ${picked.length} style${picked.length === 1 ? "" : "s"}.`);
      sel.clear();
      router.refresh();
      setOpenId(res.id);
    });
  const join = () =>
    startTransition(async () => {
      const g = data.groups.find((x) => x.id === addTo);
      if (!g) return;
      const res = await addToSampleGroup(g.id, [...sel.selectedKeys]);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(`Added to ${g.group_code}.`);
      sel.clear();
      setAddTo("");
      router.refresh();
    });
  const del = (g: GroupRow) =>
    startTransition(async () => {
      const res = await deleteSampleGroup(g.id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(`${g.group_code} deleted — its styles are ungrouped again.`);
      router.refresh();
    });

  // ---- columns -----------------------------------------------------------------
  const candidateColumns: Column<GroupingCandidate>[] = [
    {
      header: "Sample No",
      cell: (c) => (
        <span className="font-mono text-xs">
          {c.sample_no ?? "—"}
          {c.enquiry_no ? <span className="block text-[11px] text-muted-foreground">{c.enquiry_no}</span> : null}
        </span>
      ),
    },
    {
      header: "Style",
      cell: (c) => (
        <span className="flex items-center gap-2">
          <Thumb url={c.thumb_url} />
          <Truncated className="block max-w-[11rem] text-xs font-medium">{c.style_name || "—"}</Truncated>
        </span>
      ),
    },
    { header: "Buyer", cell: (c) => <Truncated className="block max-w-[9rem] text-xs">{c.customer ?? "—"}</Truncated> },
    { header: "Component", cell: (c) => <Truncated className="block max-w-[8rem] text-xs">{c.components || "—"}</Truncated> },
    {
      header: "Structure · GSM",
      cell: (c) => (
        <span className="text-xs">
          {c.fabric_structure ?? "—"}
          {c.gsm != null ? <span className="text-muted-foreground"> · {c.gsm}</span> : null}
        </span>
      ),
    },
    { header: "Yarn blend", cell: (c) => <Truncated className="block max-w-[13rem] text-xs">{c.yarn_blend}</Truncated> },
    { header: "Qty (pcs)", align: "right", cell: (c) => <span className="block text-right font-mono tabular-nums text-xs">{c.sample_qty_pcs}</span> },
    {
      header: "Net kg",
      align: "right",
      cell: (c) =>
        c.kg == null ? (
          <span className="block text-right text-xs text-muted-foreground" title="The costing gives this fabric no garment weight">
            No weight
          </span>
        ) : (
          <span className="block text-right font-mono tabular-nums text-xs">{fmtKg(c.kg)}</span>
        ),
    },
    {
      header: "Group",
      cell: (c) =>
        c.group_id ? (
          <button type="button" onClick={() => setOpenId(c.group_id)} className="font-mono text-xs font-medium text-primary hover:underline">
            {c.group_code}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const groupColumns: Column<GroupRow>[] = [
    {
      header: "Group ID",
      cell: (g) => (
        <button type="button" onClick={() => setOpenId(g.id)} className="font-mono text-xs font-medium text-primary hover:underline">
          {g.group_code}
        </button>
      ),
    },
    { header: "Season - Year", cell: (g) => <span className="text-xs">{`${g.season} ${g.season_year}`}</span> },
    { header: "Styles", align: "right", cell: (g) => <span className="block text-right tabular-nums text-xs">{g.items.length}</span> },
    {
      header: "Shared fabric / yarn",
      cell: (g) => (
        <Truncated className="block max-w-[20rem] text-xs">{[g.fabric_structure, g.yarn_blend].filter(Boolean).join(" · ")}</Truncated>
      ),
    },
    { header: "Net kg", align: "right", cell: (g) => <span className="block text-right font-mono tabular-nums text-xs">{fmtKg(groupNet(g))}</span> },
    {
      header: "MOQ order kg",
      align: "right",
      cell: (g) => (
        <span className="block text-right font-mono tabular-nums text-xs">
          {fmtKg(groupBuy(g), 1)}
          <span className="block font-sans text-[11px] text-muted-foreground">{purchaseBasis(groupNet(g), g.moq_kg, g.batch_kg)}</span>
        </span>
      ),
    },
    { header: "Status", cell: (g) => <StatusPill tone={GROUP_STATUS_TONE[g.status]}>{GROUP_STATUS_LABEL[g.status]}</StatusPill> },
    rowActionsColumn((g) => (
      <RowActions
        label={g.group_code}
        view={false}
        lead={
          g.iwo_id ? (
            <RowIconAction
              label="Open IW"
              name={g.iwo_code ?? g.group_code}
              icon={FileText}
              className="text-primary"
              onClick={() => router.push(`/sales/sample-fabric-plan?open=${g.iwo_id}`)}
            />
          ) : undefined
        }
        onEdit={() => setOpenId(g.id)}
        canEdit={perms.canEdit}
        onDelete={() => del(g)}
        canDelete={perms.canDelete}
        deleteDisabledReason={g.status === "draft" ? null : `${GROUP_STATUS_LABEL[g.status]} — a group past Draft cannot be deleted.`}
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Grouping"
        description="Batch sample styles of one season that share a fabric and a yarn into one purchase — rounded to the mill's MOQ, then released back to each style for cutting."
        actions={
          <>
            {/* AUTO-GROUP (user 2026-10-09) — proposes the batches the season's
                costed styles fall into; nothing is saved until confirmed. On
                Detailed only: that is the planner's view, and the button acts
                on the season picked below. */}
            {view === "detailed" && perms.canCreate ? (
              <Button variant="outline" size="md" onClick={() => setAutoOpen(true)}>
                <Wand2 className="h-4 w-4" />
                Auto-group
              </Button>
            ) : null}
            <ToggleGroup<View>
              role="tablist"
              label="View"
              value={view}
              onChange={(v) => {
                setView(v);
                remember({ view: v });
              }}
              options={[
                { value: "summary", label: "Summary", icon: LayoutGrid },
                { value: "detailed", label: "Detailed", icon: Layers },
              ]}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Season</span>
          <Select
            value={season}
            onChange={(e) => {
              setSeason(e.target.value);
              remember({ season: e.target.value });
              sel.clear();
            }}
            aria-label="Season"
            className="w-44"
          >
            <option value="">All seasons</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Year</span>
          <Select
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              remember({ year: e.target.value });
              sel.clear();
            }}
            aria-label="Year"
            className="w-32"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {view === "summary" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Pending sample styles" value={pendingStyles} hint="costed, not yet in a group" tone={pendingStyles ? "warning" : "neutral"} />
            <Stat label="Active groups" value={activeGroups} hint={`${scopedGroups.length - activeGroups} completed`} />
            <Stat label="Consolidated fabric required" value={`${fmtKg(netAll)} kg`} hint="net, the costings' loss included" />
            <Stat label="Purchased batch weight" value={`${fmtKg(buyAll, 1)} kg`} hint="after MOQ rounding" />
            <Stat
              label="Waste saved by batching"
              value={saving.savedPct != null ? `${saving.savedPct}%` : "—"}
              hint={saving.savedPct != null ? `${fmtKg(saving.savedKg, 1)} kg less than buying per style` : "no groups yet"}
              tone={saving.savedKg > 0 ? "success" : "neutral"}
            />
          </div>
          <FilterBar
            search={query}
            onSearch={setQuery}
            searchPlaceholder="Search group, fabric, yarn or Sample No…"
            activeCount={groupFacets.activeCount}
            onReset={groupFacets.activeCount ? groupFacets.reset : undefined}
            panel={groupFacets.panel}
            right={`${groupsShown.length} of ${scopedGroups.length}`}
          />
          <div className="w-fit max-w-full">
            <DataTable
              columns={withCreatedColumns(groupColumns, groupsShown)}
              rows={groupsShown}
              compact
              getKey={(g) => g.id}
              empty={
                scopedGroups.length
                  ? "No groups match the search or filters."
                  : "No groups for this season yet — open Detailed, tick styles that share a fabric and yarn, and create one."
              }
            />
          </div>
        </>
      ) : (
        <>
          <FilterBar
            search={query}
            onSearch={setQuery}
            searchPlaceholder="Search Sample No, style, buyer, fabric or yarn…"
            activeCount={candFacets.activeCount}
            onReset={candFacets.activeCount ? candFacets.reset : undefined}
            panel={candFacets.panel}
            leading={
              <ToggleGroup<Pile>
                label="Grouping status"
                value={pile}
                onChange={(p) => {
                  setPile(p);
                  sel.clear();
                }}
                options={[
                  { value: "ungrouped", label: `Ungrouped (${counts.ungrouped})` },
                  { value: "grouped", label: `Grouped (${counts.grouped})` },
                  { value: "all", label: `All (${counts.all})` },
                ]}
              />
            }
            right={`${shown.length} of ${scopedCandidates.length}`}
          />

          {scopedUncosted.length ? (
            <p className="text-sm text-muted-foreground">
              {scopedUncosted.length} style{scopedUncosted.length === 1 ? " has" : "s have"} no saved costing yet, so {scopedUncosted.length === 1 ? "it has" : "they have"} no kilos to batch:{" "}
              {scopedUncosted.map((u) => u.sample_no ?? u.style_name).join(", ")}.{" "}
              <Link href="/sales/sample-costing" className="text-primary underline underline-offset-2">
                Open Costing
              </Link>
            </p>
          ) : null}

          <SelectionBar count={picked.length} onClear={sel.clear}>
            <span className={`mr-2 text-sm ${pickProblem ? "text-danger" : "text-muted-foreground"}`}>
              {pickProblem ?? `${fmtKg(pickedNet)} kg net → buys ${fmtKg(moqOrderWeight(pickedNet), 1)} kg at the 60 kg MOQ`}
            </span>
            {perms.canCreate && !pickProblem ? (
              // toolbar-size: exempt -- the selection bar is not the header row; every button in it is sm together
              <Button size="sm" disabled={isPending} onClick={create}>
                <Plus className="h-4 w-4" />
                {`Create group with ${picked.length} style${picked.length === 1 ? "" : "s"}`}
              </Button>
            ) : null}
            {perms.canEdit && joinable.length ? (
              <>
                <Select value={addTo} onChange={(e) => setAddTo(e.target.value)} aria-label="Add to existing group" className="w-48">
                  <option value="">Add to existing group…</option>
                  {joinable.map((g) => (
                    <option key={g.id} value={g.id}>
                      {`${g.group_code} · ${fmtKg(groupNet(g))} kg`}
                    </option>
                  ))}
                </Select>
                {/* toolbar-size: exempt -- the selection bar is not the header row */}
                <Button size="sm" variant="outline" disabled={isPending || !addTo} onClick={join}>
                  Add
                </Button>
              </>
            ) : null}
          </SelectionBar>

          <div className="w-fit max-w-full">
            <DataTable
              columns={candidateColumns}
              rows={shown}
              compact
              getKey={(c) => c.key}
              selectable={perms.canCreate || perms.canEdit}
              selectedKeys={sel.selectedKeys}
              onToggle={sel.toggle}
              onToggleAll={() => sel.toggleAll(shown.filter((c) => !c.group_code).map((c) => c.key))}
              empty={
                scopedCandidates.length
                  ? pile === "ungrouped" && counts.grouped && !counts.ungrouped
                    ? "Every costed style in this season is grouped — the counts above show where they are."
                    : "No styles match the search or filters."
                  : "No costed sample styles for this season yet. A style appears here once its costing is saved with a fabric and a garment weight."
              }
            />
          </div>
        </>
      )}

      {autoOpen ? <AutoGroupSheet candidates={scopedCandidates} groups={data.groups} onClose={() => setAutoOpen(false)} /> : null}
      {open ? <GroupSheet key={`${open.id}:${open.status}`} group={open} perms={perms} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
