"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, ListOrdered } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { MasterListShell } from "@/components/masters/master-list-shell";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { sectionValidity } from "@/lib/screens/validity";
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
import { fmtDate } from "@/lib/format";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/** ISO, because that is what `<input type="date">` reads and writes. NOT
 *  `fmtDate` — see AGENTS.md "Dates": a value fed back into a control or a query
 *  stays ISO, and only what the operator READS is DD/MM/YYYY. */
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

type Form = { date: string; track_id: string };

/**
 * Legacy System "Document No format" master — a 3-level nested master-detail.
 * Header (Entry No auto · Date · Track) → many Menu rows → each Menu row has many
 * segment lines that compose its document number.
 *
 * ## Rebuilt on the primitives (2026-08-12)
 *
 * This screen used to be a hand-rolled `fixed inset-0` clone of
 * `MasterFullScreen`: it had copied the layout and, one at a time, most of the
 * behaviour — the focus regions, the scroll lock, the `"save"` shortcut
 * registration, an autofocus effect, both reload guards — each added by a later
 * fix that only ever reached this file. What it never copied was the part that
 * cannot be retrofitted a line at a time:
 *
 * - **`required` was decoration.** The Date label read
 *   `Date <span className="text-danger">*</span>`, typed into the label text.
 *   `useRequiredHold` reads `<Field required>`, so the star had nothing behind it
 *   and a blank Date let Tab, Enter and ↓ straight past — the exact star/hold
 *   divergence AGENTS.md's "one declaration, four enforcers" exists to prevent,
 *   on the one mandatory field this record has.
 * - **`canSave` was hand-assembled** (`disabled={isPending || !date}`), which is
 *   the list `lib/screens/validity.ts` was written to stop screens keeping.
 * - **Two hand-rolled nested grids**, so neither level had `data-row-remove`,
 *   `data-row-add` or the cards layout — Ctrl+Del worked only through the
 *   `aria-label^="Remove"` compatibility fallback, and Tab could not enter an
 *   empty segment list at all.
 * - **Hand-written `grid-cols-3` / `grid-cols-2`**, against the one-width rule.
 *
 * The lesson is the skill's rule 5 read backwards: none of those needed a
 * keyboard fix of their own, they needed the primitives. Composing them is what
 * buys the contract, because the contract is driven by markers `Field`,
 * `ChildGrid` and `MasterFullScreen` already carry.
 */
