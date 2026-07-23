"use client";
import { deletedToast } from "@/lib/masters/delete-message";

import { useMemo, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { ValidatedInput } from "@/components/ui/validated-input";
import { PaginationBar } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { useCreateIntent } from "@/lib/use-create-intent";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import type { FormatKind } from "@/lib/validation/formats";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ types */

export type SimpleFieldKind = "text" | "select" | "checkbox";

export type SimpleField = {
  /** Key into the form-values record. */
  key: string;
  /** Column header + mobile input label. */
  label: string;
  kind?: SimpleFieldKind; // default "text"
  required?: boolean;
  /** ValidatedInput format for text fields. */
  format?: FormatKind;
  /** Options for kind:"select". */
  options?: { value: string; label: string }[];
  /** Read-cell label for a select value (defaults to matching option label). */
  optionLabel?: (value: string) => ReactNode;
  placeholder?: string;
  /** Render the read cell in mono (codes). */
  mono?: boolean;
  /** Extra width class on the edit input, e.g. "w-32". */
  widthClass?: string;
  /** Key of another field whose value fills this one when left blank (shown as hint). */
  defaultsTo?: string;
  /** Render read-only while editing an EXISTING row (e.g. immutable codes). */
  lockedOnEdit?: boolean;
};

export type SimpleValues = Record<string, string | boolean>;
export type SimpleStatus = { active: boolean; draft: boolean };
export type ActionResult = { ok: true } | { ok: false; error: string };

export type SimpleMasterDescriptor<Row> = {
  /** "Beam Type" — drives buttons, toasts, empty text. */
  entityLabel: string;
  /** DataIoToolbar entity key; omit to hide import/export. */
  ioEntityKey?: string;
  /** Fields WITHOUT status — status is handled by `status` below. */
  fields: SimpleField[];
  /** "active" = Active/Inactive select; "activeDraft" adds Draft; "none" = no status column. */
  status: "active" | "activeDraft" | "none";
  /** Read-only computed columns (e.g. Created Date/User), rendered after the fields. */
  extraColumns?: { header: string; cell: (r: Row) => ReactNode }[];
  /** Optional extra muted line on the mobile read card. */
  mobileMeta?: (r: Row) => ReactNode;
  /** Field key used as the mobile card title. Defaults to the second field
   *  (historically Name, after a leading Code column), then the first — set
   *  this when the code field is gone and fields[1] isn't the natural label. */
  mobileTitleKey?: string;
  /** Row → form values for editing. */
  fromRow: (r: Row) => SimpleValues;
  /** Free-text search haystack. */
  searchText: (r: Row) => string;
  /** Row → status; required unless status is "none". */
  statusOf?: (r: Row) => "active" | "inactive" | "draft";
  /** Row primary key; defaults to `r.id`. Override for masters keyed on code. */
  getId?: (r: Row) => string;
  /** Extra facet filters beyond Status (rendered in the FilterBar). */
  extraFilters?: {
    key: string;
    label: string;
    options: { value: string; label: string }[];
    predicate: (r: Row, v: string) => boolean;
  }[];
  /** Cross-field validation before save; return an error message to block. */
  validate?: (values: SimpleValues) => string | null;
  /** Live duplicate check while typing — mirror the on-save guard in the
   *  entity's create/update actions (same table + nameColumn + scope). The
   *  error renders under `fieldKey`'s input and blocks Save. */
  dupCheck?: {
    table: string;
    /** Form-value key the check watches (and whose input shows the error). */
    fieldKey: string;
    nameColumn?: string;
    scope?: Record<string, string | null>;
    /** Derive the checked value from all form values (defaults to values[fieldKey]). */
    value?: (values: SimpleValues) => string;
  };
  /** Build the exact server-action payload (trimming already applied to text values). */
  toPayload: (values: SimpleValues, status: SimpleStatus) => unknown;
  actions: {
    create: (payload: never) => Promise<ActionResult & { id?: string }>;
    update: (id: string, payload: never) => Promise<ActionResult>;
    remove: (id: string) => Promise<ActionResult & { inactive?: boolean; usedBy?: string }>;
  };
};

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; canImport?: boolean };

