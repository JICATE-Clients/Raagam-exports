"use client";

import { Check, ExternalLink, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { SelectionBar } from "@/components/ui/selection-bar";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { documentLink, reviewDocuments } from "@/lib/hr/lifecycle-actions";
import { lifecycleLabel, lifecycleTone, type PersonDocument } from "@/lib/hr/lifecycle-types";

/**
 * HR ▸ Team Lifecycle ▸ Document Verification (0766, MyJKKN
 * `/hr/documents/verify`). Three views of the same uploads: waiting to be
 * checked, expiring within 30 days (or already past), and rejected ones still
 * waiting for a new upload. MyJKKN never marked anything expired; here
 * "expired" is worked out from the date, so it cannot be forgotten.
 */

type Props = { docs: PersonDocument[]; canEdit: boolean };
type View = "pending" | "expiring" | "rejected";
type Decision = { docs: PersonDocument[]; action: "verified" | "rejected" };

export function VerifyScreen({ docs, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  useUnsavedGuard(isPending);

  const [view, setView] = useState<View>("pending");
  const lists = useMemo(
    () => ({
      pending: docs.filter((d) => d.status === "pending"),
      expiring: docs
        .filter((d) => (d.status === "verified" || d.status === "expired") && d.expires_in != null && d.expires_in <= 30)
        .sort((a, b) => (a.expires_in ?? 0) - (b.expires_in ?? 0)),
      rejected: docs.filter((d) => d.status === "rejected"),
    }),
    [docs],
  );
  const visible = lists[view];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = view === "pending" ? visible.filter((d) => selected.has(d.id)) : [];

  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState("");

  function run() {
    if (!deciding) return;
    const { docs: list, action } = deciding;
    startTransition(async () => {
      const r = await reviewDocuments(
        list.map((d) => d.id),
        action,
        note,
      );
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(`${r.count ?? list.length} ${action === "verified" ? "verified" : "rejected"}`);
      setDeciding(null);
      setNote("");
      setSelected(new Set());
      router.refresh();
    });
  }

  function openFile(path: string) {
    startTransition(async () => {
      const r = await documentLink(path);
      if (r.ok) window.open(r.url, "_blank", "noopener");
      else toastError(r.error);
    });
  }

  const columns: Column<PersonDocument>[] = [
    {
      header: "Person",
      cell: (d) => (
        <span className="text-sm">
          <span className="font-medium">{d.person_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{d.worker_id ? "Worker" : "Staff"}</span>
        </span>
      ),
    },
    { header: "Document", cell: (d) => <span className="text-sm">{d.doc_name}</span> },
    { header: "Number", cell: (d) => <span className="text-sm">{d.document_no ?? "—"}</span> },
    {
      header: "Expires",
      cell: (d) =>
        d.expires_on ? (
          <span className={d.expires_in != null && d.expires_in < 0 ? "text-sm text-danger tabular-nums" : "text-sm tabular-nums"}>
            {fmtDate(d.expires_on)}
            {d.expires_in != null && d.expires_in >= 0 && d.expires_in <= 30 ? ` (${d.expires_in} d)` : ""}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      header: view === "rejected" ? "Why rejected" : "Uploaded",
      cell: (d) =>
        view === "rejected" ? (
          <span className="text-sm text-muted-foreground">{d.review_note}</span>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(d.created_at)}</span>
        ),
    },
    {
      header: "Status",
      cell: (d) => <StatusPill tone={lifecycleTone(d.status)}>{lifecycleLabel(d.status)}</StatusPill>,
    },
  ];
  const actions = rowActionsColumn<PersonDocument>((d) => (
    <RowActions
      label={d.doc_name}
      view={false}
      isPending={isPending}
      menu={[
        { label: "Open file", icon: ExternalLink, onClick: () => openFile(d.storage_path) },
        ...(canEdit && d.status === "pending"
          ? [
              { label: "Verify", icon: Check, onClick: () => setDeciding({ docs: [d], action: "verified" as const }) },
              {
                label: "Reject…",
                icon: X,
                danger: true,
                onClick: () => setDeciding({ docs: [d], action: "rejected" as const }),
              },
            ]
          : []),
      ]}
    />
  ));

  return (
    <div className="space-y-4">
      <ToggleGroup
        label="Show"
        value={view}
        onChange={(v) => {
          setView(v);
          setSelected(new Set());
        }}
        options={[
          { value: "pending", label: `To verify (${lists.pending.length})` },
          { value: "expiring", label: `Expiring / expired (${lists.expiring.length})` },
          { value: "rejected", label: `Rejected (${lists.rejected.length})` },
        ]}
      />

      <SelectionBar count={chosen.length} onClear={() => setSelected(new Set())}>
        <Button size="sm" disabled={isPending} onClick={() => setDeciding({ docs: chosen, action: "verified" })}>
          Verify {chosen.length}
        </Button>
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => setDeciding({ docs: chosen, action: "rejected" })}>
          Reject {chosen.length}
        </Button>
      </SelectionBar>

      <DataTable
        columns={[...columns, actions]}
        rows={visible}
        getKey={(d) => d.id}
        selectable={canEdit && view === "pending" && visible.length > 0}
        selectedKeys={selected}
        onToggle={(k) =>
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(k)) n.delete(k);
            else n.add(k);
            return n;
          })
        }
        onToggleAll={() => setSelected((s) => (s.size === visible.length ? new Set() : new Set(visible.map((d) => d.id))))}
        empty={
          view === "pending"
            ? "Nothing waiting to be verified."
            : view === "expiring"
              ? "Nothing expires in the next 30 days."
              : "No rejected documents."
        }
      />

      <Sheet
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title={
          deciding
            ? `${deciding.action === "verified" ? "Verify" : "Reject"} ${
                deciding.docs.length === 1 ? `${deciding.docs[0].doc_name} — ${deciding.docs[0].person_name}` : `${deciding.docs.length} documents`
              }`
            : ""
        }
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Back
            </Button>
            <Button
              variant={deciding?.action === "rejected" ? "danger" : "primary"}
              disabled={isPending || (deciding?.action === "rejected" && !note.trim())}
              onClick={run}
            >
              {isPending ? "Saving…" : deciding?.action === "rejected" ? "Reject" : "Verify"}
            </Button>
          </div>
        }
      >
        {deciding && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {deciding.action === "verified"
                ? "Confirm you have opened and checked the file against the original."
                : "The person sees this reason beside the document and uploads a new one."}
            </p>
            <Field label={deciding.action === "rejected" ? "Reason" : "Note (optional)"} required={deciding.action === "rejected"}>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
      </Sheet>
    </div>
  );
}
