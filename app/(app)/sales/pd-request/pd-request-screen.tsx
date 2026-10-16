"use client";

import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Layers, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { Sheet } from "@/components/ui/sheet";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createdMeta, creatorName, hasCreatedInfo } from "@/components/ui/created-columns";
import { useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { Truncated } from "@/components/ui/truncated";
import { RecordPicker } from "@/components/masters/record-picker";
import { useQuickStatus } from "@/components/orders/bom-queue";
import { SampleCards } from "@/components/sales/sample-queue";
import { PdRequestDetails } from "@/components/sales/pd-request-details";
import { PdRequestSheet } from "@/components/sales/pd-request-sheet";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtNumber } from "@/lib/format";
import { loadPdSample, sendPdRequest } from "@/lib/sales/pd-requests/actions";
import { canRaisePd, PD_TO_DEPARTMENT, type PdQueueRow, type PdRequestRow, type PdSample, type PdSmpOption } from "@/lib/sales/pd-requests/types";
import { PD_STATUS_LABEL } from "@/lib/sales/sample-entry/types";
import { PD_STATUS_KEYS, PD_STATUS_KEY_LABEL, PD_WORDS, pdStatusKey, pdStatusLabel, queueState, queueWord } from "@/lib/sales/pd-requests/words";

const PATH = "/sales/pd-request";

/**
 * THE QUEUE'S FILTERS PANEL — Plan Approval's, over an SMP and its latest
 * request. Created is the SMP's own entry (who saved it on Sample Entry);
 * Sent and Answered are the request's.
 */
function pdQueueFacets(options: PdSmpOption[]): FacetGroup<PdQueueRow>[] {
  return [
    {
      title: "Status",
      icon: <Layers />,
      facets: [
        {
          key: "status",
          label: "Status",
          all: "All",
          wide: true,
          counted: true,
          options: [
            { value: "none", label: "Not sent" },
            ...PD_STATUS_KEYS.map((s) => ({ value: s, label: PD_STATUS_KEY_LABEL[s] })),
          ],
          match: (q, v) => (v === "none" ? !q.request : !!q.request && pdStatusKey(q.request) === v),
        },
      ],
    },
    {
      title: "Dates",
      icon: <CalendarRange />,
      facets: [
        { key: "sent", label: "Sent", all: "Any date", date: (q) => q.request?.created_at },
        { key: "answered", label: "Answered", all: "Any date", date: (q) => q.request?.decided_at },
      ],
    },
    ...(hasCreatedInfo(options)
      ? [
          {
            title: "Created",
            icon: <Users />,
            facets: [
              { key: "createdDate", label: "Created Date", all: "Any date", date: (q: PdQueueRow) => (q.smp ?? q.request)?.created_at },
              { key: "createdBy", label: "Created By", all: "Anyone", value: (q: PdQueueRow) => creatorName(q.smp ?? q.request) },
            ],
          },
        ]
      : []),
  ];
}

/**
 * Sample ▸ PD Request — one request per SMP (0724). See page.tsx.
 *
 * PENDING IS THE SMPs, AS CARDS (user 2026-10-14: "in pending state list the
 * smp as card type"): every saved SMP the Sample Department has not yet
 * acknowledged — none sent, with the department, or Not Acknowledged — with
 * the send icon wherever a request may be raised. Updated (acknowledged) is a
 * compact table, as every Sample queue's Updated is.
 */
