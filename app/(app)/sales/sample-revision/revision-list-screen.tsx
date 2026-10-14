"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { Sheet } from "@/components/ui/sheet";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { SampleCards, type SampleCardState } from "@/components/sales/sample-queue";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate } from "@/lib/format";
import { raiseSampleRevision, submitSampleRevision } from "@/lib/sales/sample-revisions/actions";
import {
  opensCosting,
  RAISABLE_REVISION_KINDS,
  REVISION_KIND_HINT,
  REVISION_KIND_LABEL,
  REVISION_ORIGIN_LABEL,
  REVISION_STATUS_LABEL,
  type RaisableSample,
  type RevisionKind,
  type RevisionOrigin,
  type SampleRevisionRow,
} from "@/lib/sales/sample-revisions/types";

/**
 * Sample ▸ Revision — the register (0716, doc/sample/sample revion.md).
 *
 * Cards, like every Sample queue (`SampleCards`): one per revision, its SMP and
 * customer under the number. Pending is with the MD, Draft is still being
 * worked, Updated is approved; rejected and abandoned show unfiltered.
 *
 * RAISE REVISION offers only LOCKED samples (an approved costing, no open
 * revision). Tick the modules, say who asked and why; the revision's page
 * opens on it.
 */

const wordOf = (r: SampleRevisionRow): QuickWord | null =>
  r.status === "pending" ? "pending" : r.status === "draft" ? "draft" : r.status === "approved" ? "updated" : null;
const stateOf = (r: SampleRevisionRow): SampleCardState =>
  r.status === "pending" ? "pending" : r.status === "approved" ? "updated" : r.status === "draft" ? "draft" : "neutral";

