"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { Sheet } from "@/components/ui/sheet";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import { useQuickStatus } from "@/components/orders/bom-queue";
import { SampleCards } from "@/components/sales/sample-queue";
import { PdRequestDetails } from "@/components/sales/pd-request-details";
import { PdRequestSheet } from "@/components/sales/pd-request-sheet";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtNumber } from "@/lib/format";
import { loadPdSample, sendPdRequest } from "@/lib/sales/pd-requests/actions";
import { canRaisePd, PD_TO_DEPARTMENT, type PdQueueRow, type PdRequestRow, type PdSample, type PdSmpOption } from "@/lib/sales/pd-requests/types";
import { PD_STATUS_LABEL } from "@/lib/sales/sample-entry/types";
import { queueState, queueWord } from "@/lib/sales/pd-requests/words";

const PATH = "/sales/pd-request";

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
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return queue;
    return queue.filter(({ smp, request: r }) =>
      [smp?.smp_no, smp?.customer, smp?.season, r?.swo_no, r?.note, ...(smp?.style_names ?? r?.style_names ?? []), ...(r?.smp_nos ?? [])].some(
        (v) => (v ?? "").toLowerCase().includes(needle),
      ),
    );
  }, [queue, query]);
  const quick = useQuickStatus(queueWord, { draft: false, countRows: searched });
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
        leading={quick.segment}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search SMP No, customer, season, style or remarks…"
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
        pillText={(q) => (q.request ? PD_STATUS_LABEL[q.request.status] : "Not sent")}
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
        // Acknowledged SMPs read as a table, as every Sample queue's Updated does.
        table={quick.value === "updated" ? { title: "SMP No", subtitle: "Customer · Season" } : undefined}
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
          <FieldRow>
            <Field label="From (Merchandiser)" htmlFor="pd-from" w="name">
              <Input id="pd-from" readOnly value={from ?? ""} />
            </Field>
            <Field label="To Department" htmlFor="pd-to" w="name">
              <Input id="pd-to" readOnly value={PD_TO_DEPARTMENT} />
            </Field>
            <Field
              label="SMP No"
              required
              htmlFor="pd-smp"
              w="name"
              hint={held ? `${held} SMP${held === 1 ? " is" : "s are"} already with or acknowledged by the department.` : undefined}
            >
              <Select id="pd-smp" required value={opp} onChange={(e) => setOpp(e.target.value)}>
                <option value="">{raisable.length ? "" : "No SMP is waiting for a request"}</option>
                {raisable.map((o) => {
                  const last = latestOf(o.id);
                  return (
                    <option key={o.id} value={o.id}>
                      {[o.smp_no, o.customer, last ? `last: ${PD_STATUS_LABEL[last]}` : null].filter(Boolean).join(" · ")}
                    </option>
                  );
                })}
              </Select>
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
