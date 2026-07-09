"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createDocumentNoFormat,
  updateDocumentNoFormat,
  deleteDocumentNoFormat,
} from "@/lib/masters/document-no-format-actions";
import type {
  DocumentNoFormat,
  DocumentNoFormatInput,
} from "@/lib/masters/document-no-format-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

function today() {
  return new Date().toISOString().slice(0, 10);
}

type SegRow = {
  key: string;
  value_type_id: string;
  value: string;
  separator: string;
  no_of_digits: string;
  value_from_id: string;
  ref_only: boolean;
};
const blankSeg = (key: string): SegRow => ({
  key,
  value_type_id: "",
  value: "",
  separator: "",
  no_of_digits: "",
  value_from_id: "",
  ref_only: false,
});

type MenuRow = {
  key: string;
  menu_id: string;
  location_wise: boolean;
  starting_sl_no: string;
  sample_doc_no: string;
  segments: SegRow[];
};
const blankMenu = (key: string, segKey: string): MenuRow => ({
  key,
  menu_id: "",
  location_wise: false,
  starting_sl_no: "0",
  sample_doc_no: "",
  segments: [blankSeg(segKey)],
});

/**
 * Legacy System "Document No format" master — a 3-level nested master-detail.
 * Header (Entry No auto · Date · Track) → many Menu rows → each Menu row has
 * many segment lines that compose its document number. Full-screen editor so
 * the nested grids have room; every list field is a config_lookups picker
 * (Add/Modify). Save / Save-As-Drafts.
 */