export function PdRequestScreen({
  rows,
  options,
  canEdit,
  from,
  initialNew,
}: {
  rows: PdRequestRow[];
  options: PdSmpOption[];
  canEdit: boolean;
  /** The signed-in merchandiser — the spec's auto-filled "From". */
  from: string | null;
  initialNew: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  // ---- the queue: one row per SMP, plus the 0723 SWO request -----------------
  const queue = useMemo<PdQueueRow[]>(() => {
    const latest = new Map<string, PdRequestRow>();
    // `rows` arrive oldest-first, so the last one seen per SMP is its latest.
    for (const r of rows) if (r.opportunity_id) latest.set(r.opportunity_id, r);
    return [
      ...options.map((o) => ({ key: o.id, smp: o, request: latest.get(o.id) ?? null })),
      ...rows.filter((r) => !r.opportunity_id).map((r) => ({ key: `req:${r.id}`, smp: null, request: r })),
    ];
  }, [rows, options]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => pdQueueFacets(options), [options]);
  const facets = useFacetFilter(queue, groups);
  const facetMatch = facets.matches;
  const setFacet = facets.set;
  /* THE SET THE BOX COUNTS OVER — search and panel applied, the box's own word
     left off, so a count is exactly what clicking it would show. */
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return queue.filter((q) => {
      if (!facetMatch(q)) return false;
      if (!needle) return true;
      const { smp, request: r } = q;
      return [smp?.smp_no, smp?.customer, smp?.season, r?.swo_no, r?.note, ...(smp?.style_names ?? r?.style_names ?? []), ...(r?.smp_nos ?? [])].some(
        (v) => (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [queue, query, facetMatch]);
  // The box stands down while the panel's Status is set (Plan Approval's rule).
  const quick = useQuickStatus(queueWord, {
    words: PD_WORDS,
    standDown: !!facets.values.status,
    onPick: () => setFacet("status", ""),
    countRows: searched,
  });
  /* CARD VIEW / LIST VIEW (user 2026-10-16) — the TABLE by default on every tab
     (user, same day, screenshot 3578: "default … as table, now it's card"); the
     operator's own pick is kept per screen. Above every early return. */
  const viewMode = useViewMode("pd-request", "list");
  const shown = searched.filter(quick.matches);
  const openRow = openId ? (rows.find((r) => r.id === openId) ?? null) : null;

  // ---- the form --------------------------------------------------------------
  const latestOf = (id: string) => queue.find((q) => q.key === id)?.request?.status ?? null;
  const raisable = options.filter((o) => canRaisePd(latestOf(o.id)));
  const [formOpen, setFormOpen] = useState(!!initialNew);
  /** The picked SMP (`opportunities.id`). */
  const [opp, setOpp] = useState(initialNew ?? "");
  const [remarks, setRemarks] = useState("");
  /** The picked SMP's styles, keyed so a late answer for the previous pick
   *  never paints under this one. */
  const [sample, setSample] = useState<{ forId: string; data: PdSample | null } | null>(null);
  useEffect(() => {
    if (!opp) return;
    void loadPdSample(opp).then((data) => setSample({ forId: opp, data }));
  }, [opp]);
  const picked = sample && sample.forId === opp ? sample.data : null;
  const loadingSample = !!opp && (!sample || sample.forId !== opp);
  useUnsavedGuard((formOpen && (!!opp || !!remarks.trim())) || isPending);

  const openForm = (smpId = "") => {
    setOpp(smpId);
    setRemarks("");
    setFormOpen(true);
  };
  const pickedNo = options.find((o) => o.id === opp)?.smp_no ?? null;
  const problem = !opp
    ? "Pick the SMP No."
    : !picked
      ? null
      : !picked.styles.length
        ? "This SMP has no styles."
        : picked.styles.some((l) => !l.sample_type)
          ? `Set the Sample Type on Sample Entry for ${pickedNo ?? "this SMP"} first — the department needs to know which sample to make.`
          : null;
  const send = () =>
    start(async () => {
      if (problem) {
        toastError(problem);
        return;
      }
      const res = await sendPdRequest(opp, remarks);
      if (!res.ok) {
        toastError(res.error);
        router.refresh();
        return;
      }
      success(`PD Request for ${pickedNo ?? "the SMP"} sent to the ${PD_TO_DEPARTMENT}.`);
      setFormOpen(false);
      router.refresh();
    });

  /** Why an SMP is missing from the picker — said, not left a mystery. */
  const held = options.length - raisable.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="PD Request"
        description="Hand a sample (SMP) to the Sample Department — they acknowledge it, or say why not."
        actions={
          canEdit ? (
            <Button onClick={() => openForm()}>
              <Plus className="h-4 w-4" />
              New PD Request
            </Button>
          ) : undefined
        }
      />
      <FilterBar
        trailing={<ViewToggle value={viewMode.view} onChange={viewMode.setView} />}
        leading={quick.segment}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search SMP No, customer, season, style or remarks…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        right={`${shown.length} of ${queue.length}`}
      />
      <SampleCards<PdQueueRow>
        rows={shown}
        getKey={(q) => q.key}
        title={(q) => <span className="font-mono">{q.smp?.smp_no ?? q.request?.swo_no ?? "—"}</span>}
        subtitle={(q) =>
          q.smp
            ? [q.smp.customer, q.smp.season].filter(Boolean).join(" · ")
            : [q.request?.smp_nos.join(", "), q.request?.customer].filter(Boolean).join(" · ")
        }
        state={queueState}
        pillText={(q) => (q.request ? pdStatusLabel(q.request) : "Not sent")}
        stats={(q) => {
          const src = q.smp ?? q.request;
          return [
            { label: "Qty", value: `${fmtNumber(src?.pieces ?? 0)} pcs`, lead: true },
            { label: "Type", value: src?.sample_types.join(", ") || "—" },
            { label: "Target", value: src?.target_date ? fmtDate(src.target_date) : "—" },
          ];
        }}
        // A sent request opens its sheet (remarks, the department's answer, the
        // trail); an SMP with none opens the form on it.
        onOpen={(q) => {
          if (q.request) setOpenId(q.request.id);
          else if (q.smp && canEdit) openForm(q.smp.id);
        }}
        onSend={(q) => {
          if (q.smp) openForm(q.smp.id);
        }}
        canSendRow={(q) => canEdit && !!q.smp && canRaisePd(q.request?.status ?? null)}
        sendLabel="Send PD Request"
        footerNote={(q) => {
          if (q.request && hasCreatedInfo(rows)) return `Sent ${createdMeta(q.request)}`;
          return q.smp && hasCreatedInfo(options) ? `Entered ${createdMeta(q.smp)}` : null;
        }}
        // Acknowledged SMPs read as a table, as every Sample queue's Updated does
        // — and only ever open read-only, so no pencil; the SMP No opens them.
        rowEdit={false}
        table={{ title: "SMP No", subtitle: "Customer · Season" }}
        view={viewMode.view}
        empty={
          queue.length
            ? "No SMPs match the search or the status box."
            : "No saved sample entry yet. Save one on Sample Entry; it waits here for its PD Request."
        }
      />

      <PdRequestSheet row={openRow} onClose={() => setOpenId(null)} subjectPath={PATH} />

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="New PD Request"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || loadingSample || !!problem} onClick={send}>
              {isPending ? "Sending…" : "Send PD Request"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {/* FROM · TO ARE SAID, NOT BOXED (orders-precedent §2b) — the request
              fills them itself, so a pair of read-only inputs only looked like
              fields the merchandiser could not type in. */}
          <dl className="flex w-full flex-wrap items-baseline gap-x-6 gap-y-1">
            {(
              [
                ["From", from],
                ["To Department", PD_TO_DEPARTMENT],
              ] as [string, string | null][]
            )
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="flex min-w-0 items-baseline gap-2">
                  <dt className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</dt>
                  <dd className="m-0 min-w-0 text-sm font-medium">
                    <Truncated>{value}</Truncated>
                  </dd>
                </div>
              ))}
            <div aria-hidden className="h-px min-w-[2rem] flex-1 self-center bg-border" />
          </dl>
          <FieldRow>
            <Field
              label="SMP No"
              required
              htmlFor="pd-smp"
              w="name"
              hint={held ? `${held} SMP${held === 1 ? " is" : "s are"} already with or acknowledged by the department.` : undefined}
            >
              {/* SEARCHABLE, AS EVERY RECORD PICKER IS — the SMP No leads
                  (`identity="code"`), the customer and the last answer beside it.
                  Only SMPs a request may be raised on (`canRaisePd`). */}
              <RecordPicker
                compact
                id="pd-smp"
                label="SMP No"
                required
                identity="code"
                items={raisable.map((o) => {
                  const last = latestOf(o.id);
                  return {
                    id: o.id,
                    code: o.smp_no,
                    name: [o.customer, last ? `last: ${PD_STATUS_LABEL[last]}` : null].filter(Boolean).join(" · ") || o.smp_no,
                  };
                })}
                emptyHint="No SMP is waiting for a request."
                value={opp || null}
                onChange={(id) => setOpp(id ?? "")}
              />
            </Field>
          </FieldRow>

          {picked ? (
            <>
              <PdRequestDetails sample={picked} from={from} routing={false} />
              {/* Send is greyed while this stands, so say why beside it. */}
              {problem ? <p className="m-0 text-sm text-warning">{problem}</p> : null}
            </>
          ) : opp ? (
            <p className="text-sm text-muted-foreground">{loadingSample ? "Fetching the SMP…" : "This SMP could not be read."}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Pick the SMP No — its styles, quantities, fabric and tech pack fill in from Sample Entry.</p>
          )}

          <Field label="Remarks / Special Instructions" htmlFor="pd-remarks">
            <Textarea id="pd-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
