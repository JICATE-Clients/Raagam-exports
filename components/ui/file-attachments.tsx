"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRequiredHold } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Truncated } from "@/components/ui/truncated";
import { SketchThumbnail, useSignedUrl } from "@/components/ui/sketch-thumbnail";
import { createClient } from "@/lib/supabase/client";

/**
 * Documents attached to a record — a JPG of the style, the buyer's original PDF
 * order sheet, a shade card (client 2026-08-12).
 *
 * ## Why this is not `PhotoUpload` with more props
 *
 * `components/ui/photo-upload.tsx` holds ONE image, in the **public**
 * `employee-photos` bucket (0336), and hands back `getPublicUrl` — a URL anyone
 * can read forever, with no login. That is a defensible trade for a staff photo
 * and the wrong one for a buyer's order sheet, which carries the prices and the
 * customer's name. So this reads back through `createSignedUrl` and its bucket
 * is created `public = false`; widening `PhotoUpload` instead would have made
 * the employee screen's URLs signed too, or left this one public by inheritance.
 *
 * ## THE OBJECT OUTLIVES THE ROW, DELIBERATELY
 *
 * The file uploads the moment it is chosen; the metadata row is written on Save.
 * Removing a row therefore drops the row and LEAVES the object in the bucket,
 * and so does cancelling the edit. Deleting on removal would be tidier and is
 * the wrong call: Cancel is the operator's undo, and a delete makes the one
 * action they expect to be reversible destroy a file they may not have another
 * copy of. Orphaned objects accumulate instead. That is a known, accepted
 * remainder — a sweep is a separate job, not a silent side effect of a click.
 *
 * ## Keys
 *
 * Nothing here is field-like except the per-row kind `<Select>`, so `cycleTab`
 * (lib/focus.ts) walks straight to it and skips the buttons — which is the
 * contract, not an accident: Tab lands on FIELDS, and Upload / Remove / Open are
 * actions. They stay on the mouse and in screen-reader order. Render the panel
 * AFTER a section's fields so the Select does not become the section edge ahead
 * of them.
 */

export type AttachmentKind = "sketch" | "order_sheet" | "approval";

export const ATTACHMENT_KINDS: { value: AttachmentKind; label: string }[] = [
  { value: "sketch", label: "Style Sketch / Image" },
  { value: "order_sheet", label: "Buyer Order Sheet" },
  { value: "approval", label: "Approval / Shade Card" },
];

export type AttachmentRow = {
  /** Client-side row identity, as every child grid on these screens uses. */
  key: string;
  doc_kind: AttachmentKind | "";
  file_name: string;
  /** Path WITHIN the bucket. Never a URL — a signed one expires. */
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  /**
   * WHICH STYLE THIS DOCUMENT BELONGS TO — null for a document that belongs to
   * the ORDER (client 2026-08-31: "the Add File control is relocated from the
   * general order header directly into the Style section … technical packs,
   * design sketches, or specification images belong to the specific garment
   * style").
   *
   * TEXT, NOT AN ORDINAL AND NOT AN ID, and that is the one decision here worth
   * reading twice. `writeChildren` deletes and reinserts every child table
   * wholesale on save, so a uuid PK does not survive — but neither does an
   * ordinal: the screen sends `sno: 0` on every style and the server normalizer
   * renumbers, so the client never knows the final number, and a blank style row
   * dropped by the normalizer shifts every ordinal past it. Files would silently
   * re-point at the WRONG style, which is the failure that has no symptom.
   *
   * `style_ref_no` is what all five sibling children of a style already use —
   * `style_sizes`, `style_coordinates`, `pack_components`, `style_components`,
   * `style_processes` — so this is the sixth member of a family, not a new idea.
   *
   * NULL IS A REAL STATE, not "not set yet": every row saved before this column
   * existed is an order-level document, and the Order Info header keeps a corner
   * for exactly those. A ref that matches no style is demoted back to null
   * server-side rather than dropped, because the object is still sitting in the
   * bucket and dropping the row is the one way to make it unreachable.
   */
  style_ref_no: string | null;
};

const DEFAULT_ACCEPT = "image/jpeg,image/png,application/pdf";