export function RevisionListScreen({
  rows,
  raisable,
  canEdit,
  initialRaise = null,
}: {
  rows: SampleRevisionRow[];
  raisable: RaisableSample[];
  canEdit: boolean;
  /** `?raise=<sample>`: the form opens on it (Costing's "Raise Revision"). */
  initialRaise?: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [raiseOpen, setRaiseOpen] = useState(!!initialRaise);
  const [opp, setOpp] = useState(initialRaise ?? "");
  // ONE MODULE SINCE 0725 (Sample Info & Qty), so it starts ticked — a lone
  // box the operator must tick before the form will raise is a step for nothing.
  const DEFAULT_KINDS: RevisionKind[] = RAISABLE_REVISION_KINDS.length === 1 ? [...RAISABLE_REVISION_KINDS] : [];
  const [kinds, setKinds] = useState<RevisionKind[]>(DEFAULT_KINDS);
  const [origin, setOrigin] = useState<RevisionOrigin>("customer");
  const [remarks, setRemarks] = useState("");
  const dirty = raiseOpen && (kinds.length !== DEFAULT_KINDS.length || !!remarks.trim());
  useUnsavedGuard(dirty || isPending);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.revision_code, r.smp_no, r.customer_name, ...r.style_names].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, query]);
  const quick = useQuickStatus(wordOf, { countRows: searched });
  const shown = searched.filter(quick.matches);

  const openRaise = () => {
    setOpp("");
    setKinds(DEFAULT_KINDS);
    setOrigin("customer");
    setRemarks("");
    setRaiseOpen(true);
  };
  const toggleKind = (k: RevisionKind) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));

  const problem = !opp ? "Pick the sample." : !kinds.length ? "Tick at least one module." : !remarks.trim() ? "Enter the remarks." : null;
  const raise = () =>
    start(async () => {
      if (problem) {
        toastError(problem);
        return;
      }
      const res = await raiseSampleRevision({ opportunity_id: opp, kinds, origin, remarks });
      if (!res.ok) {
        toastError(res.error);
        router.refresh();
        return;
      }
      success(`${res.code} raised — the ticked modules are open.`);
      setRaiseOpen(false);
      router.push(`/sales/sample-revision/${res.id}`);
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Revision"
        description="Change an approved sample: raise a revision, edit only the modules it opens, and send it to the MD."
        actions={
          canEdit ? (
            <Button onClick={openRaise}>
              <Plus className="h-4 w-4" />
              Raise Revision
            </Button>
          ) : undefined
        }
      />
      <FilterBar
        leading={quick.segment}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search revision, SMP No, customer or style…"
        right={`${shown.length} of ${rows.length}`}
      />
      <SampleCards<SampleRevisionRow>
        rows={shown}
        getKey={(r) => r.id}
        title={(r) => <span className="font-mono">{r.revision_code}</span>}
        subtitle={(r) => (
          <>
            <span className="font-mono">{r.smp_no ?? "—"}</span>
            {r.customer_name ? ` · ${r.customer_name}` : ""}
          </>
        )}
        state={stateOf}
        pillText={(r) => REVISION_STATUS_LABEL[r.status]}
        stats={(r) => [
          { label: "Rev", value: `Rev ${r.revision_no}`, lead: true },
          { label: "Modules", value: String(r.kinds.length) },
          { label: r.decided_at ? "Decided" : "Raised", value: fmtDate(r.decided_at ?? r.created_at) },
        ]}
        onOpen={(r) => router.push(`/sales/sample-revision/${r.id}`)}
        // SEND TO MD FROM THE LIST (user 2026-10-14) — a draft revision whose
        // proposed costing exists when its modules open one, as the detail
        // page's own Send to MD requires.
        onSend={(r) =>
          start(async () => {
            const res = await submitSampleRevision(r.id);
            if (!res.ok) {
              toastError(res.error);
              return;
            }
            success(`${r.revision_code} sent to the MD.`);
            router.refresh();
          })
        }
        canSendRow={(r) => canEdit && r.status === "draft" && !(opensCosting(r.kinds) && r.costing_pairs.length === 0)}
        sendLabel="Send to MD"
        isPending={isPending}
        footerNote={hasCreatedInfo(rows) ? (r) => `Created ${createdMeta(r)}` : undefined}
        empty={
          rows.length
            ? "No revisions match the search or the status box."
            : "No sample revisions yet. A sample is locked once its costing is approved — Raise Revision to change one."
        }
      />

      <Sheet
        open={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        size="md"
        title="Raise Sample Revision"
        footer={
          <>
            <Button variant="outline" onClick={() => setRaiseOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !!problem} onClick={raise}>
              {isPending ? "Raising…" : "Raise Revision"}
            </Button>
          </>
        }
      >
        <div className="max-w-[36rem] space-y-4">
          <Field label="Sample (SMP No)" required htmlFor="rev-opp" w="name">
            <Select id="rev-opp" required value={opp} onChange={(e) => setOpp(e.target.value)}>
              <option value="">{raisable.length ? "" : "No approved sample is free to revise"}</option>
              {raisable.map((o) => (
                <option key={o.id} value={o.id}>
                  {[o.smp_no, o.customer_name, o.style_names.join(", ")].filter(Boolean).join(" · ")}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">
              Modules to open <span className="text-danger">*</span>
            </legend>
            {RAISABLE_REVISION_KINDS.map((k) => (
              <label key={k} className="flex cursor-pointer items-start gap-2 rounded-control border border-border px-3 py-2 hover:bg-surface-muted">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={kinds.includes(k)} onChange={() => toggleKind(k)} />
                <span>
                  <span className="block text-sm font-medium">{REVISION_KIND_LABEL[k]}</span>
                  <span className="block text-xs text-muted-foreground">{REVISION_KIND_HINT[k]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-1">
            <span className="text-sm font-medium">Asked by</span>
            <ToggleGroup<RevisionOrigin>
              label="Asked by"
              value={origin}
              onChange={setOrigin}
              options={(["customer", "internal"] as const).map((o) => ({ value: o, label: REVISION_ORIGIN_LABEL[o] }))}
            />
          </div>

          <Field label="Remarks" required htmlFor="rev-remarks">
            <Textarea id="rev-remarks" rows={3} required value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
