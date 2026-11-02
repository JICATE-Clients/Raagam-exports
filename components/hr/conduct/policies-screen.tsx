"use client";

import { Archive, ArchiveRestore, FilePlus2, FileText, Paperclip } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { createClient } from "@/lib/supabase/client";
import { today } from "@/lib/calendar";
import { fmtDate, fmtDateTime } from "@/lib/format";
import {
  acknowledgePolicy,
  attachPolicyDoc,
  deletePolicy,
  discardDraft,
  loadPolicyAcks,
  policyDocLink,
  publishPolicy,
  recordAcks,
  removeAck,
  removePolicyDoc,
  savePolicy,
  setPolicyRetired,
  startRevision,
} from "@/lib/hr/conduct-actions";
import {
  APPLIES_TO,
  POLICY_BUCKET,
  POLICY_CATEGORIES,
  POLICY_MAX_BYTES,
  appliesToLabel,
  policyCategoryLabel,
  type AppliesTo,
  type Policy,
  type PolicyAck,
  type PolicyCategory,
  type PolicyDraft,
  type PolicyVersion,
} from "@/lib/hr/conduct-types";
import { Fact } from "@/components/hr/timeoff/shared";
import { Progress } from "@/components/hr/lifecycle/shared";
import { Tick } from "./shared";

/**
 * HR ▸ Conduct & Policies ▸ Policies (0791, MyJKKN §14).
 *
 * One library of written policies — MyJKKN ran two unrelated systems and
 * recorded nobody's reading of either. A policy is written as a DRAFT and
 * PUBLISHED; a change is a new version that supersedes the old one, never an
 * edit of what people already signed. Each published version is acknowledged
 * per person: a staff login confirms it here, HR records the rest from a
 * signed sheet. A policy is for one unit or, ticked, for every unit.
 */

type Props = { rows: Policy[]; myStaffId: string | null; canEdit: boolean; locationId: string | null };
type Scope = "live" | "retired" | "all";

const BLANK = (): PolicyDraft => ({
  title: "",
  category: "conduct",
  applies_to: "all",
  requires_ack: true,
  company_wide: false,
  body: "",
  effective_from: today(),
  change_note: "",
});

function statusWord(p: Policy): string {
  return p.retired ? "Retired" : p.live ? (p.draft ? "In force · draft open" : "In force") : "Draft";
}

/** The text and the document of one version. */
function VersionBody({ v, onOpenDoc }: { v: PolicyVersion; onOpenDoc: (path: string) => void }) {
  return (
    <div className="space-y-2">
      {v.body ? (
        <p className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-control border border-border bg-muted/30 p-3">{v.body}</p>
      ) : (
        !v.file_path && <p className="text-muted-foreground">Nothing written yet.</p>
      )}
      {v.file_path && (
        <Button variant="outline" onClick={() => onOpenDoc(v.file_path as string)}>
          <FileText className="size-4" aria-hidden />
          {v.file_name ?? "Open the document"}
        </Button>
      )}
    </div>
  );
}

