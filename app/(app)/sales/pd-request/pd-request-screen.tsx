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
import { canRaisePd, PD_TO_DEPARTMENT, type PdRequestRow, type PdSample, type PdSwoOption } from "@/lib/sales/pd-requests/types";
import { PD_STATUS_LABEL } from "@/lib/sales/sample-entry/types";
import { pdState, pdWord } from "@/lib/sales/pd-requests/words";

const PATH = "/sales/pd-request";

/**
 * Sample ▸ PD Request — the register and the request form, one request per
 * SWO (0723). See page.tsx.
 *
 * Every Sample queue's shape (`SampleCards`): Pending (with the Sample
 * Department) as cards, Updated (answered) as a compact table.
 */
export function PdRequestScreen({
  rows,
  options,
  canEdit,
  from,
  initialNew,
}: {
  rows: PdRequestRow[];
  options: PdSwoOption[];
  canEdit: boolean;
  /** The signed-in merchandiser — the spec's auto-filled "From". */
  from: string | null;
  initialNew: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  // ---- the register ----------------------------------------------------------
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.swo_no, r.customer, r.season, r.note, ...r.smp_nos, ...r.style_names].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, query]);
  const quick = useQuickStatus(pdWord, { draft: false, countRows: searched });
  const shown = searched.filter(quick.matches);
  const openRow = openId ? (rows.find((r) => r.id === openId) ?? null) : null;

  // ---- the form --------------------------------------------------------------
  const raisable = useMemo(() => options.filter((o) => canRaisePd(o.latest)), [options]);
  const [formOpen, setFormOpen] = useState(!!initialNew);
  /** The picked SWO (`sample_product_groups.id`). */
  const [opp, setOpp] = useState(initialNew ?? "");
  const [remarks, setRemarks] = useState("");
  /** The picked SWO's samples, keyed so a late answer for the previous pick
   *  never paints under this one. */
  const [sample, setSample] = useState<{ forId: string; data: PdSample | null } | null>(null);
  useEffect(() => {
    if (!opp) return;
    void loadPdSample(opp).then((data) => setSample({ forId: opp, data }));
  }, [opp]);
  const picked = sample && sample.forId === opp ? sample.data : null;
  const loadingSample = !!opp && (!sample || sample.forId !== opp);
  useUnsavedGuard((formOpen && (!!opp || !!remarks.trim())) || isPending);

  const openForm = () => {
    setOpp("");
    setRemarks("");
    setFormOpen(true);
  };
  const problem = !opp ? "Pick the SWO No." : !picked ? null : !picked.styles.length ? "This SWO has no samples in it." : null;
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
      success(`PD Request for ${picked?.swo_no ?? "the SWO"} sent to the ${PD_TO_DEPARTMENT}.`);
      setFormOpen(false);
      router.refresh();
    });

  /** Why an SWO is missing from the picker — said, not left a mystery. */
  const held = options.length - raisable.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="PD Request"
        description="Hand a grouped SWO to the Sample Department — they acknowledge the whole batch of samples in it."
        actions={
          canEdit ? (
            <Button onClick={openForm}>
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
        searchPlaceholder="Search SWO No, SMP No, customer, style or remarks…"
        right={`${shown.length} of ${rows.length}`}
      />
      <SampleCards<PdRequestRow>
        rows={shown}
        getKey={(r) => r.id}
        title={(r) => <span className="font-mono">{r.swo_no ?? r.smp_nos[0] ?? "—"}</span>}
        subtitle={(r) => [r.smp_nos.join(", "), r.customer].filter(Boolean).join(" · ")}
        state={pdState}
        pillText={(r) => PD_STATUS_LABEL[r.status]}
        stats={(r) => [
          { label: "Qty", value: `${fmtNumber(r.pieces)} pcs`, lead: true },
          { label: "Type", value: r.sample_types.join(", ") || "—" },
          { label: "Target", value: r.target_date ? fmtDate(r.target_date) : "—" },
        ]}
        onOpen={(r) => setOpenId(r.id)}
        footerNote={hasCreatedInfo(rows) ? (r) => `Sent ${createdMeta(r)}` : undefined}
        // Answered requests read as a table, as every Sample queue's Updated does.
        table={quick.value === "updated" ? { title: "SWO No", subtitle: "SMP Nos · Customer" } : undefined}
        empty={
          rows.length
            ? "No PD Requests match the search or the status box."
            : "No PD Request sent yet. Group the samples into an SWO on Sample ▸ Grouping, then New PD Request hands that SWO to the Sample Department."
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
              label="SWO Number"
              required
              htmlFor="pd-swo"
              w="name"
              hint={held ? `${held} SWO${held === 1 ? " is" : "s are"} already with or acknowledged by the department.` : undefined}
            >
              <Select id="pd-swo" required value={opp} onChange={(e) => setOpp(e.target.value)}>
                <option value="">{raisable.length ? "" : "No SWO is waiting for a request"}</option>
                {raisable.map((o) => (
                  <option key={o.id} value={o.id}>
                    {[o.swo_no, o.smp_nos.join(", "), o.latest ? `last: ${PD_STATUS_LABEL[o.latest]}` : null].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          {picked ? (
            <PdRequestDetails sample={picked} from={from} routing={false} />
          ) : opp ? (
            <p className="text-sm text-muted-foreground">{loadingSample ? "Fetching the SWO…" : "This SWO could not be read."}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Pick the SWO Number — every SMP in it, with styles, quantities, fabric and tech pack, fills in from Sample Entry.</p>
          )}

          <Field label="Remarks / Special Instructions" htmlFor="pd-remarks">
            <Textarea
              id="pd-remarks"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
