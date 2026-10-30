"use client";

import { ExternalLink, Upload } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import { documentFolder, documentLink, registerDocument } from "@/lib/hr/lifecycle-actions";
import {
  DOC_ACCEPT,
  DOC_BUCKET,
  DOC_MAX_BYTES,
  appliesToPerson,
  lifecycleLabel,
  lifecycleTone,
  type PersonDocument,
  type RequiredDocument,
} from "@/lib/hr/lifecycle-types";
import { personKey, type PersonOption } from "@/lib/hr/timeoff-types";
import { PersonCombobox } from "./shared";

/**
 * HR ▸ Team Lifecycle ▸ People Documents (0766, MyJKKN §12.3).
 *
 * Pick a person to see their checklist — every required document for staff or
 * workers, what is uploaded, and where it stands — and upload or replace one.
 * Without a person, the list of every current upload in the unit. A staff
 * member signed in for themself sees only their own checklist.
 *
 * The file goes straight from the browser to a private bucket (PDF, JPEG or
 * PNG, at most 5 MB — the bucket refuses anything else), then the database
 * registers it. A replaced upload stays on record as history.
 */

type Props = {
  docs: PersonDocument[];
  required: RequiredDocument[];
  people: PersonOption[];
  selfOnly: boolean;
};

type CheckRow = { key: string; req: RequiredDocument | null; doc: PersonDocument | null };

type Draft = {
  required_doc_id: string; // "" = other
  doc_name: string;
  document_no: string;
  issued_on: string;
  expires_on: string;
  file: File | null;
};

const blankDraft = (reqId = ""): Draft => ({
  required_doc_id: reqId,
  doc_name: "",
  document_no: "",
  issued_on: "",
  expires_on: "",
  file: null,
});

function docStatusText(d: PersonDocument): string {
  if (d.status === "verified" && d.expires_in != null && d.expires_in >= 0 && d.expires_in <= 30) {
    return `Expires in ${d.expires_in} day(s)`;
  }
  return lifecycleLabel(d.status);
}