/**
 * The refusal sentence, DERIVED FROM `accept` rather than typed beside it.
 *
 * It used to be the literal "only JPG, PNG and PDF are accepted", which was true
 * for exactly as long as every caller took the default. The moment Order Info
 * restricted itself to PDF (client 2026-08-25 — the buyer's tech pack and
 * nothing else), that string became a message telling the operator their JPG was
 * fine, printed at the point of refusing it. **A hard-coded message beside a
 * configurable rule is a lie waiting for its second caller**, and the `accept`
 * prop had been configurable since the component was written.
 *
 * An unknown mime falls back to its own subtype rather than being dropped, so a
 * caller adding one gets an ugly-but-honest sentence instead of a short one that
 * omits the type they just allowed.
 */
const MIME_WORDS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "application/pdf": "PDF",
};

function acceptedWords(accepted: string[]): string {
  const words = Array.from(
    new Set(accepted.map((m) => MIME_WORDS[m] ?? (m.split("/").pop() ?? m).toUpperCase())),
  );
  if (words.length === 0) return "no file types";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
/** Seconds. Long enough to open, short enough that a copied link is not a leak. */
const SIGNED_URL_TTL = 60;

function prettySize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileAttachments({
  rows,
  onChange,
  bucket,
  folder,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = 10,
  disabled,
  label = "Attachments",
  hint = "JPG, PNG or PDF — the style sketch, the buyer order sheet, and any approvals.",
  variant = "panel",
  required,
  disabledReason,
  styleRefNo = null,
}: {
  rows: AttachmentRow[];
  onChange: (next: AttachmentRow[]) => void;
  bucket: string;
  /** Path prefix inside the bucket — scope it to the record, e.g. the amendment id. */
  folder: string;
  accept?: string;
  maxSizeMb?: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
  /**
   * Mandatory: hold the cursor while nothing is attached. `cell` ONLY — see the
   * note on that variant for why the other three cannot honour it.
   *
   * ORed with the surrounding `<Field required>` inside `useRequiredHold`, the
   * same call `DataPicker` and `MultiSelect` make, so wrapping this in one
   * cannot silently un-require it and the star and the hold come from one
   * declaration.
   */
  required?: boolean;
  /**
   * Why this control is refusing, when it is `disabled`. `cell` only, where it
   * becomes the trigger's `title`.
   *
   * A disabled control that does not name the field that would turn it on is a
   * dead end the operator has to guess their way out of — the same rule the
   * Process [Click] button beside it states, and the reason `processGateReason`
   * returns a sentence rather than a boolean.
   */
  disabledReason?: string;
  /**
   * The style every file added HERE belongs to (`AttachmentRow.style_ref_no`).
   *
   * STAMPED BY THE COMPONENT, NOT BY THE CALLER, because the caller cannot tell
   * an added row from a kept one — `handleFiles` appends to `rows` and hands the
   * whole array back, and a caller re-stamping the lot would silently re-file
   * every row it was shown. Uploading is the only moment a row's style is
   * decided, so it is decided here.
   *
   * Null (the default) is an ORDER-LEVEL document, which is what the `panel`,
   * `control` and `tiles` callers all produce and what every row saved before
   * 0479 is. So this prop changes nothing for them.
   */
  styleRefNo?: string | null;
  /**
   * WHICH HALF OF THE PANEL TO DRAW, so the add control can sit in a field row
   * while the files it adds stay full width (client 2026-08-26, screenshot 2496:
   * "remove this wordings — that add file button field like that Merchand.
   * field, same size of it").
   *
   * `panel` — the whole thing: heading, hint, add button, list, empty state.
   *   The original shape, kept for any caller with a block to fill.
   * `control` — the add button ALONE, `w-full` at field height, for a `<Field>`
   *   cell. No heading and no hint: inside a `<Field>` the label above it is the
   *   heading, and a sentence under a control is the prose the 2026-08-17
   *   de-clutter pass took off every screen.
   * `tiles` — the files as PICTURES, stacked, for a narrow column beside the
   *   fields; nothing at all while there are none. This replaced a `list`
   *   variant on 2026-08-26 (client, screenshot 223756: "no need to thi extra
   *   displaying") — once the sketch was on screen in the header's corner, a
   *   strip repeating its name, size and kind underneath was a second answer to
   *   a question already answered.
   * `cell` — a FIELD, for one row of a child grid: a trigger showing how many
   *   files this row carries, the tiles stacked under it, and nothing else. See
   *   the block comment on the `cell` branch below — it is the only variant that
   *   can be mandatory, and the reason is a keyboard one rather than a visual
   *   one.
   *
   * The two halves are two ELEMENTS, not two components: both are driven by the
   * same `rows`/`onChange`, so nothing is duplicated but the JSX. Only `control`
   * and `cell` mount the hidden `<input type="file">`, so there is exactly one of
   * those per rendered add control.
   */
  variant?: "panel" | "control" | "tiles" | "cell";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Read UNCONDITIONALLY — it is a hook — and spread only by `cell`.
   *
   * The other three variants ignore it deliberately rather than by omission: a
   * `<Button>` carries no `data-field-trigger`, so `keyFills` (lib/focus.ts)
   * answers false for every key it has, and a `data-required-empty` on it would
   * refuse the Enter that IS the click that opens the file dialog. That is the
   * unsatisfiable cage AGENTS.md records ("a hold refuses movement and never
   * refuses choosing"), so the marker belongs only where a key can still fill
   * the field.
   */
  const hold = useRequiredHold(!disabled && rows.length === 0, { required, label });

  const accepted = accept.split(",").map((s) => s.trim());
  const maxBytes = maxSizeMb * 1024 * 1024;

  async function handleFiles(files: FileList) {
    setError(null);
    const supabase = createClient();
    const added: AttachmentRow[] = [];

    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!accepted.includes(file.type)) {
          const words = acceptedWords(accepted);
          setError(
            `${file.name}: only ${words} ${words.includes(" ") ? "are" : "is"} accepted.`,
          );
          continue;
        }
        if (file.size > maxBytes) {
          setError(`${file.name}: over the ${maxSizeMb} MB limit.`);
          continue;
        }
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${folder}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) {
          setError(`${file.name}: ${upErr.message}`);
          continue;
        }
        added.push({
          key: crypto.randomUUID(),
          // Guessed from the type and never final — the operator can re-label
          // it. A PDF is far more often the order sheet than a sketch.
          doc_kind: file.type === "application/pdf" ? "order_sheet" : "sketch",
          file_name: file.name,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
          /* Decided HERE and nowhere else — see `styleRefNo`. An order-level
             control leaves it null, which is what the three original variants
             all do and what every row predating 0479 holds. */
          style_ref_no: styleRefNo,
        });
      }
      if (added.length) onChange([...rows, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  /** Signed on demand, never held: a stored URL would be dead when it was clicked. */
  async function open(row: AttachmentRow) {
    setError(null);
    const supabase = createClient();
    const { data, error: signErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL);
    if (signErr || !data?.signedUrl) {
      setError(signErr?.message ?? "Could not open the file.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  /* THE OS FILE DIALOG, on its own so BOTH add controls can drive it.
     Hidden on purpose: a bare file input is unstyleable, and being field-like to
     nobody it would sit in the tab order doing nothing.
     autofill: exempt -- a file input has no suggestion list */
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={accept}
      className="hidden"
      onChange={(e) => {
        const fs = e.target.files;
        if (fs && fs.length) handleFiles(fs);
        e.target.value = "";
      }}
    />
  );

  /* The hidden input, the add button and the error line — everything the
     `control` variant is, and the top half of `panel`. */
  const addControl = (
    <>
      <Button
        type="button"
        variant="outline"
        size={variant === "control" ? "md" : "sm"}
        data-row-add
        disabled={disabled || busy}
        className={variant === "control" ? "w-full" : undefined}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Upload className="h-4 w-4 shrink-0" />
        )}
        {busy ? "Uploading" : "+ Add file"}
      </Button>
      {fileInput}
    </>
  );

  /* `size="md"` on the control variant is `h-9 @2xl/editor:h-8` — the SAME
     string `Input` carries, which is what makes it exactly as tall as the
     Merchand. picker beside it at either density. `sm` (h-8) stays for the
     panel, where it is a child-grid add control in a dense band. */
  if (variant === "control") {
    return (
      <>
        {addControl}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </>
    );
  }

  /* The stacked pictures, shared by `tiles` and `cell` — the SAME element, so a
     file looks and behaves identically whether it hangs beside the header or
     under a style row. Empty renders nothing at all rather than an empty state
     (see `variant`), which is what lets both callers mount it unconditionally. */
  const tileList = rows.length ? (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key}>
          <AttachmentTile
            row={r}
            bucket={bucket}
            disabled={disabled}
            onOpen={() => open(r)}
            onRemove={() => onChange(rows.filter((x) => x.key !== r.key))}
          />
        </li>
      ))}
    </ul>
  ) : null;

  if (variant === "tiles") return tileList;

  /**
   * ONE STYLE ROW'S DOCUMENTS (client 2026-08-31): "the Add File control is
   * relocated from the general order header directly into the Style section …
   * this upload field is designated as mandatory before the style profile can be
   * saved". Per style ROW, not per style section.
   *
   * ## IT IS A `data-field-trigger`, AND THAT IS THE WHOLE DESIGN
   *
   * `control` is a `<Button>`, and a button cannot carry this rule. Two separate
   * reasons, and either one alone is fatal:
   *
   *   · **Tab never reaches it.** Tab lands on FIELDS (`isFieldLike`,
   *     lib/focus.ts) and `isRowAdd` is deliberately NOT folded into that
   *     predicate. So `data-required-empty` on a `<Button>` sits on an element
   *     the cursor never stands on, and a hold nothing can land on is not a hold.
   *   · **The hold would refuse the one key that fills the field.** `keyFills`
   *     answers false for every key on a plain BUTTON — so the held cell would
   *     refuse Enter, and Enter on this control is the native click that opens
   *     the file dialog. The operator could neither attach a file nor leave the
   *     cell, and the only way on would be the mouse. That is the exact
   *     unsatisfiable cage AGENTS.md records shipping once already ("a hold
   *     refuses movement and never refuses choosing").
   *
   * `data-field-trigger` fixes both at once and adds nothing else: `isFieldLike`
   * counts it, so Tab stops here; `keyFills` sees `fieldTrigger` and lets ↓
   * through; and `arrowOpensPicker` clicks it on ↓, so ↓ opens the file dialog
   * exactly as it opens a picker's list two cells to the left. One marker, and
   * the field is on the contract every other cell on the row is on.
   *
   * There is one more link in that chain and it is the one worth naming, because
   * a grid row would otherwise break it: `ownsArrowKeys` returns true for
   * anything under a `[data-grid-row]`, so ↓ inside a grid means "next row". It
   * survives because `gridKeyNav` (child-grid.tsx) declines ↓ over a trigger
   * WITHOUT calling `preventDefault`, precisely so the key carries on to
   * `arrowOpensPicker`. Take that decline away and this cell becomes the cage
   * again — held, and with nothing left that opens it.
   *
   * **↓ IS THE OPENER, AND ENTER IS NOT.** While the hold is on, `keyFills`
   * answers false for Enter (it only fills on a list that is already open), so
   * Enter is refused here. That is not a defect and it is not special to this
   * control — it is what every picker in the app does, and AGENTS.md states it:
   * "a CLOSED list opens on ↓ — the only keyboard route to reaching a value".
   * Worth knowing anyway, because an operator reaching for Enter on a button
   * gets a dead key and the reason is two files away.
   *
   * **NO `data-row-add`.** The two markers must not meet on one element: a
   * control that is both a field and a grid's add button would be walked by
   * ↑↓←→ and diffed by `landOnAddedRow`. This is a field that happens to upload;
   * it is not a grid growing a row.
   *
   * ## WHY IT SHOWS A COUNT AND NOT THE FILES
   *
   * A file ROW is an icon, a name, a size, a 176px kind `<Select>` and a remove —
   * ~290px before the name gets a pixel, which is why the Order Info header put
   * the add control in a `<Field>` and the files somewhere else entirely. A grid
   * row is tighter than that header cell, not wider. So the trigger states the
   * count and the pictures stack beneath it at the cell's own width; shrinking
   * that `<Select>` to fit would be sizing a control by its container instead of
   * by its content, which is the mistake `FIELD_WIDTH` exists to stop.
   *
   * The kind `<Select>` therefore does not appear here at all — `doc_kind` stays
   * the mime-type guess, and the correction is remove-and-re-add. That is not new
   * with this variant: it is exactly what `AttachmentTile`'s own note records
   * losing when the strip came off on 2026-08-26, and this variant inherits the
   * remainder rather than creating it.
   *
   * ## "Click", NOT A PLACEHOLDER
   *
   * The empty word matches the Process [Click] button standing beside it on the
   * same line (client 2026-08-29). A blank button is not an unfilled field
   * showing nothing — it is a control with no affordance, and one word means one
   * thing on this line.
   */
  if (variant === "cell") {
    return (
      <div className="space-y-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-field-trigger
          /* The same marker `MultiSelect` sets, so anything reading "is this
             field answered" off the DOM reads one attribute across the app. */
          data-field-empty={rows.length ? "false" : "true"}
          {...hold}
          disabled={disabled || busy}
          title={disabled ? disabledReason : undefined}
          aria-label={label}
          className="w-full"
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 shrink-0" />
          )}
          {busy
            ? "Uploading"
            : rows.length
              ? `${rows.length} file${rows.length === 1 ? "" : "s"}`
              : "Click"}
        </Button>
        {fileInput}
        {error && <p className="text-xs text-danger">{error}</p>}
        {tileList}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {/* `sm`, not `md` — this is a child-grid add control, the dense band
            AGENTS.md's "The header row" exempts.
            toolbar-size: exempt -- in-editor add control, not a header row */}
        {addControl}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No documents attached.
        </p>
      ) : (
        <ul className="space-y-1.5">{rows.map(fileRow)}</ul>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );

  /** One attached file, shared by the `panel` and `list` variants. */
  function fileRow(r: AttachmentRow) {
    return (
      <AttachmentRowItem
        key={r.key}
        row={r}
        bucket={bucket}
        disabled={disabled}
        onOpen={() => open(r)}
        onPatch={(patch) =>
          onChange(rows.map((x) => (x.key === r.key ? { ...x, ...patch } : x)))
        }
        onRemove={() => onChange(rows.filter((x) => x.key !== r.key))}
      />
    );
  }
}