type Editing = {
  /** null = the "+ Add" row. */
  id: string | null;
  values: SimpleValues;
  status: "active" | "inactive" | "draft";
};

/* ------------------------------------------------------------- component */

/**
 * Config-driven master screen for the TRIVIAL tier (code + name + a couple of
 * flat fields): no dialog at all — the row itself becomes editable ("inline
 * edit"), and "+ Add" prepends an editable row above the table. Each entity
 * screen collapses to a small descriptor + its imported server actions.
 *
 * Owns its own <table> markup (mirroring DataTable's classes) because the
 * presentational DataTable can't host per-row edit state or the add row; the
 * add row also deliberately lives OUTSIDE pagination slicing so it never
 * disappears onto another page.
 */
export function SimpleMasterScreen<Row>({
  rows,
  perms,
  descriptor,
}: {
  rows: Row[];
  perms: Perms;
  descriptor: SimpleMasterDescriptor<Row>;
}) {
  const d = descriptor;
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing | null>(null);

  const getId = d.getId ?? ((r: Row) => (r as { id: string }).id);
  const hasStatus = d.status !== "none";
  const statusOf = useMemo(
    () =>
      d.statusOf ??
      ((r: Row) =>
        (r as Record<string, unknown>).is_active === false ? ("inactive" as const) : ("active" as const)),
    [d.statusOf],
  );

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter<
    Row,
    Record<string, string>
  >(rows, {
    search: (r, q) => d.searchText(r).toLowerCase().includes(q),
    filters: {
      ...(hasStatus ? { status: (r: Row, v: string) => statusOf(r) === v } : {}),
      ...Object.fromEntries((d.extraFilters ?? []).map((f) => [f.key, f.predicate])),
    },
    initialFilters: {
      ...(hasStatus ? { status: "" } : {}),
      ...Object.fromEntries((d.extraFilters ?? []).map((f) => [f.key, ""])),
    },
  });

  const pg = usePagination(filtered, 10);

  const blankValues = useMemo(() => {
    const v: SimpleValues = {};
    for (const f of d.fields) v[f.key] = f.kind === "checkbox" ? false : "";
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startAdd() {
    if (!perms.canCreate) return;
    setEditing({ id: null, values: { ...blankValues }, status: "active" });
  }
  function startEdit(r: Row) {
    if (!perms.canEdit) return;
    setEditing({ id: getId(r), values: d.fromRow(r), status: hasStatus ? statusOf(r) : "active" });
  }
  function cancelEdit() {
    setEditing(null);
  }

  useCreateIntent(startAdd);

  // Real-time duplicate check on the descriptor's unique field (mirrors the
  // on-save guard in the entity's actions; no-op when dupCheck is undeclared).
  const dupValue =
    editing && d.dupCheck
      ? d.dupCheck.value?.(editing.values) ?? String(editing.values[d.dupCheck.fieldKey] ?? "")
      : "";
  const dupError = useDuplicateCheck({
    table: d.dupCheck?.table ?? "",
    name: dupValue,
    nameColumn: d.dupCheck?.nameColumn,
    scope: d.dupCheck?.scope,
    excludeId: editing?.id ?? undefined,
    enabled: !!d.dupCheck && !!dupValue.trim(),
  });

  const canSave =
    !!editing &&
    !dupError &&
    d.fields.every(
      (f) => !f.required || String(editing.values[f.key] ?? "").trim().length > 0,
    );

  function save() {
    if (!editing || !canSave || isPending) return;
    const trimmed: SimpleValues = {};
    for (const f of d.fields) {
      const v = editing.values[f.key];
      trimmed[f.key] = typeof v === "string" ? v.trim() : (v ?? false);
    }
    const invalid = d.validate?.(trimmed);
    if (invalid) {
      error(invalid); // row stays editable
      return;
    }
    const payload = d.toPayload(trimmed, {
      active: editing.status === "active",
      draft: editing.status === "draft",
    }) as never;
    const isNew = editing.id === null;
    startTransition(async () => {
      const res = isNew ? await d.actions.create(payload) : await d.actions.update(editing.id!, payload);
      if (res.ok) {
        success(isNew ? `${d.entityLabel} added.` : `${d.entityLabel} updated.`);
        setEditing(null);
        router.refresh();
      } else {
        error(res.error); // row stays editable with values intact
      }
    });
  }

  function remove(r: Row) {
    startTransition(async () => {
      const res = await d.actions.remove(getId(r));
      if (res.ok) {
        success(deletedToast(d.entityLabel, { inactive: res.inactive ?? false, usedBy: res.usedBy }));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function onRowKeyDown(e: KeyboardEvent<HTMLElement>) {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === "Enter" && tag !== "SELECT" && tag !== "TEXTAREA") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  /* ------------------------------------------------------------ cells */

  function readCell(f: SimpleField, r: Row) {
    const raw = d.fromRow(r)[f.key];
    if (f.kind === "checkbox") {
      return <span className="text-sm">{raw ? "Yes" : "—"}</span>;
    }
    const v = String(raw ?? "");
    if (!v) return <span className="text-sm text-muted-foreground">—</span>;
    if (f.kind === "select") {
      const label = f.optionLabel?.(v) ?? f.options?.find((o) => o.value === v)?.label ?? v;
      return <span className="text-sm">{label}</span>;
    }
    return <span className={cn(f.mono ? "font-mono text-xs" : "text-sm")}>{v}</span>;
  }

  function editCell(f: SimpleField, autoFocus = false) {
    if (!editing) return null;
    const v = editing.values[f.key];
    if (f.lockedOnEdit && editing.id !== null) {
      // Immutable on existing rows (e.g. a code that is the PK).
      return <span className={cn(f.mono ? "font-mono text-xs" : "text-sm")}>{String(v ?? "")}</span>;
    }
    const setV = (nv: string | boolean) =>
      setEditing((e) => (e ? { ...e, values: { ...e.values, [f.key]: nv } } : e));

    if (f.kind === "checkbox") {
      return (
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-primary"
          checked={!!v}
          onChange={(e) => setV(e.target.checked)}
          aria-label={f.label}
        />
      );
    }
    if (f.kind === "select") {
      return (
        <Select
          value={String(v ?? "")}
          onChange={(e) => setV(e.target.value)}
          className={cn("h-8 text-sm", f.widthClass)}
          aria-label={f.label}
        >
          <option value="">—</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    const placeholder =
      f.placeholder ??
      (f.defaultsTo ? String(editing.values[f.defaultsTo] ?? "") || undefined : undefined);
    const common = {
      value: String(v ?? ""),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value),
      className: cn("h-8 text-sm", f.widthClass),
      placeholder,
      autoFocus,
      "aria-label": f.label,
    };
    // Plain text fields type in CAPS (client 2026-07-23) — no-op for digits;
    // format-driven fields keep their own ValidatedInput transforms.
    const input = f.format ? <ValidatedInput format={f.format} {...common} /> : <Input uppercase {...common} />;
    if (d.dupCheck?.fieldKey === f.key) {
      return (
        <div>
          {input}
          {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
        </div>
      );
    }
    return input;
  }

  function statusEditCell() {
    if (!editing) return null;
    // Inactive is an edit-time state — new records are always created Active.
    // Draft-capable masters keep the full select on add (Draft is a valid start).
    if (editing.id === null && d.status === "active") {
      return <StatusPill tone="success">Active</StatusPill>;
    }
    return (
      <Select
        value={editing.status}
        onChange={(e) =>
          setEditing((ed) => (ed ? { ...ed, status: e.target.value as Editing["status"] } : ed))
        }
        className="h-8 w-28 text-sm"
        aria-label="Status"
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        {d.status === "activeDraft" && <option value="draft">Draft</option>}
      </Select>
    );
  }

  function statusPill(r: Row) {
    const s = statusOf(r);
    return (
      <StatusPill tone={s === "active" ? "success" : s === "draft" ? "warning" : "danger"}>
        {s === "active" ? "Active" : s === "draft" ? "Draft" : "Inactive"}
      </StatusPill>
    );
  }

  function saveCancelButtons(compact = true) {
    return (
      <div className={cn("flex items-center gap-1", compact && "justify-end")}>
        <Button size="sm" disabled={isPending || !canSave} onClick={save} aria-label="Save">
          <Check className="h-4 w-4" />
          {isPending ? "…" : "Save"}
        </Button>
        <Button variant="ghost" size="sm" onClick={cancelEdit} aria-label="Cancel">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const empty = `No ${d.entityLabel.toLowerCase()} records yet.`;

  /* ------------------------------------------------------------ render */

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder={`Search ${d.entityLabel.toLowerCase()}...`}
          activeCount={activeCount}
          onReset={
            hasStatus || (d.extraFilters?.length ?? 0) > 0
              ? () => {
                  reset();
                  pg.setPage(1);
                }
              : undefined
          }
        >
          {hasStatus || (d.extraFilters?.length ?? 0) > 0 ? (
            <>
              {hasStatus && (
                <div>
                  <Label htmlFor="sms-filter-status">Status</Label>
                  <Select
                    id="sms-filter-status"
                    value={filterValues.status ?? ""}
                    onChange={(e) => {
                      setFilter("status", e.target.value);
                      pg.setPage(1);
                    }}
                    className="text-base md:text-sm"
                  >
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    {d.status === "activeDraft" && <option value="draft">Draft</option>}
                  </Select>
                </div>
              )}
              {(d.extraFilters ?? []).map((f) => (
                <div key={f.key}>
                  <Label htmlFor={`sms-filter-${f.key}`}>{f.label}</Label>
                  <Select
                    id={`sms-filter-${f.key}`}
                    value={filterValues[f.key] ?? ""}
                    onChange={(e) => {
                      setFilter(f.key, e.target.value);
                      pg.setPage(1);
                    }}
                    className="text-base md:text-sm"
                  >
                    <option value="">All</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </>
          ) : undefined}
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          {d.ioEntityKey && (
            <DataIoToolbar
              entityKey={d.ioEntityKey}
              rows={filtered}
              canExport={perms.canExport}
              canImport={perms.canImport}
            />
          )}
          {perms.canCreate && (
            <Button size="md" onClick={startAdd} disabled={editing?.id === null}>
              + Add {d.entityLabel}
            </Button>
          )}
        </div>
      </div>

      {/* ---------------- desktop table (own markup, DataTable classes) ---------------- */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              {d.fields.map((f) => (
                <th key={f.key} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                  {f.label}
                  {f.required && <span className="ml-0.5 text-danger">*</span>}
                </th>
              ))}
              {(d.extraColumns ?? []).map((c) => (
                <th key={c.header} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                  {c.header}
                </th>
              ))}
              {hasStatus && (
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Status</th>
              )}
              <th className="w-40 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {/* add row — outside pagination, always on top */}
            {editing?.id === null && (
              <tr className="border-b border-border bg-primary/5" onKeyDown={onRowKeyDown}>
                {d.fields.map((f, i) => (
                  <td key={f.key} className="px-3 py-1.5 align-middle">
                    {editCell(f, i === 0)}
                  </td>
                ))}
                {(d.extraColumns ?? []).map((c) => (
                  <td key={c.header} className="px-3 py-1.5 align-middle text-sm text-muted-foreground">
                    —
                  </td>
                ))}
                {hasStatus && <td className="px-3 py-1.5 align-middle">{statusEditCell()}</td>}
                <td className="px-3 py-1.5 align-middle">{saveCancelButtons()}</td>
              </tr>
            )}
            {pg.paged.length === 0 && editing?.id !== null ? (
              <tr>
                <td
                  colSpan={d.fields.length + (d.extraColumns?.length ?? 0) + (hasStatus ? 1 : 0) + 1}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              pg.paged.map((r) => {
                const isEditing = editing?.id === getId(r);
                if (isEditing) {
                  return (
                    <tr key={getId(r)} className="border-b border-border bg-primary/5 last:border-0" onKeyDown={onRowKeyDown}>
                      {d.fields.map((f, i) => (
                        <td key={f.key} className="px-3 py-1.5 align-middle">
                          {editCell(f, i === 0)}
                        </td>
                      ))}
                      {(d.extraColumns ?? []).map((c) => (
                        <td key={c.header} className="px-3 py-1.5 align-middle text-sm text-muted-foreground">
                          {c.cell(r)}
                        </td>
                      ))}
                      {hasStatus && <td className="px-3 py-1.5 align-middle">{statusEditCell()}</td>}
                      <td className="px-3 py-1.5 align-middle">{saveCancelButtons()}</td>
                    </tr>
                  );
                }
                return (
                  <tr key={getId(r)} className="border-b border-border last:border-0 hover:bg-surface-muted/60">
                    {d.fields.map((f) => (
                      <td key={f.key} className="px-3 py-2 align-middle">
                        {readCell(f, r)}
                      </td>
                    ))}
                    {(d.extraColumns ?? []).map((c) => (
                      <td key={c.header} className="px-3 py-2 align-middle text-sm text-muted-foreground">
                        {c.cell(r)}
                      </td>
                    ))}
                    {hasStatus && <td className="px-3 py-2 align-middle">{statusPill(r)}</td>}
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center justify-end gap-1">
                        {perms.canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(r)}
                            disabled={!!editing}
                            aria-label={`Edit ${d.entityLabel.toLowerCase()}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                        )}
                        {perms.canDelete && (
                          <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- mobile cards with in-place edit ---------------- */}
      <div className="space-y-2.5 md:hidden">
        {editing?.id === null && (
          <MobileEditCard
            fields={d.fields}
            editCell={editCell}
            statusCell={hasStatus ? statusEditCell() : null}
            buttons={saveCancelButtons(false)}
            onKeyDown={onRowKeyDown}
          />
        )}
        {pg.paged.length === 0 && editing?.id !== null ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          pg.paged.map((r) => {
            if (editing?.id === getId(r)) {
              return (
                <MobileEditCard
                  key={getId(r)}
                  fields={d.fields}
                  editCell={editCell}
                  statusCell={hasStatus ? statusEditCell() : null}
                  buttons={saveCancelButtons(false)}
                  onKeyDown={onRowKeyDown}
                />
              );
            }
            const values = d.fromRow(r);
            const first = d.fields[0];
            const second = d.fields[1];
            const titleKey = d.mobileTitleKey ?? second?.key ?? first.key;
            const title = String(values[titleKey] ?? "") || String(values[first.key] ?? "");
            return (
              <div key={getId(r)} className="rounded-xl border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  disabled={!perms.canEdit || !!editing}
                  className="block w-full p-4 text-left enabled:active:bg-surface-muted disabled:cursor-default"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-foreground">{title || "—"}</div>
                      {d.mobileMeta && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{d.mobileMeta(r)}</div>
                      )}
                    </div>
                    {hasStatus && statusPill(r)}
                  </div>
                </button>
                {perms.canDelete && (
                  <div className="flex justify-end border-t border-border px-3 py-1.5">
                    <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />
    </div>
  );
}

/* ------------------------------------------------------------ mobile edit card */

function MobileEditCard({
  fields,
  editCell,
  statusCell,
  buttons,
  onKeyDown,
}: {
  fields: SimpleField[];
  editCell: (f: SimpleField, autoFocus?: boolean) => ReactNode;
  statusCell: ReactNode;
  buttons: ReactNode;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-surface p-4" onKeyDown={onKeyDown}>
      {fields.map((f) => (
        <div key={f.key}>
          <Label>
            {f.label}
            {f.required && <span className="ml-0.5 text-danger">*</span>}
          </Label>
          {editCell(f)}
        </div>
      ))}
      {statusCell && (
        <div>
          <Label>Status</Label>
          {statusCell}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-3">{buttons}</div>
    </div>
  );
}