// dup-check: exempt -- the record's identity is an auto-generated Entry No, and
// `generateUniqueCode` suffixes on collision, so there is nothing typed for a
// duplicate check to watch. What must be unique is a MENU's format, which is a
// nested grid row rather than a field on this form.
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
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNo, setEditNo] = useState<number | null>(null);
  const [form, setForm] = useState<Form>({ date: today(), track_id: "" });
  const [menus, setMenus] = useState<MenuRow[]>([]);

  /**
   * Has the operator changed anything since this record opened. A real flag, not
   * "do the fields hold values" — on an existing record they always do.
   */
  const [dirty, setDirty] = useState(false);

  /** Lets a blocked Save switch section and land on the offending field. */
  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  /**
   * The overlay mount calls `useModalGuard` itself, and `confirmDiscard()`
   * deliberately does not read that one — an open overlay is not the same thing
   * as edited data. So the screen still owes the unsaved guard, keyed on real
   * dirtiness (never on `open`, which would pin the silent PWA auto-update off
   * for as long as the operator sits here). `isPending` is included because a
   * reload landing mid-server-action loses the success toast.
   */
  useUnsavedGuard(dirty || isPending);

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutMenus = (fn: (xs: MenuRow[]) => MenuRow[]) => {
    setMenus(fn);
    setDirty(true);
  };
  const setMenuAt = (key: string, patch: Partial<MenuRow>) =>
    mutMenus((xs) => xs.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  const mutSegs = (menuKey: string, fn: (xs: SegRow[]) => SegRow[]) =>
    mutMenus((xs) => xs.map((m) => (m.key === menuKey ? { ...m, segments: fn(m.segments) } : m)));
  const setSegAt = (menuKey: string, segKey: string, patch: Partial<SegRow>) =>
    mutSegs(menuKey, (xs) => xs.map((s) => (s.key === segKey ? { ...s, ...patch } : s)));

  function openAdd() {
    setEditId(null);
    setEditNo(null);
    setForm({ date: today(), track_id: "" });
    setMenus([blankMenu(newKey(), newKey())]);
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: DocumentNoFormat) {
    setEditId(r.id);
    setEditNo(r.entry_no);
    setForm({ date: r.date?.slice(0, 10) || today(), track_id: r.track_id ?? "" });
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

  const nameOfLookup = (opts: ConfigLookup[], id: string) =>
    opts.find((o) => o.id === id)?.name ?? "";

  // ---- the segment grid, one per menu row ----------------------------------
  // Declared as a function of the owning menu so the columns close over its key.
  // `inlineCards` rather than `forceCards`: six SHORT values per line, sitting
  // inside a menu card that is itself inside the content pane, so stacked cards
  // would be a card in a card in a card — and a table of six columns at that
  // depth is the sideways scroll rule 4 forbids.
  const segmentColumns = (menuKey: string): ChildGridColumn<SegRow>[] => [
    {
      header: "Value Type",
      width: "12rem",
      cell: (s) => (
        <LookupDialogPicker
          kind="doc_value_type"
          label="Value Type"
          compact
          options={valueTypeOptions}
          value={s.value_type_id || null}
          onChange={(id) => setSegAt(menuKey, s.key, { value_type_id: id })}
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
        />
      ),
    },
    {
      header: "Value",
      width: "8rem",
      cell: (s) => (
        <Input
          className="h-8"
          uppercase
          value={s.value}
          onChange={(e) => setSegAt(menuKey, s.key, { value: e.target.value })}
        />
      ),
    },
    {
      header: "Seperator",
      width: "6rem",
      // `uppercase` even though a separator is usually punctuation, where
      // `toUpperCase()` is a no-op. Carving out an exemption for "this one is
      // normally a slash" costs a bespoke rule and gets the odd letter separator
      // wrong; following the rule costs nothing. (Legacy spells it "Seperator" —
      // kept, because that is the label the operator is migrating from.)
      cell: (s) => (
        <Input
          className="h-8"
          uppercase
          value={s.separator}
          onChange={(e) => setSegAt(menuKey, s.key, { separator: e.target.value })}
        />
      ),
    },
    {
      header: "No Of Digits",
      width: "7rem",
      align: "right",
      cell: (s) => (
        <Input
          className="h-8"
          type="number"
          min={0}
          value={s.no_of_digits}
          onChange={(e) => setSegAt(menuKey, s.key, { no_of_digits: e.target.value })}
        />
      ),
    },
    {
      header: "Value From",
      width: "12rem",
      cell: (s) => (
        <LookupDialogPicker
          kind="doc_value_from"
          label="Value From"
          compact
          options={valueFromOptions}
          value={s.value_from_id || null}
          onChange={(id) => setSegAt(menuKey, s.key, { value_from_id: id })}
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
        />
      ),
    },
    {
      header: "Ref. only",
      width: "5.5rem",
      align: "center",
      cell: (s) => (
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-primary"
          aria-label="Ref. only"
          checked={s.ref_only}
          onChange={(e) => setSegAt(menuKey, s.key, { ref_only: e.target.checked })}
        />
      ),
    },
  ];

  // ---- the menu grid --------------------------------------------------------
  // NOTHING HERE IS `required`, and that is a decision rather than an omission.
  // `documentNoFormatMenuInput` accepts a null `menu_id`, so marking the column
  // required would hold the cursor on something the server saves happily — and
  // with `seedRow` below, the blank row every record opens with would cage the
  // operator before they had chosen to add it. That is the trap
  // material-attribute-master-screen records at its own line 1033.
  const menuColumns: ChildGridColumn<MenuRow>[] = [
    {
      header: "Menu",
      cell: (m) => (
        <LookupDialogPicker
          kind="doc_menu"
          label="Menu"
          compact
          options={menuOptions}
          value={m.menu_id || null}
          onChange={(id) => setMenuAt(m.key, { menu_id: id })}
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
        />
      ),
    },
    {
      header: "Location wise",
      cell: (m) => (
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-primary"
          aria-label="Location wise"
          checked={m.location_wise}
          onChange={(e) => setMenuAt(m.key, { location_wise: e.target.checked })}
        />
      ),
    },
    {
      header: "Starting SlNo",
      align: "right",
      cell: (m) => (
        <Input
          className="h-8"
          type="number"
          min={0}
          value={m.starting_sl_no}
          onChange={(e) => setMenuAt(m.key, { starting_sl_no: e.target.value })}
        />
      ),
    },
    {
      header: "Sample DocNo",
      cell: (m) => (
        <Input
          className="h-8"
          uppercase
          value={m.sample_doc_no}
          onChange={(e) => setMenuAt(m.key, { sample_doc_no: e.target.value })}
        />
      ),
    },
  ];

  /**
   * WHAT IS STOPPING A SAVE, AND WHICH SECTION HOLDS IT. Derived, never
   * hand-assembled — and `fields` mirrors the `required` props below, so the red
   * `*`, the cursor hold and this list cannot disagree.
   */
  const validity = sectionValidity({
    sections: [{ key: "format" }, { key: "menus" }],
    values: form,
    fields: [
      {
        section: "format",
        id: "dnf-date",
        label: "Date",
        required: true,
        empty: (f) => !f.date,
      },
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  const sections: FullScreenSection[] = [
    {
      // THE SCREEN'S OWN NAME IS THE FIRST RAIL ROW. The record's header fields
      // are a SECTION, not a band floating above the rail — a field outside a
      // section is a field the primitives cannot see, which is precisely how the
      // Date star ended up with nothing behind it.
      key: "format",
      label: "Document No Format",
      icon: FileText,
      done: !!form.date,
      // NO `problems` BADGE (operator, 2026-08-10). `footer.onBlockedSave` below
      // is what replaces it: Save stays clickable, names the missing field and
      // steers the cursor to it.
      content: (
        <SectionBody title="Document No Format">
          <FieldGrid>
            <Field label="Entry No" size="sm" htmlFor="dnf-entry-no">
              {/* `readOnly` sets `tabIndex={-1}` for us — an auto value is never a
                  tab stop, and a read-only field never holds. */}
              <Input id="dnf-entry-no" value={editNo != null ? `#${editNo}` : "(auto)"} readOnly />
            </Field>
            <Field label="Date" required size="sm" htmlFor="dnf-date">
              <Input
                id="dnf-date"
                type="date"
                value={form.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </Field>
            <Field label="Track" size="sm">
              <LookupDialogPicker
                kind="doc_track"
                label="Track"
                compact
                options={trackOptions}
                value={form.track_id || null}
                onChange={(id) => set({ track_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
              />
            </Field>
          </FieldGrid>
        </SectionBody>
      ),
    },
    {
      key: "menus",
      label: "Menus",
      icon: ListOrdered,
      done: menus.some((m) => !!m.menu_id),
      content: (
        <SectionBody title="Menus">
          <ChildGrid<MenuRow>
            columns={menuColumns}
            rows={menus}
            // A GRID WRAPS; IT NEVER SCROLLS SIDEWAYS — and a table row could not
            // hold the segment panel each menu owns anyway.
            forceCards
            flatRows
            // OPEN WITH ONE BLANK ROW. Also the keyboard's only way in: Tab lands
            // on fields, and an empty grid's sole affordance is a button.
            seedRow
            rowSummary={(m) =>
              m.menu_id ? (
                nameOfLookup(menuOptions, m.menu_id)
              ) : (
                <span className="text-muted-foreground">No menu picked yet</span>
              )
            }
            renderMobileRow={(m, i) => (
              <div className="space-y-3">
                {/* Labels and cells read OFF `columns` — never retyped beside
                    them, or a new column leaves the card and the header
                    disagreeing. `required` is forwarded because cards mode skips
                    the `columns.map()` that wraps each cell in `RequiredScope`,
                    so a column-level `required` would otherwise draw a star with
                    no hold behind it (AGENTS.md, "A GRID THAT RENDERS ITS OWN ROW
                    MUST DECLARE `required` TWICE"). Nothing declares it today;
                    the forward is what keeps that true if one ever does. */}
                <FieldGrid>
                  {menuColumns.map((c, ci) => (
                    <Field key={ci} label={c.header} required={c.required} size="sm">
                      {c.cell(m, i)}
                    </Field>
                  ))}
                </FieldGrid>
                {/* A ROW'S NESTED GRID IS PART OF THE ROW: Tab off the last menu
                    cell walks into these segments, and `ChildGrid`'s own
                    `data-row-add` is what lets it open the first one when the
                    list is empty. `frameless` so the panel has one border and one
                    title rather than a card inside a card. */}
                <DetailSection label="Document-number segments">
                  <ChildGrid<SegRow>
                    columns={segmentColumns(m.key)}
                    rows={m.segments}
                    inlineCards
                    seedRow
                    onAdd={() => mutSegs(m.key, (xs) => [...xs, blankSeg(newKey())])}
                    onRemove={(s) => mutSegs(m.key, (xs) => xs.filter((x) => x.key !== s.key))}
                    addLabel="+ Add segment"
                  />
                </DetailSection>
              </div>
            )}
            onAdd={() => mutMenus((xs) => [...xs, blankMenu(newKey(), newKey())])}
            onRemove={(m) => mutMenus((xs) => xs.filter((x) => x.key !== m.key))}
            addLabel="+ Add menu"
          />
        </SectionBody>
      ),
    },
  ];

  function submit(asDraft: boolean) {
    start(async () => {
      const payload: DocumentNoFormatInput = {
        date: form.date,
        track_id: form.track_id || null,
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
        success(
          editId
            ? "Document format updated."
            : asDraft
              ? "Saved as draft."
              : "Document format added.",
        );
        setDirty(false);
        setOpen(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function remove(r: DocumentNoFormat) {
    start(async () => {
      const res = await deleteDocumentNoFormat(r.id);
      if (res.ok) {
        success("Document format deleted.");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const columns: Column<DocumentNoFormat>[] = [
    { header: "Entry No", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{fmtDate(r.date)}</span> },
    {
      header: "Track",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.track_id ? nameOfLookup(trackOptions, r.track_id) || "—" : "—"}
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
        r.is_draft ? (
          <StatusPill tone="warning">Draft</StatusPill>
        ) : (
          <StatusPill tone="success">Active</StatusPill>
        ),
    },
  ];

  return (
    <>
      <MasterListShell<DocumentNoFormat>
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [String(r.entry_no), r.track_id ? nameOfLookup(trackOptions, r.track_id) : ""]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder="Search by entry no or track…"
        statusOf={(r) => (r.is_draft ? "draft" : "active")}
        addLabel="+ Add Document Format"
        onAdd={perms.canCreate ? openAdd : undefined}
        columns={columns}
        rowLabel={(r) => `#${r.entry_no}`}
        actions={{
          onEdit: perms.canEdit ? openEdit : undefined,
          onDelete: perms.canDelete ? remove : undefined,
        }}
        empty="No document formats yet."
        mobile={{
          title: (r) => `#${r.entry_no}`,
          subtitle: (r) =>
            `${fmtDate(r.date)} · ${r.menus.length} menu${r.menus.length === 1 ? "" : "s"}`,
          meta: (r) => (r.track_id ? nameOfLookup(trackOptions, r.track_id) : null),
          pill: (r) =>
            r.is_draft ? (
              <StatusPill tone="warning">Draft</StatusPill>
            ) : (
              <StatusPill tone="success">Active</StatusPill>
            ),
          onEdit: perms.canEdit ? openEdit : undefined,
          onDelete: perms.canDelete ? remove : undefined,
        }}
        isPending={isPending}
      />

      {/* A MASTER, so the editor sits OVER its list: `mount="overlay"`. That
          makes `header` required — the overlay covers the route's PageHeader, so
          without it nothing on screen names the record being edited. */}
      <MasterFullScreen
        ref={shellRef}
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={editId ? <>Editing document format</> : <>New document format</>}
        header={{
          initials: "DN",
          title: editId ? `Document Format #${editNo}` : "New Document Format",
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              <span>{fmtDate(form.date)}</span>
              {form.track_id && <span>{nameOfLookup(trackOptions, form.track_id)}</span>}
              <span>
                {menus.length} menu{menus.length === 1 ? "" : "s"}
              </span>
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New document format",
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          // Names the ENTITY, not a bare "Save" that could belong to any record.
          saveLabel: "Save format",
          canSave: validity.canSave,
          // Keeps Save CLICKABLE when blocked — `submitTargetOf` resolves the
          // surface's primary action to the footer's last non-disabled button, so
          // a disabled Save silently hands Enter and Ctrl+S to "Save as Draft".
          onBlockedSave: revealFirstProblem,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
    </>
  );
}