/**
 * ONE ATTACHED FILE AS A TILE — the picture itself where there is one, a named
 * chip where there is not, and a remove on both.
 *
 * ## IT IS THE ONLY REPRESENTATION THE FILE HAS
 *
 * The strip that used to list every attachment under the header was removed on
 * 2026-08-26 ("no need to thi extra displaying"), so this is not a preview
 * beside a list — it IS the list. Three things follow, and each is a hole if it
 * is skipped:
 *
 *   · EVERY row gets a tile, not just the sketch. The corner used to render
 *     `sketchPath`, which is the first row whose `doc_kind` is `sketch` — so a
 *     buyer's PDF order sheet would have had no representation anywhere on the
 *     screen at all.
 *   · A picture that cannot paint falls back to the chip (`fallback` on
 *     `SketchThumbnail`), because a file that renders as nothing is a file that
 *     cannot be opened or removed.
 *   · REMOVE LIVES HERE. It was on the strip's row; with the strip gone, an
 *     operator who attached the wrong file would have had no way to detach it.
 *
 * ## WHAT WENT WITH THE STRIP, AND IS NOT REPLACED
 *
 * The per-row kind `<Select>`. `doc_kind` is guessed on upload from the mime
 * type — PDF to `order_sheet`, anything else to `sketch` — and that guess is now
 * final on this screen. It decides which image the header calls the sketch, so a
 * JPG shade card will lead until it is removed and re-added. The correction is
 * remove-and-re-add, which is already this feature's stated way to change WHICH
 * sketch leads where there are several. Putting the Select back means giving it
 * a home that is not a second row — inside the lightbox is the obvious one.
 *
 * `SketchThumbnail` does the signing, the lightbox and the expiry fallback; this
 * adds the chip, the remove and the stacking. Two components rather than one
 * because the page-header chip must not grow controls it has no room for.
 */