export function DocumentsScreen({ docs, required, people, selfOnly }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [person, setPerson] = useState(selfOnly ? (people[0]?.key ?? "") : "");
  const chosen = people.find((p) => p.key === person);

  const docsOf = useMemo(() => {
    const m = new Map<string, PersonDocument[]>();
    for (const d of docs) {
      const k = d.staff_id ? personKey("staff", d.staff_id) : personKey("worker", d.worker_id as string);
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return m;
  }, [docs]);

  const checklist: CheckRow[] = useMemo(() => {
    if (!chosen) return [];
    const mine = docsOf.get(chosen.key) ?? [];
    const reqRows = required
      .filter((r) => r.is_active && appliesToPerson(r.applies_to, chosen.kind))
      .map((r) => ({ key: r.id, req: r, doc: mine.find((d) => d.required_doc_id === r.id) ?? null }));
    const others = mine.filter((d) => !d.required_doc_id).map((d) => ({ key: d.id, req: null, doc: d }));
    return [...reqRows, ...others];
  }, [chosen, docsOf, required]);
  const missingMandatory = checklist.filter((c) => c.req?.is_mandatory && (!c.doc || c.doc.status === "rejected")).length;

  // ── upload ──
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [fileKey, setFileKey] = useState(0);
  useUnsavedGuard((open && !!draft.file) || isPending);
  const req = required.find((r) => r.id === draft.required_doc_id);
  const choosable = chosen ? required.filter((r) => r.is_active && appliesToPerson(r.applies_to, chosen.kind)) : [];

  function openUpload(reqId = "") {
    setDraft(blankDraft(reqId));
    setFileKey((k) => k + 1);
    setOpen(true);
  }
  useCreateIntent(() => {
    if (person) openUpload();
  });

  const problem = !person
    ? "Pick the person"
    : !draft.required_doc_id && !draft.doc_name.trim()
      ? "Name the document"
      : req?.has_expiry && !draft.expires_on
        ? "This document needs its expiry date"
        : !draft.file
          ? "Choose the file"
          : null;

  function save() {
    const file = draft.file;
    if (!file) return;
    if (!(DOC_ACCEPT as readonly string[]).includes(file.type)) {
      toastError("Only PDF, JPEG or PNG files");
      return;
    }
    if (file.size > DOC_MAX_BYTES) {
      toastError("The file is over 5 MB");
      return;
    }
    startTransition(async () => {
      const f = await documentFolder(person);
      if (!f.ok) {
        toastError(f.error);
        return;
      }
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
      const path = `${f.folder}/${crypto.randomUUID()}.${ext}`;
      const up = await createClient().storage.from(DOC_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
      if (up.error) {
        toastError(`Upload failed — ${up.error.message}`);
        return;
      }
      const r = await registerDocument({
        person,
        required_doc_id: draft.required_doc_id || null,
        doc_name: draft.doc_name,
        storage_path: path,
        file_name: file.name,
        document_no: draft.document_no,
        issued_on: draft.issued_on,
        expires_on: draft.expires_on,
      });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setOpen(false);
      success("Uploaded — waiting for HR to verify");
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

  // ── tables ──
  const checkColumns: Column<CheckRow>[] = [
    {
      header: "Document",
      cell: (c) => (
        <span className="text-sm">
          <span className="font-medium">{c.req?.name ?? c.doc?.doc_name}</span>
          {c.req?.is_mandatory && <span className="ml-2 text-xs text-muted-foreground">Mandatory</span>}
          {!c.req && <span className="ml-2 text-xs text-muted-foreground">Other</span>}
        </span>
      ),
    },
    { header: "Number", cell: (c) => <span className="text-sm">{c.doc?.document_no ?? "—"}</span> },
    {
      header: "Expires",
      cell: (c) => <span className="text-sm tabular-nums">{c.doc?.expires_on ? fmtDate(c.doc.expires_on) : "—"}</span>,
    },
    {
      header: "File",
      cell: (c) =>
        c.doc ? (
          // button-shape: exempt -- an inline text link to the file, not an action button
          <button
            type="button"
            className="inline-flex max-w-[14rem] items-center gap-1 text-sm text-primary hover:underline"
            onClick={() => openFile(c.doc!.storage_path)}
          >
            <Truncated text={c.doc.file_name} />
            <ExternalLink className="size-3.5 shrink-0" />
          </button>
        ) : (
          <span className="text-sm text-muted-foreground">Not uploaded</span>
        ),
    },
    {
      header: "Note",
      cell: (c) =>
        c.doc?.review_note ? (
          <Truncated className="max-w-[14rem] text-sm text-muted-foreground" text={c.doc.review_note} />
        ) : null,
    },
    {
      header: "Status",
      cell: (c) =>
        c.doc ? (
          <StatusPill tone={lifecycleTone(c.doc.status)}>{docStatusText(c.doc)}</StatusPill>
        ) : (
          <StatusPill tone={c.req?.is_mandatory ? "danger" : "neutral"}>Missing</StatusPill>
        ),
    },
    rowActionsColumn<CheckRow>((c) => (
      <RowActions
        label={c.req?.name ?? c.doc?.doc_name ?? "Document"}
        view={false}
        isPending={isPending}
        menu={
          c.req
            ? [{ label: c.doc ? "Replace file" : "Upload", icon: Upload, onClick: () => openUpload(c.req!.id) }]
            : []
        }
      />
    )),
  ];

  const allColumns: Column<PersonDocument>[] = [
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
    { header: "Expires", cell: (d) => <span className="text-sm tabular-nums">{d.expires_on ? fmtDate(d.expires_on) : "—"}</span> },
  ];
  const allStatus: Column<PersonDocument> = {
    header: "Status",
    cell: (d) => <StatusPill tone={lifecycleTone(d.status)}>{docStatusText(d)}</StatusPill>,
  };
  const allActions = rowActionsColumn<PersonDocument>((d) => (
    <RowActions
      label={d.doc_name}
      view={false}
      isPending={isPending}
      menu={[{ label: "Open file", icon: ExternalLink, onClick: () => openFile(d.storage_path) }]}
    />
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        {!selfOnly ? (
          <FieldRow>
            <Field label="Person" w="name">
              <PersonCombobox people={people} value={person} onChange={setPerson} />
            </Field>
            {person && (
              <div className="flex items-end">
                <Button variant="outline" onClick={() => setPerson("")}>
                  Show everyone
                </Button>
              </div>
            )}
          </FieldRow>
        ) : (
          <span />
        )}
        {person && <Button onClick={() => openUpload()}>+ Upload Document</Button>}
      </div>

      {person ? (
        <>
          {missingMandatory > 0 && (
            <p className="text-sm text-danger">
              {missingMandatory} mandatory document(s) missing or rejected for {chosen?.name}.
            </p>
          )}
          <DataTable columns={checkColumns} rows={checklist} getKey={(c) => c.key} paginate={false} empty="No documents are required." />
        </>
      ) : (
        <DataTable
          columns={[...withCreatedColumns(allColumns, docs), allStatus, allActions]}
          rows={docs}
          getKey={(d) => d.id}
          empty="No documents uploaded yet — pick a person to upload theirs."
        />
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={chosen ? `Upload a document — ${chosen.name}` : "Upload a document"}
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{problem ?? "PDF, JPEG or PNG, up to 5 MB."}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={save}>
                {isPending ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Document" required>
            <Select
              value={draft.required_doc_id}
              onChange={(e) => setDraft((d) => ({ ...d, required_doc_id: e.target.value }))}
            >
              <option value="">Other (name it below)</option>
              {choosable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          {!draft.required_doc_id && (
            <Field label="Document name" required>
              <Input value={draft.doc_name} onChange={(e) => setDraft((d) => ({ ...d, doc_name: e.target.value }))} />
            </Field>
          )}
          <Field label="Document number">
            <Input value={draft.document_no} onChange={(e) => setDraft((d) => ({ ...d, document_no: e.target.value }))} />
          </Field>
          <FieldRow>
            <Field label="Issued on" w="code">
              <Input type="date" value={draft.issued_on} onChange={(e) => setDraft((d) => ({ ...d, issued_on: e.target.value }))} />
            </Field>
            <Field label="Expires on" w="code" required={!!req?.has_expiry}>
              <Input
                type="date"
                min={draft.issued_on || undefined}
                value={draft.expires_on}
                onChange={(e) => setDraft((d) => ({ ...d, expires_on: e.target.value }))}
              />
            </Field>
          </FieldRow>
          <Field label="File" required>
            <input
              key={fileKey}
              type="file"
              accept={DOC_ACCEPT.join(",")}
              className="block w-full text-sm file:mr-3 file:rounded-control file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => setDraft((d) => ({ ...d, file: e.target.files?.[0] ?? null }))}
            />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