export function PoliciesScreen({ rows, myStaffId, canEdit, locationId }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const isSelf = !!myStaffId;

  const [scope, setScope] = useState<Scope>("live");
  const shown = isSelf ? rows.filter((r) => r.live && !r.retired) : rows;
  const visible = isSelf || scope === "all" ? shown : shown.filter((r) => r.retired === (scope === "retired"));

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(done);
      after?.();
      router.refresh();
    });
  }
  function openDoc(path: string) {
    startTransition(async () => {
      const r = await policyDocLink(path);
      if (r.ok) window.open(r.url, "_blank", "noopener");
      else toastError(r.error);
    });
  }

  // ── edit ──
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<PolicyDraft>(BLANK);
  const [dirty, setDirty] = useState(false);
  const put = (patch: Partial<PolicyDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openNew() {
    setEditId(null);
    setD(BLANK());
    setDirty(false);
    setOpen(true);
  }
  function openEdit(p: Policy) {
    const v = p.draft;
    setEditId(p.id);
    setD({
      title: p.title,
      category: p.category,
      applies_to: p.applies_to,
      requires_ack: p.requires_ack,
      company_wide: p.location_id === null,
      body: v?.body ?? p.live?.body ?? "",
      effective_from: v?.effective_from ?? today(),
      change_note: v?.change_note ?? "",
    });
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => {
    if (canEdit) openNew();
  });
  const editing = editId ? (rows.find((r) => r.id === editId) ?? null) : null;
  const isRevision = !!editing?.live;
  const problem = !d.title.trim() ? "Enter the policy's name" : isRevision && !d.change_note.trim() ? "Say what changes in this version" : null;
  function save() {
    run(
      () => savePolicy(editId, d, locationId),
      editId ? "Draft saved" : "Policy created as a draft",
      () => {
        setDirty(false);
        setOpen(false);
      },
    );
  }

  // ── view ──
  const [viewId, setViewId] = useState<string | null>(null);
  const live = viewId ? (rows.find((r) => r.id === viewId) ?? null) : null;
  const [acks, setAcks] = useState<{ id: string; rows: PolicyAck[] } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  function loadAcks(p: Policy) {
    if (isSelf || !p.live) return;
    const v = p.live.id;
    loadPolicyAcks(p.applies_to, v).then((rows) => setAcks({ id: v, rows }));
  }
  function openView(p: Policy) {
    setViewId(p.id);
    setAcks(null);
    setPicked([]);
    loadAcks(p);
  }
  useOpenIntent((id) => {
    const p = rows.find((x) => x.id === id);
    if (p) openView(p);
  });
  useUnsavedGuard((open && dirty) || picked.length > 0 || isPending);

  // ── document ──
  const fileRef = useRef<HTMLInputElement>(null);
  function upload(file: File | undefined) {
    const p = live;
    if (!file || !p?.draft) return;
    if (file.type !== "application/pdf") {
      toastError("The document must be a PDF");
      return;
    }
    if (file.size > POLICY_MAX_BYTES) {
      toastError("The document is over 10 MB");
      return;
    }
    const vId = p.draft.id;
    startTransition(async () => {
      const path = `${p.id}/${crypto.randomUUID()}.pdf`;
      const up = await createClient().storage.from(POLICY_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
      if (up.error) {
        toastError(`Upload failed — ${up.error.message}`);
        return;
      }
      const r = await attachPolicyDoc(vId, path, file.name);
      if (!r.ok) toastError(r.error);
      else success("Document attached");
      router.refresh();
    });
  }

  const columns: Column<Policy>[] = [
    { header: "Policy No", cell: (p) => <span className="font-mono text-xs font-medium">{p.code ?? "—"}</span> },
    {
      header: "Policy",
      cell: (p) => (
        <span className="text-sm">
          <span className="font-medium">{p.title}</span>
          <span className="ml-2 text-xs text-muted-foreground">{policyCategoryLabel(p.category)}</span>
        </span>
      ),
    },
    { header: "For", cell: (p) => <span className="text-sm">{appliesToLabel(p.applies_to)}</span> },
    ...(isSelf ? [] : [{ header: "Unit", cell: (p: Policy) => <span className="text-sm">{p.location_id ? (p.unit_name ?? "—") : "Every unit"}</span> }]),
    {
      header: "Version",
      cell: (p) =>
        p.live ? (
          <span className="text-sm tabular-nums">
            v{p.live.version_no} · from {fmtDate(p.live.effective_from)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    isSelf
      ? {
          header: "You",
          cell: (p: Policy) =>
            !p.requires_ack ? (
              <span className="text-sm text-muted-foreground">To read</span>
            ) : p.mine_acked ? (
              <StatusPill tone="success">Read</StatusPill>
            ) : (
              <StatusPill tone="warning">Please confirm</StatusPill>
            ),
        }
      : {
          header: "Acknowledged",
          cell: (p: Policy) =>
            p.live && p.requires_ack && !p.retired ? <Progress done={p.acked} total={p.reach} /> : <span className="text-muted-foreground">—</span>,
        },
  ];
  const statusColumn: Column<Policy> = {
    header: "Status",
    cell: (p) => <StatusPill tone={p.retired ? "neutral" : p.live ? "success" : "neutral"}>{statusWord(p)}</StatusPill>,
  };
  const actions = rowActionsColumn<Policy>((p) => (
    <RowActions
      label={p.title}
      onView={() => openView(p)}
      onEdit={() => openEdit(p)}
      canEdit={canEdit}
      editDisabledReason={p.retired ? "The policy is retired" : null}
      onDelete={() => run(() => deletePolicy(p.id), "Deleted")}
      canDelete={canEdit}
      deleteDisabledReason={p.live || p.versions.some((v) => v.status !== "draft") ? "It has been published — retire it instead" : null}
      isPending={isPending}
      menu={
        canEdit
          ? p.retired
            ? [{ label: "Bring back into use", icon: ArchiveRestore, onClick: () => run(() => setPolicyRetired(p.id, false), "Back in use") }]
            : p.live
              ? [{ label: "Retire", icon: Archive, onClick: () => run(() => setPolicyRetired(p.id, true), "Retired") }]
              : []
          : []
      }
    />
  ));

  const unacked = acks && live?.live && acks.id === live.live.id ? acks.rows.filter((a) => !a.acked_at) : [];
  const done = acks && live?.live && acks.id === live.live.id ? acks.rows.filter((a) => a.acked_at) : [];

  return (
    <div className="space-y-4">
      {!isSelf && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            label="Show"
            value={scope}
            onChange={setScope}
            options={[
              { value: "live", label: `In use (${rows.filter((r) => !r.retired).length})` },
              { value: "retired", label: "Retired" },
              { value: "all", label: "All" },
            ]}
          />
          {canEdit && <Button onClick={openNew}>+ New Policy</Button>}
        </div>
      )}

      <DataTable
        columns={[...withCreatedColumns(columns, visible), ...(isSelf ? [] : [statusColumn]), actions]}
        rows={visible}
        getKey={(p) => p.id}
        empty={isSelf ? "No policies have been published for you yet." : scope === "retired" ? "No retired policies." : "No policies yet."}
      />

      {/* ── write ── */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? (isRevision ? `New version — ${editing?.title ?? ""}` : "Edit the draft") : "New policy"}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{problem ?? "Saved as a draft — publish it from the policy when ready."}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={save}>
                {isPending ? "Saving…" : "Save draft"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <FieldRow>
            <Field label="Policy" w="name" required>
              <Input value={d.title} onChange={(e) => put({ title: e.target.value })} />
            </Field>
            <Field label="Category" w="code" required>
              <Select value={d.category} onChange={(e) => put({ category: e.target.value as PolicyCategory })}>
                {POLICY_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="For" w="code" required>
              <Select value={d.applies_to} onChange={(e) => put({ applies_to: e.target.value as AppliesTo })}>
                {APPLIES_TO.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Takes effect" w="code" required>
              <Input type="date" value={d.effective_from} onChange={(e) => put({ effective_from: e.target.value })} />
            </Field>
          </FieldRow>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Tick checked={d.requires_ack} onChange={(v) => put({ requires_ack: v })}>
              Everyone it applies to must acknowledge it
            </Tick>
            {!editId && (
              <Tick checked={d.company_wide} onChange={(v) => put({ company_wide: v })}>
                For every unit (otherwise this unit only)
              </Tick>
            )}
          </div>
          {isRevision && (
            <Field label="What changes in this version" required>
              <Input value={d.change_note} onChange={(e) => put({ change_note: e.target.value })} />
            </Field>
          )}
          <Field label="The policy">
            <Textarea rows={14} value={d.body} onChange={(e) => put({ body: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">Write it here, or attach the signed PDF from the policy once the draft is saved — either is enough to publish.</p>
        </div>
      </Sheet>

      {/* ── view ── */}
      <Sheet
        open={!!live}
        onClose={() => setViewId(null)}
        title={live ? `${live.code ?? "Policy"} — ${live.title}` : "Policy"}
        size="md"
        footer={
          live && isSelf && live.live && live.requires_ack && !live.mine_acked ? (
            <div className="flex justify-end">
              <Button disabled={isPending} onClick={() => run(() => acknowledgePolicy(live.live!.id), "Thank you — recorded")}>
                I have read and understood this policy
              </Button>
            </div>
          ) : undefined
        }
      >
        {live && (
          <div className="space-y-6 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={live.retired ? "neutral" : live.live ? "success" : "neutral"}>{statusWord(live)}</StatusPill>
              {isSelf && live.mine_acked && <StatusPill tone="success">You have read it</StatusPill>}
            </div>
            <dl className="space-y-1">
              <Fact label="Category">{policyCategoryLabel(live.category)}</Fact>
              <Fact label="For">{appliesToLabel(live.applies_to)}</Fact>
              {!isSelf && <Fact label="Unit">{live.location_id ? (live.unit_name ?? "—") : "Every unit"}</Fact>}
              {live.live && (
                <Fact label="In force">
                  Version {live.live.version_no} · from {fmtDate(live.live.effective_from)}
                  {live.live.published_at ? ` · published ${fmtDateTime(live.live.published_at)}` : ""}
                </Fact>
              )}
              {live.live?.change_note && <Fact label="What changed">{live.live.change_note}</Fact>}
            </dl>

            {live.live && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The policy</h3>
                <VersionBody v={live.live} onOpenDoc={openDoc} />
              </section>
            )}

            {!isSelf && canEdit && !live.retired && (
              <section className="space-y-2 rounded-control border border-dashed border-border p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {live.draft ? `Draft — version ${live.draft.version_no}` : "Next version"}
                </h3>
                {live.draft ? (
                  <>
                    {live.draft.change_note && <p>Changes: {live.draft.change_note}</p>}
                    <VersionBody v={live.draft} onOpenDoc={openDoc} />
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        upload(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button variant="outline" disabled={isPending} onClick={() => openEdit(live)}>
                        Edit
                      </Button>
                      <Button variant="outline" disabled={isPending} onClick={() => fileRef.current?.click()}>
                        <Paperclip className="size-4" aria-hidden />
                        {live.draft.file_path ? "Replace PDF" : "Attach PDF"}
                      </Button>
                      {live.draft.file_path && (
                        <Button variant="outline" disabled={isPending} onClick={() => run(() => removePolicyDoc(live.draft!.id), "Document removed")}>
                          Remove PDF
                        </Button>
                      )}
                      {live.live && (
                        <Button variant="outline" disabled={isPending} onClick={() => run(() => discardDraft(live.draft!.id), "Draft discarded")}>
                          Discard draft
                        </Button>
                      )}
                      <Button disabled={isPending} onClick={() => run(() => publishPolicy(live.draft!.id), "Published", () => setViewId(null))}>
                        Publish version {live.draft.version_no}
                      </Button>
                    </div>
                    {live.live && live.requires_ack && (
                      <p className="text-xs text-muted-foreground">Publishing replaces version {live.live.version_no}; everyone acknowledges the new one again.</p>
                    )}
                  </>
                ) : (
                  <Button variant="outline" disabled={isPending} onClick={() => run(() => startRevision(live.id), "New draft started")}>
                    <FilePlus2 className="size-4" aria-hidden />
                    Start a new version
                  </Button>
                )}
              </section>
            )}

            {!isSelf && live.live && live.requires_ack && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Acknowledged in this unit {acks?.id === live.live.id ? `(${done.length} of ${acks.rows.length})` : ""}
                  </h3>
                  {canEdit && picked.length > 0 && (
                    <Button
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () => recordAcks(live.live!.id, picked),
                          `${picked.length} recorded`,
                          () => {
                            setPicked([]);
                            loadAcks(live);
                          },
                        )
                      }
                    >
                      Record {picked.length} signed
                    </Button>
                  )}
                </div>
                {acks?.id !== live.live.id ? (
                  <p className="text-muted-foreground">Loading…</p>
                ) : acks.rows.length === 0 ? (
                  <p className="text-muted-foreground">Nobody in this unit is reached by it.</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-warning">Not yet ({unacked.length})</p>
                      {canEdit && unacked.length > 0 && (
                        <Tick
                          checked={picked.length === unacked.length}
                          onChange={(v) => setPicked(v ? unacked.map((a) => a.person_key) : [])}
                        >
                          <span className="text-xs text-muted-foreground">Tick all — they signed the paper copy</span>
                        </Tick>
                      )}
                      <ul className="max-h-72 space-y-1 overflow-y-auto">
                        {unacked.map((a) =>
                          canEdit ? (
                            <li key={a.person_key}>
                              <Tick
                                checked={picked.includes(a.person_key)}
                                onChange={(v) => setPicked((x) => (v ? [...x, a.person_key] : x.filter((k) => k !== a.person_key)))}
                              >
                                {a.name} <span className="text-xs text-muted-foreground">{a.code ?? ""}{a.kind === "worker" ? " · Worker" : ""}</span>
                              </Tick>
                            </li>
                          ) : (
                            <li key={a.person_key}>
                              {a.name} <span className="text-xs text-muted-foreground">{a.code ?? ""}</span>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-success">Acknowledged ({done.length})</p>
                      <ul className="max-h-72 space-y-1 overflow-y-auto">
                        {done.map((a) => (
                          <li key={a.person_key} className="flex items-center justify-between gap-2">
                            <span>
                              {a.name}
                              <span className="ml-1 text-xs text-muted-foreground">
                                {fmtDate(a.acked_at)} · {a.mode === "self" ? "themself" : "by HR"}
                              </span>
                            </span>
                            {canEdit && a.mode === "hr" && (
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-danger hover:underline"
                                onClick={() => run(() => removeAck(a.id), "Removed", () => loadAcks(live))}
                              >
                                Undo
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </section>
            )}

            {!isSelf && live.versions.filter((v) => v.status === "superseded").length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earlier versions</h3>
                <ul className="space-y-1">
                  {live.versions
                    .filter((v) => v.status === "superseded")
                    .map((v) => (
                      <li key={v.id}>
                        Version {v.version_no} · from {fmtDate(v.effective_from)}
                        {v.change_note ? ` · ${v.change_note}` : ""}
                        {v.file_path && (
                          <button type="button" className="ml-2 text-xs text-primary hover:underline" onClick={() => openDoc(v.file_path as string)}>
                            PDF
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

