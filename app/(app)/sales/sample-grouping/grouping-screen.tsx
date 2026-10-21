"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, CheckSquare, Layers, Plus, Square, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/segmented";
import { FilterBar } from "@/components/ui/filter-bar";
import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import { SampleCards, type SampleCardState } from "@/components/sales/sample-queue";
import { useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { useToast } from "@/components/ui/toast";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import {
  fmtKg,
  groupNetKg,
  groupingProblem,
  moqOrderWeight,
} from "@/lib/sales/sample-grouping/calc";
import {
  GROUP_STATUS_LABEL,
  type GroupingCandidate,
  type GroupingData,
  type GroupRow,
} from "@/lib/sales/sample-grouping/types";
import { createSampleGroup, deleteSampleGroup } from "@/lib/sales/sample-grouping/actions";
import { GroupSheet } from "./group-sheet";

/**
 * Sample ▸ Grouping (doc/sample/product-grouping-specification.md).
 *
 * TWO TABS, CARDS IN EACH (user 2026-10-12). The tables became the Orders
 * queue's cards the same day ("SMP entry will list as card"; `SampleCards`,
 * components/sales/sample-queue.tsx): Ungrouped is one card per sample, a tap
 * ticks it; Grouped is one card per SWO, a tap opens it. It was a Summary / Detailed
 * switch, then two tables on one page, then samples banded under their SWO —
 * each read the same samples twice. Now:
 *   Ungrouped — the costed samples not yet in an SWO, ticked into a new SWO
 *               or added to a Draft one;
 *   Grouped   — the SWOs, one row each. Their samples are NOT repeated here:
 *               they are listed inside the SWO itself ("sample will list
 *               inside the raised request — why listing in this page too").
 *
 * NOTHING ON THIS SCREEN IS TYPED BUT A GROUP'S TERMS. A row's kilos are its
 * costing's weights × Sample Entry's pieces (lib/sales/sample-grouping/calc.ts);
 * the screen sends candidate keys and the server weighs them again.
 *
 * SEASON AND YEAR ARE FILTERS, NOT BOXES (user 2026-10-15, screenshot 3540:
 * "two blank fields remove it — already we have filter option"). They stood as
 * two unlabelled dropdowns at the head of the row, beside a Filters button that
 * did the same job; they are now a "Season" group in that panel, on both tabs.
 * The `?season=&year=` address they kept went with them — nothing linked to it.
 */

/** Ungrouped = samples still to tick into an SWO; Grouped = the SWOs themselves. */
type Tab = "ungrouped" | "grouped";

/** Season · Year — one group, read off the row, shared by both tabs. */
const seasonFacets = <R extends { season: string; season_year: number | null }>(): FacetGroup<R> => ({
  title: "Season",
  icon: <CalendarRange />,
  facets: [
    { key: "season", label: "Season", value: (x) => x.season.trim() || null },
    { key: "year", label: "Year", value: (x) => (x.season_year != null ? String(x.season_year) : null) },
  ],
});

const CANDIDATE_FACETS: FacetGroup<GroupingCandidate>[] = [
  seasonFacets<GroupingCandidate>(),
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
const GROUP_FACETS: FacetGroup<GroupRow>[] = [seasonFacets<GroupRow>()];

/** A sample is named by its SMP number (spec 2026-10-12: "replace the PRD
 *  number with the SMP number"); the style line's PRD stays searchable. */
const styleLabel = (c: { enquiry_no: string | null; style_name: string }) => [c.enquiry_no, c.style_name].filter(Boolean).join(" · ") || "Style";
/** A Draft group follows its costings; past Draft its figures are frozen. */
const kgOfItem = (g: GroupRow, it: GroupRow["items"][number]) => (g.status === "draft" && it.live_kg != null ? it.live_kg : it.calculated_weight_kg);
const groupNet = (g: GroupRow) => (g.status === "draft" ? groupNetKg(g.items.map((it) => kgOfItem(g, it))) : g.net_required_weight_kg);
const groupBuy = (g: GroupRow) => (g.status === "draft" ? moqOrderWeight(groupNet(g), g.moq_kg, g.batch_kg) : g.moq_purchased_weight_kg);

export function GroupingScreen({
  data,
  perms,
}: {
  data: GroupingData;
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean; canRaiseIw: boolean };
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  // Opens on the work still to do; a season with nothing left opens on its SWOs.
  const [tab, setTab] = useState<Tab>(() => (data.candidates.some((c) => !c.group_id) ? "ungrouped" : "grouped"));
  const [openId, setOpenId] = useState<string | null>(null);
  const sel = useRowSelection();
  // Card View / List View, as the other Sample queues (PD Request, Costing).
  const viewMode = useViewMode("sample-grouping", "cards");

  const scopedCandidates = data.candidates;
  const groupFacets = useFacetFilter(data.groups, GROUP_FACETS);
  const groupMatches = groupFacets.matches;
  const scopedGroups = useMemo(() => data.groups.filter(groupMatches), [data.groups, groupMatches]);

  // ---- the styles to group --------------------------------------------
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
  const picked = data.candidates.filter((c) => sel.selectedKeys.has(c.key));
  const pickProblem = picked.length ? groupingProblem(picked.map((c) => ({ ...c, label: styleLabel(c) }))) : null;

  // ---- the two lists -----------------------------------------------------
  /* Every costed, ungrouped sample is offered. The PD Request is per SMP
     (0724) on Sample ▸ PD Request — it does not gate this list. */
  const loose = searched.filter((c) => !c.group_id);
  const looseKeys = loose.map((c) => c.key);
  /** An SWO matches the search on its own number, its IW, or a sample in it. */
  const groupsShown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return scopedGroups;
    return scopedGroups.filter((g) =>
      [g.group_code, g.iwo_code, g.fabric_structure, g.yarn_blend, ...g.items.map((it) => it.sample_no)].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [scopedGroups, query]);

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

  // ---- the cards -----------------------------------------------------------------
  const canPick = perms.canCreate || perms.canEdit;
  /** An SWO's state on its card: a Draft is still being put together; past it
   *  the group is made and the work moves to its plans. */
  const swoState = (g: GroupRow): SampleCardState => (g.status === "draft" ? "draft" : "updated");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Grouping"
        description="Batch samples that share a yarn and fabric lot into one Sample Work Order (SWO)."
      />

      {/* ONE ROW of controls, no section titles or counters (user 2026-10-12:
          "why this much message — clean UI"). */}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search SMP No, style, fabric, yarn or SWO…"
        activeCount={(tab === "ungrouped" ? candFacets : groupFacets).activeCount}
        onReset={(tab === "ungrouped" ? candFacets : groupFacets).activeCount ? (tab === "ungrouped" ? candFacets : groupFacets).reset : undefined}
        panel={(tab === "ungrouped" ? candFacets : groupFacets).panel}
        leading={
          <>
            <ToggleGroup<Tab>
              label="Show"
              value={tab}
              onChange={(t) => {
                setTab(t);
                sel.clear();
              }}
              options={[
                { value: "ungrouped", label: `Ungrouped (${looseKeys.length})` },
                { value: "grouped", label: `Grouped (${scopedGroups.length})` },
              ]}
            />
          </>
        }
        trailing={<ViewToggle value={viewMode.view} onChange={viewMode.setView} />}
      />


      {/* ONE ROW, READ LEFT TO RIGHT (user 2026-10-15, alignment option A):
          count + Clear, then the actions with
          Create last and filled. It was SelectionBar's two loose rows: the
          count alone on the left, the figures pushed right, the warning cut. */}
      {picked.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
        >
          <span className="text-sm font-semibold">{`${picked.length} selected`}</span>
          <button type="button" className="text-sm text-primary hover:underline" onClick={sel.clear}>
            Clear
          </button>
          {/* The kg figure and "Add to existing group" went (user 2026-10-15,
              "no need"; `addToSampleGroup` stays in actions.ts). A refusal still
              shows here: Create is hidden while one stands, and a button that
              vanishes with no reason reads as broken. */}
          {pickProblem ? <span className="text-sm text-danger">{pickProblem}</span> : null}
          <span className="flex-1" />
          {perms.canCreate && !pickProblem ? (
            // toolbar-size: exempt -- the selection bar is not the header row; every button in it is sm together
            <Button size="sm" disabled={isPending} onClick={create}>
              <Plus className="h-4 w-4" />
              {`Create group (${picked.length})`}
            </Button>
          ) : null}
        </div>
      ) : null}

      {tab === "ungrouped" ? (
        <>
          {/* "Tick all" with the count, above the cards. "Clear ticks" went:
              the bar's Clear does it (user 2026-10-15, option A). */}
          {canPick && looseKeys.length > 1 && sel.selectedKeys.size < looseKeys.length ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{`${looseKeys.length} to group`}</span>
              <button type="button" className="text-primary hover:underline" onClick={() => sel.toggleAll(looseKeys)}>
                Tick all
              </button>
            </div>
          ) : null}
          {/* ONE CARD PER SAMPLE (per sample and fabric, when a style was costed
              in two). A tap ticks it — the card body is one button, so a
              checkbox cannot sit inside it; the tick icon and the theme-coloured
              edge say which are picked, and the bar above acts on them. */}
          <SampleCards<GroupingCandidate>
            rows={loose}
            getKey={(c) => c.key}
            title={(c) => (
              <span className="inline-flex items-center gap-1.5 font-mono">
                {canPick ? (
                  sel.selectedKeys.has(c.key) ? (
                    <CheckSquare aria-hidden className="size-3.5 text-primary" />
                  ) : (
                    <Square aria-hidden className="size-3.5 text-muted-foreground" />
                  )
                ) : null}
                {c.enquiry_no ?? c.sample_no ?? "—"}
              </span>
            )}
            subtitle={(c) => [c.customer, c.style_name].filter(Boolean).join(" · ") || "—"}
            state={() => "pending"}
            /* No pill: every card here would say "To group", which the tab
               says already, and it took the SMP number's width (user
               2026-10-15). The queue's own card size, the same as Grouped's
               (user, screenshot 3501) — a `columns={3}` track stretched a lone
               card across half the pane (3502). */
            stats={(c) => [
              { label: "Pieces", value: String(c.sample_qty_pcs) },
              { label: "Net kg", value: c.kg == null ? "No weight" : fmtKg(c.kg, 1), lead: true },
              { label: "Fabric", value: c.fabric_structure ?? "—" },
            ]}
            onOpen={(c) => canPick && sel.toggle(c.key)}
            selected={(c) => sel.selectedKeys.has(c.key)}
            table={{ title: "SMP No", subtitle: "Customer · Style" }}
            view={viewMode.view}
            empty={
              scopedCandidates.length
                ? query || candFacets.activeCount
                  ? "Nothing matches the search or filters."
                  : "Every costed sample is grouped — see Grouped."
                : "No costed samples yet — a sample appears here once its costing is saved with a fabric and a garment weight."
            }
          />
        </>
      ) : (
        /* ONE CARD PER SWO, its SMP numbers under the number; a tap opens it.
           Delete stays on a Draft only — past it the database refuses. */
        <SampleCards<GroupRow>
          rows={groupsShown}
          getKey={(g) => g.id}
          title={(g) => <span className="font-mono">{g.group_code}</span>}
          subtitle={(g) => <span className="font-mono">{g.items.map((it) => it.enquiry_no ?? it.sample_no).filter(Boolean).join(" · ") || "—"}</span>}
          state={swoState}
          // The card's title IS the SWO number, so its pill says "Raised", not
          // "SWO raised" — the longer word squeezed SWO/26-27/0001 to "SWO/26-27/00…"
          // on a six-across card (user 2026-10-12, screenshot 3456).
          pillText={(g) => (g.status === "po_raised" ? "Raised" : GROUP_STATUS_LABEL[g.status])}
          stats={(g) => [
            { label: "Samples", value: String(g.items.length) },
            { label: "Net kg", value: fmtKg(groupNet(g), 1), lead: true },
            { label: "Buy kg", value: fmtKg(groupBuy(g), 1) },
          ]}
          onOpen={(g) => setOpenId(g.id)}
          footerNote={hasCreatedInfo(groupsShown) ? (g) => `Created ${createdMeta(g)}` : undefined}
          canDelete={perms.canDelete}
          canDeleteRow={(g) => g.status === "draft"}
          onDelete={del}
          isPending={isPending}
          table={{ title: "SWO No", subtitle: "Samples" }}
          view={viewMode.view}
          empty={data.groups.length ? "Nothing matches the search or filters." : "No SWOs yet — tick samples under Ungrouped and create one."}
        />
      )}

      {open ? (
        <GroupSheet
          key={`${open.id}:${open.status}`}
          group={open}
          candidates={data.candidates}
          perms={perms}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