function AttachmentTile({
  row: r,
  bucket,
  disabled,
  onOpen,
  onRemove,
}: {
  row: AttachmentRow;
  bucket: string;
  disabled?: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const isImage = r.mime_type.startsWith("image/");

  /* The non-picture face: a PDF, and the fallback for an image whose signature
     has not arrived or has expired. Clicking it opens the file in a new tab
     through the same 60-second signature the name used to use. */
  const chip = (
    <button
      type="button"
      onClick={onOpen}
      title={r.file_name}
      className="flex w-full items-center gap-2 rounded border border-border bg-surface px-2 py-2 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {r.mime_type === "application/pdf" ? (
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <Truncated text={r.file_name} className="min-w-0 flex-1 text-xs" />
    </button>
  );

  return (
    <div className="group relative">
      {isImage ? (
        <SketchThumbnail
          bucket={bucket}
          path={r.storage_path}
          alt={r.file_name}
          size="lg"
          fallback={chip}
        />
      ) : (
        chip
      )}
      {!disabled && (
        /* ON HOVER AND ON FOCUS, never permanently: at 144px the tile is mostly
           picture and a standing ✕ sits on top of it. `focus-visible` is the half
           that keeps it reachable without a mouse — the ✕ is a button, so Tab
           steps over it by the standing contract, but a screen reader and
           keyboard focus still find it in document order.

           `data-row-remove` is the marker Ctrl+Del steers by inside a child
           grid. There is no grid row here, so it does nothing today; it costs
           nothing and it is the name this app gives this button everywhere. */
        <button
          type="button"
          data-row-remove
          aria-label={`Remove ${r.file_name}`}
          title={`Remove ${r.file_name}`}
          onClick={onRemove}
          className="absolute right-1 top-1 rounded border border-border bg-surface/90 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0" />
        </button>
      )}
    </div>
  );
}

/**
 * ONE ATTACHED FILE AS A ROW — a thumbnail where there is a picture, a file icon
 * where there is not, the name, the size, the kind and a remove.
 *
 * ONLY THE `panel` VARIANT DRAWS THESE NOW. The section that used them moved to
 * `AttachmentTile` above on 2026-08-26; this is the block shape, kept for a
 * caller with a whole row to fill.
 *
 * ## WHY IT IS A COMPONENT AND NOT A `map` CALLBACK
 *
 * It calls `useSignedUrl`, and a hook cannot run inside a callback. That is the
 * whole reason for the split; nothing about the row changed shape.
 *
 * ## THE THUMBNAIL IS THE POINT
 *
 * Mime type used to choose between two ICONS — a page or a picture — which told
 * the operator what KIND of file it was and nothing about which one. An order
 * carries one sketch and one order sheet, so "it is an image" was never the
 * question; "is it the right image" was. `useSignedUrl` is the same hour-long
 * signature the corner tile uses, imported rather than re-derived.
 *
 * IT FALLS BACK RATHER THAN BREAKING: no signature yet, a signature that has
 * expired (`broken`), or a PDF all render the icon. Nothing here can paint a
 * broken-image glyph.
 */
function AttachmentRowItem({
  row: r,
  bucket,
  disabled,
  onOpen,
  onPatch,
  onRemove,
}: {
  row: AttachmentRow;
  bucket: string;
  disabled?: boolean;
  onOpen: () => void;
  onPatch: (patch: Partial<AttachmentRow>) => void;
  onRemove: () => void;
}) {
  const isImage = r.mime_type.startsWith("image/");
  const { url, broken, onBroken } = useSignedUrl(bucket, isImage ? r.storage_path : null);

  return (
    <li
      /* `flex-wrap` SO A NARROW PANE FOLDS INSTEAD OF CRUSHING. The row is a
         thumbnail + name + size + a `w-44` kind Select + remove, which needs
         ~290px before the name gets a pixel. Wrapping puts the name on the
         first line and the Select on the second; without it the name truncates
         to nothing while the Select keeps its declared width. */
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-2"
    >
      {url && !broken ? (
        <button
          type="button"
          onClick={onOpen}
          title="Open this file"
          aria-label={`Open ${r.file_name}`}
          className="h-8 w-8 shrink-0 overflow-hidden rounded border border-border bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL
              from a private bucket is not a static asset and cannot be optimised
              by next/image without routing the credentials through the loader. */}
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
            onError={onBroken}
          />
        </button>
      ) : r.mime_type === "application/pdf" ? (
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        /* An image whose signature has not arrived, or has expired. The icon is
           the fallback rather than a broken-image glyph or an empty box. */
        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      {/* `max-w-64`, NOT `flex-1`. Growing was what spread one filename across
         the whole pane and left ~700px of gap before the size (client
         2026-08-26). A cap plus `Truncated` gives the same protection from a
         long name with none of the stretch — and the ellipsis stays readable,
         which is the standing rule that a cut-off value must be reachable. */}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 max-w-64 text-left text-sm text-foreground hover:underline"
      >
        <Truncated text={r.file_name} className="block" />
      </button>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {prettySize(r.size_bytes)}
      </span>
      <Select
        aria-label="Document type"
        className="w-44 shrink-0"
        value={r.doc_kind}
        disabled={disabled}
        onChange={(e) => onPatch({ doc_kind: e.target.value as AttachmentKind | "" })}
      >
        <option value=""></option>
        {ATTACHMENT_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </Select>
      {/* `data-row-remove` so Ctrl+Del reaches it from the row's Select,
          the affordance every child-grid row already carries. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-row-remove
        disabled={disabled}
        aria-label={`Remove ${r.file_name}`}
        className="shrink-0 text-muted-foreground hover:text-danger"
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
      </Button>
    </li>
  );
}
