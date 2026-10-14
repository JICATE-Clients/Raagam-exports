"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckSquare, Layers, Plus, Square, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/segmented";
import { FilterBar } from "@/components/ui/filter-bar";
import { SelectionBar } from "@/components/ui/selection-bar";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import { SampleCards, type SampleCardState } from "@/components/sales/sample-queue";
import { useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { useToast } from "@/components/ui/toast";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import {
  fmtKg,
  groupNetKg,
  groupingMix,
  groupingProblem,
  moqOrderWeight,
  sameSeasonYear,
  seasonKey,
} from "@/lib/sales/sample-grouping/calc";
import {
  GROUP_STATUS_LABEL,
  type GroupingCandidate,
  type GroupingData,
  type GroupRow,
} from "@/lib/sales/sample-grouping/types";
import { addToSampleGroup, createSampleGroup, deleteSampleGroup } from "@/lib/sales/sample-grouping/actions";
import { canRaisePd } from "@/lib/sales/pd-requests/types";
import { PD_STATUS_LABEL } from "@/lib/sales/sample-entry/types";
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
 * Season and year live in the URL (`?season=&year=`), so a refresh or a shared
 * link keeps the operator's place.
 */

/** Ungrouped = samples still to tick into an SWO; Grouped = the SWOs themselves. */
type Tab = "ungrouped" | "grouped";

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

/** A sample is named by its SMP number (spec 2026-10-12: "replace the PRD
 *  number with the SMP number"); the style line's PRD stays searchable. */
const styleLabel = (c: { enquiry_no: string | null; style_name: string }) => [c.enquiry_no, c.style_name].filter(Boolean).join(" · ") || "Style";
/** A Draft group follows its costings; past Draft its figures are frozen. */
const kgOfItem = (g: GroupRow, it: GroupRow["items"][number]) => (g.status === "draft" && it.live_kg != null ? it.live_kg : it.calculated_weight_kg);
const groupNet = (g: GroupRow) => (g.status === "draft" ? groupNetKg(g.items.map((it) => kgOfItem(g, it))) : g.net_required_weight_kg);
const groupBuy = (g: GroupRow) => (g.status === "draft" ? moqOrderWeight(groupNet(g), g.moq_kg, g.batch_kg) : g.moq_purchased_weight_kg);

/** Season and Year are a pair the filter states; "" means every season / year. */
const inSeason = (x: { season: string; season_year: number | null }, season: string, year: string) =>
  (!season || seasonKey(x.season) === seasonKey(season)) && (!year || String(x.season_year ?? "") === year);

export function GroupingScreen({
  data,
  perms,
  initial,
}: {
  data: GroupingData;
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean; canRaiseIw: boolean };
  initial: { season: string; year: string };
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [season, setSeason] = useState(initial.season);
  const [year, setYear] = useState(initial.year);
  const [query, setQuery] = useState("");
  // Opens on the work still to do; a season with nothing left opens on its SWOs.
  const [tab, setTab] = useState<Tab>(() => (data.candidates.some((c) => !c.group_id) ? "ungrouped" : "grouped"));
  const [openId, setOpenId] = useState<string | null>(null);
  const [addTo, setAddTo] = useState("");
  const sel = useRowSelection();

  /** Keep the address honest — a refresh or a shared link reopens this view. */
  const remember = (patch: Partial<{ season: string; year: string }>) => {
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
  /** What the ticks mix — said, never refused (client spec 2026-10-12: the
   *  planner judges which blends and structures are compatible). */
  const pickMix = !pickProblem && picked.length ? groupingMix(picked) : null;
  const pickedNet = groupNetKg(picked.map((c) => c.kg));
  /** SWOs these ticks could join — the same season and year (0707); any
   *  status since 0713 made an SWO's samples editable throughout. */
  const joinable = !pickProblem && picked.length ? data.groups.filter((g) => sameSeasonYear(picked[0], g)) : [];

  // ---- the two lists -----------------------------------------------------
  /* Every costed, ungrouped sample is offered. The PD Request comes AFTER
     grouping, one per SWO (user 2026-10-14) — it no longer gates this list. */
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
        activeCount={tab === "ungrouped" ? candFacets.activeCount : 0}
        onReset={tab === "ungrouped" && candFacets.activeCount ? candFacets.reset : undefined}
        panel={tab === "ungrouped" ? candFacets.panel : undefined}
        leading={
          <>
            <Select
              value={season}
              onChange={(e) => {
                setSeason(e.target.value);
                remember({ season: e.target.value });
                sel.clear();
              }}
              aria-label="Season"
              className="w-40"
            >
              <option value="">All seasons</option>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
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
      />

      {scopedUncosted.length ? (
        <p className="text-sm text-muted-foreground">
          {`${scopedUncosted.length} style${scopedUncosted.length === 1 ? "" : "s"} not costed yet: ${scopedUncosted.map((u) => u.smp_no ?? u.style_name).join(", ")}.`}{" "}
          <Link href="/sales/sample-costing" className="text-primary underline underline-offset-2">
            Open Costing
          </Link>
        </p>
      ) : null}

      <SelectionBar count={picked.length} onClear={sel.clear}>
        <span className={`mr-2 text-sm ${pickProblem ? "text-danger" : "text-muted-foreground"}`}>
          {pickProblem ?? `${fmtKg(pickedNet)} kg net → buys ${fmtKg(moqOrderWeight(pickedNet), 1)} kg at the 60 kg MOQ`}
        </span>
        {pickMix ? <span className="mr-2 text-sm text-warning">{pickMix}</span> : null}
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

      {tab === "ungrouped" ? (
        <>
          {canPick && looseKeys.length > 1 ? (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => sel.toggleAll(looseKeys)}>
              {sel.selectedKeys.size === looseKeys.length ? "Clear ticks" : `Tick all ${looseKeys.length}`}
            </button>
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
            pillText={() => "To group"}
            stats={(c) => [
              { label: "Pieces", value: String(c.sample_qty_pcs) },
              { label: "Net kg", value: c.kg == null ? "No weight" : fmtKg(c.kg, 1), lead: true },
              { label: "Fabric", value: c.fabric_structure ?? "—" },
            ]}
            onOpen={(c) => canPick && sel.toggle(c.key)}
            selected={(c) => sel.selectedKeys.has(c.key)}
            empty={
              scopedCandidates.length
                ? query || candFacets.activeCount
                  ? "Nothing matches the search or filters."
                  : "Every costed sample is grouped — see Grouped."
                : "No costed samples for this season yet — a sample appears here once its costing is saved with a fabric and a garment weight."
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
          // Where the Sample Department stands on this SWO, beside who made it.
          footerNote={(g) =>
            [g.pd_status ? `PD: ${PD_STATUS_LABEL[g.pd_status]}` : "PD: not sent", hasCreatedInfo(groupsShown) ? `Created ${createdMeta(g)}` : null]
              .filter(Boolean)
              .join(" · ")
          }
          canDelete={perms.canDelete}
          canDeleteRow={(g) => g.status === "draft"}
          onDelete={del}
          /* THE PD REQUEST IS RAISED HERE, PER SWO (user 2026-10-14; 0723) — the
             send icon opens Sample ▸ PD Request's form on this SWO (remarks,
             then Send). Offered while none is open or the last one came back
             Not Acknowledged / was withdrawn — `canRaisePd`, the form's rule. */
          onSend={(g) => router.push(`/sales/pd-request?new=${g.id}`)}
          canSendRow={(g) => perms.canEdit && canRaisePd(g.pd_status)}
          sendLabel="Send PD Request"
          isPending={isPending}
          empty={scopedGroups.length ? "Nothing matches the search." : "No SWOs yet — tick samples under Ungrouped and create one."}
        />
      )}

      {open ? (
        <GroupSheet
          key={`${open.id}:${open.status}`}
          group={open}
          perms={perms}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