export function DocumentNoFormatMasterScreen({
  rows,
  trackOptions,
  menuOptions,
  valueTypeOptions,
  valueFromOptions,
  perms,
}: {
  rows: DocumentNoFormat[];
  trackOptions: ConfigLookup[];
  menuOptions: ConfigLookup[];
  valueTypeOptions: ConfigLookup[];
  valueFromOptions: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNo, setEditNo] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [date, setDate] = useState(today());
  const [trackId, setTrackId] = useState("");
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const trackLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of trackOptions) m.set(t.id, t.name);
    return m;
  }, [trackOptions]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [String(r.entry_no), r.track_id ? trackLabel.get(r.track_id) : ""]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, trackLabel]);

  function openAdd() {
    setEditId(null);
    setEditNo(null);
    setDate(today());
    setTrackId("");
    setMenus([blankMenu(newKey(), newKey())]);
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: DocumentNoFormat) {
    setEditId(r.id);
    setEditNo(r.entry_no);
    setDate(r.date?.slice(0, 10) || today());
    setTrackId(r.track_id ?? "");
    setMenus(
      r.menus.map((m) => ({
        key: newKey(),
        menu_id: m.menu_id ?? "",
        location_wise: m.location_wise,
        starting_sl_no: String(m.starting_sl_no ?? 0),
        sample_doc_no: m.sample_doc_no ?? "",
        segments: m.segments.map((s) => ({
          key: newKey(),
          value_type_id: s.value_type_id ?? "",
          value: s.value ?? "",
          separator: s.separator ?? "",
          no_of_digits: s.no_of_digits != null ? String(s.no_of_digits) : "",
          value_from_id: s.value_from_id ?? "",
          ref_only: s.ref_only,
        })),
      })),
    );
    setDirty(false);
    setOpen(true);
  }

  // ---- menu/segment mutation helpers ----
  function touch() {
    setDirty(true);
  }
  function addMenu() {
    setMenus((ms) => [...ms, blankMenu(newKey(), newKey())]);
    touch();
  }
  function removeMenu(key: string) {
    setMenus((ms) => ms.filter((m) => m.key !== key));
    touch();
  }
  function setMenuAt(key: string, patch: Partial<MenuRow>) {
    setMenus((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    touch();
  }
  function addSegment(menuKey: string) {
    setMenus((ms) =>
      ms.map((m) => (m.key === menuKey ? { ...m, segments: [...m.segments, blankSeg(newKey())] } : m)),
    );
    touch();
  }
  function removeSegment(menuKey: string, segKey: string) {
    setMenus((ms) =>
      ms.map((m) =>
        m.key === menuKey ? { ...m, segments: m.segments.filter((s) => s.key !== segKey) } : m,
      ),
    );
    touch();
  }
  function setSegmentAt(menuKey: string, segKey: string, patch: Partial<SegRow>) {
    setMenus((ms) =>
      ms.map((m) =>
        m.key === menuKey
          ? { ...m, segments: m.segments.map((s) => (s.key === segKey ? { ...s, ...patch } : s)) }
          : m,
      ),
    );
    touch();
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: DocumentNoFormatInput = {
        date,
        track_id: trackId || null,
        is_draft: asDraft,
        menus: menus.map((m, i) => ({
          sno: i + 1,
          menu_id: m.menu_id || null,
          location_wise: m.location_wise,
          starting_sl_no: m.starting_sl_no.trim() === "" ? 0 : Number(m.starting_sl_no),
          sample_doc_no: m.sample_doc_no || null,
          segments: m.segments.map((s, j) => ({
            sno: j + 1,
            value_type_id: s.value_type_id || null,
            value: s.value || null,
            separator: s.separator || null,
            no_of_digits: s.no_of_digits.trim() === "" ? null : Number(s.no_of_digits),
            value_from_id: s.value_from_id || null,
            ref_only: s.ref_only,
          })),
        })),
      };
      const res = editId
        ? await updateDocumentNoFormat(editId, payload)
        : await createDocumentNoFormat(payload);
      if (res.ok) {
        success(editId ? "Document format updated." : asDraft ? "Saved as draft." : "Document format added.");
        setDirty(false);
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: DocumentNoFormat) {
    startTransition(async () => {
      const res = await deleteDocumentNoFormat(r.id);
      if (res.ok) {
        success("Document format deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<DocumentNoFormat>[] = [
    { header: "Entry No", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{r.date?.slice(0, 10)}</span> },
    {
      header: "Track",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.track_id ? (trackLabel.get(r.track_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Menus",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.menus.length || "—"}</span>,
    },
    {
      header: "Status",
      cell: (r) =>
        r.is_draft ? <StatusPill tone="warning">Draft</StatusPill> : <StatusPill tone="success">Active</StatusPill>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by entry no or track…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Document Format
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No document formats yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No document formats yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">#{r.entry_no}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.date?.slice(0, 10)} · {r.menus.length} menu{r.menus.length === 1 ? "" : "s"}
                    {r.track_id ? ` · ${trackLabel.get(r.track_id) ?? ""}` : ""}
                  </div>
                </div>
                {r.is_draft ? (
                  <StatusPill tone="warning">Draft</StatusPill>
                ) : (
                  <StatusPill tone="success">Active</StatusPill>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* ================= full-screen editor ================= */}
      {open && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-background">
          {/* topbar */}
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5">
            <div className="text-sm font-semibold text-foreground">
              {editId ? `Edit Document Format #${editNo}` : "New Document Format"}
              {dirty && <span className="ml-2 text-[11px] font-medium text-warning">● Unsaved</span>}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* body */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-5 md:px-6">
              {/* header */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label>Entry No</Label>
                  <Input value={editNo != null ? `#${editNo}` : "(auto)"} readOnly disabled className="text-base md:text-sm" />
                </div>
                <div>
                  <Label htmlFor="dnf-date">Date</Label>
                  <Input
                    id="dnf-date"
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      touch();
                    }}
                    className="text-base md:text-sm"
                  />
                </div>
                <LookupDialogPicker
                  kind="doc_track"
                  label="Track"
                  options={trackOptions}
                  value={trackId || null}
                  onChange={(id) => {
                    setTrackId(id);
                    touch();
                  }}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </div>

              {/* menu rows */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-bold text-foreground">Menus</h3>
                  <Button type="button" variant="outline" size="sm" onClick={addMenu}>
                    <Plus className="h-3.5 w-3.5" /> Add menu
                  </Button>
                </div>

                {menus.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                    No menus yet. Add one to define a document-number format.
                  </p>
                )}

                {menus.map((m, mi) => (
                  <div key={m.key} className="rounded-lg border border-border bg-surface-muted/30">
                    {/* menu header */}
                    <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Menu #{mi + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMenu(m.key)}
                        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
                        aria-label="Remove menu"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-3 p-3.5">
                      <LookupDialogPicker
                        kind="doc_menu"
                        label="Menu"
                        options={menuOptions}
                        value={m.menu_id || null}
                        onChange={(id) => setMenuAt(m.key, { menu_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                      />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label className="flex h-9 cursor-pointer items-center gap-2 sm:mt-6">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-primary"
                            checked={m.location_wise}
                            onChange={(e) => setMenuAt(m.key, { location_wise: e.target.checked })}
                          />
                          <span className="text-sm text-foreground">Location wise</span>
                        </label>
                        <div>
                          <Label>Starting SlNo</Label>
                          <Input
                            type="number"
                            min={0}
                            value={m.starting_sl_no}
                            onChange={(e) => setMenuAt(m.key, { starting_sl_no: e.target.value })}
                            className="text-base md:text-sm"
                          />
                        </div>
                        <div>
                          <Label>Sample DocNo</Label>
                          <Input
                            value={m.sample_doc_no}
                            onChange={(e) => setMenuAt(m.key, { sample_doc_no: e.target.value })}
                            className="text-base md:text-sm"
                          />
                        </div>
                      </div>

                      {/* segments */}
                      <div className="rounded-md border border-border bg-surface">
                        <div className="flex items-center justify-between border-b border-border px-3 py-2">
                          <span className="text-xs font-semibold text-foreground">
                            Document-number segments
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addSegment(m.key)}
                          >
                            <Plus className="h-3.5 w-3.5" /> Add segment
                          </Button>
                        </div>
                        <div className="space-y-2.5 p-3">
                          {m.segments.length === 0 && (
                            <p className="text-xs text-muted-foreground">No segments yet.</p>
                          )}
                          {m.segments.map((s, si) => (
                            <div key={s.key} className="space-y-2 rounded-md border border-border p-2.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  Segment #{si + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeSegment(m.key, s.key)}
                                  className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-danger"
                                  aria-label="Remove segment"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <LookupDialogPicker
                                kind="doc_value_type"
                                label="Value Type"
                                options={valueTypeOptions}
                                value={s.value_type_id || null}
                                onChange={(id) => setSegmentAt(m.key, s.key, { value_type_id: id })}
                                canCreate={perms.canCreate}
                                canEdit={perms.canEdit}
                                compact
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  placeholder="Value"
                                  value={s.value}
                                  onChange={(e) => setSegmentAt(m.key, s.key, { value: e.target.value })}
                                  className="text-base md:text-sm"
                                />
                                <Input
                                  placeholder="Seperator"
                                  value={s.separator}
                                  onChange={(e) => setSegmentAt(m.key, s.key, { separator: e.target.value })}
                                  className="text-base md:text-sm"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  type="number"
                                  min={0}
                                  placeholder="No Of Digits"
                                  value={s.no_of_digits}
                                  onChange={(e) => setSegmentAt(m.key, s.key, { no_of_digits: e.target.value })}
                                  className="text-base md:text-sm"
                                />
                                <div className="flex items-center pt-1">
                                  <label className="flex cursor-pointer items-center gap-2">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 cursor-pointer accent-primary"
                                      checked={s.ref_only}
                                      onChange={(e) => setSegmentAt(m.key, s.key, { ref_only: e.target.checked })}
                                    />
                                    <span className="text-sm text-foreground">Ref. only</span>
                                  </label>
                                </div>
                              </div>
                              <LookupDialogPicker
                                kind="doc_value_from"
                                label="Value From"
                                options={valueFromOptions}
                                value={s.value_from_id || null}
                                onChange={(id) => setSegmentAt(m.key, s.key, { value_from_id: id })}
                                canCreate={perms.canCreate}
                                canEdit={perms.canEdit}
                                compact
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* footer */}
          <div className="flex items-center gap-2 border-t border-border bg-surface px-4 py-3 md:px-6">
            <span className="text-xs text-muted-foreground">
              {dirty ? "Unsaved changes" : editId ? "All changes saved" : "New document format"}
            </span>
            <div className="flex-1" />
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" size="md" disabled={isPending || !date} onClick={() => submit(true)}>
              Save as Draft
            </Button>
            <Button size="md" disabled={isPending || !date} onClick={() => submit(false)}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
