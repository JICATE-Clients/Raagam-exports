"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, Plus, RotateCcw, Save, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RecordPicker } from "@/components/masters/record-picker";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createPoImport, savePoDraft } from "@/lib/orders/po-import/actions";
import { draftSizeLabels, draftTotals, unresolved, type PoMasters } from "@/lib/orders/po-import/seed";
import { sizeKey } from "@/lib/orders/po-import/match";
import {
  PO_IMPORT_ACCEPT,
  PO_IMPORT_BUCKET,
  PO_IMPORT_MAX_BYTES,
  poFileKind,
  poImportPath,
  type PoDraftLine,
  type PoImportStatus,
  type PoImportStored,
} from "@/lib/orders/po-import/types";

/**
 * Upload Buyer PO — the review screen (doc/order/digitalisation-plan.md §2).
 *
 * Left: the buyer's own file. Right: what was read from it, editable. Amber
 * marks what the reader was unsure of or what matches no master — those are
 * the cells to check. "Create order" opens Order Entry pre-filled; the order is
 * only created when the merchandiser presses Save THERE.
 */

type Recent = { id: string; file_name: string; status: PoImportStatus; created_at: string };
type Current = {
  id: string;
  file_name: string;
  mime_type: string | null;
  status: PoImportStatus;
  error: string | null;
  stored: PoImportStored | null;
  previewUrl: string | null;
};

const AMBER = "rounded-md ring-2 ring-amber-400/70";

export function PoImportScreen({
  configured,
  masters,
  recent,
  current,
}: {
  configured: boolean;
  masters: PoMasters;
  recent: Recent[];
  current: Current | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [stored, setStored] = useState<PoImportStored | null>(current?.stored ?? null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "uploading" | "reading">(null);
  const [problem, setProblem] = useState<string | null>(current?.error ?? null);
  const [newSize, setNewSize] = useState("");
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  // A half-reviewed draft, or a read in flight, must survive the silent auto-reload.
  useUnsavedGuard(dirty || isPending || busy !== null);

  const uncertain = useMemo(() => new Set(stored?.draft.uncertain ?? []), [stored]);
  const warn = (path: string, extra = false) => (uncertain.has(path) || extra ? AMBER : undefined);
  const sizes = stored ? draftSizeLabels(stored.draft) : [];
  const totals = stored ? draftTotals(stored.draft) : null;
  const open = stored ? unresolved(stored) : [];

  const sizeOptions = masters.sizes;
  const liveCustomers = masters.customers.filter((c) => !c.inactive || c.id === stored?.customer_id);
  const liveCountries = masters.countries.filter((c) => !c.inactive || c.id === stored?.country_id);

  function edit(fn: (s: PoImportStored) => PoImportStored) {
    setStored((s) => (s ? fn(s) : s));
    setDirty(true);
  }
  const setHeader = (patch: Partial<PoImportStored["draft"]["header"]>) =>
    edit((s) => ({ ...s, draft: { ...s.draft, header: { ...s.draft.header, ...patch } } }));
  const setLine = (i: number, patch: Partial<PoDraftLine>) =>
    edit((s) => ({ ...s, draft: { ...s.draft, lines: s.draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) } }));
  const setSizeQty = (i: number, label: string, qty: number) =>
    edit((s) => ({
      ...s,
      draft: {
        ...s.draft,
        lines: s.draft.lines.map((l, j) => {
          if (j !== i) return l;
          const rest = l.sizes.filter((z) => sizeKey(z.size) !== label);
          return { ...l, sizes: qty > 0 ? [...rest, { size: label, qty }] : rest };
        }),
      },
    }));

  async function read(importId: string) {
    setBusy("reading");
    setProblem(null);
    try {
      const res = await fetch("/api/orders/po-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId }),
      });
      const body = (await res.json()) as { stored?: PoImportStored; refused?: string };
      if (!res.ok || !body.stored) {
        setProblem(body.refused ?? "The PO could not be read.");
        return false;
      }
      setStored(body.stored);
      setDirty(false);
      return true;
    } catch {
      setProblem("The PO reader could not be reached. Check the connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    if (!poFileKind(file.name, file.type)) {
      toastError("Only PDF, Excel (.xlsx), CSV or image files can be read.");
      return;
    }
    if (file.size > PO_IMPORT_MAX_BYTES) {
      toastError("The file is larger than 15 MB.");
      return;
    }
    setBusy("uploading");
    setProblem(null);
    const id = crypto.randomUUID();
    const path = poImportPath(id, crypto.randomUUID(), file.name);
    const { error } = await createBrowserSupabase()
      .storage.from(PO_IMPORT_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) {
      setBusy(null);
      toastError(`The file could not be uploaded: ${error.message}`);
      return;
    }
    const r = await createPoImport({ id, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size });
    if (!r.ok) {
      setBusy(null);
      toastError(r.error);
      return;
    }
    if (configured) await read(id);
    setBusy(null);
    router.push(`/orders/po-import?id=${id}`);
  }

  function saveDraft(then?: () => void) {
    if (!current || !stored) return;
    startTransition(async () => {
      const r = await savePoDraft(current.id, stored);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      if (then) then();
      else success("Draft saved.");
    });
  }

  function createOrder() {
    if (!current) return;
    const go = () => router.push(`/orders/garment-orders?draft=${current.id}`);
    if (dirty) saveDraft(go);
    else go();
  }

  function addSize() {
    const label = sizeKey(newSize);
    if (!label || !stored || sizes.includes(label)) return;
    // A column only exists while some line holds a qty in it, so the new column
    // opens with a zero on the first line for the operator to overwrite.
    edit((s) => ({
      ...s,
      size_map: { ...s.size_map, [label]: sizeOptions.find((z) => sizeKey(z.name) === label)?.id ?? null },
      draft: {
        ...s.draft,
        lines: s.draft.lines.map((l, j) => (j === 0 ? { ...l, sizes: [...l.sizes, { size: label, qty: 0 }] } : l)),
      },
    }));
    setNewSize("");
  }

  const headerActions = current && stored ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => void read(current.id)} disabled={busy !== null || !configured}>
        <RotateCcw className="h-4 w-4" /> Read again
      </Button>
      <Button variant="outline" onClick={() => saveDraft()} disabled={!dirty || isPending}>
        <Save className="h-4 w-4" /> Save draft
      </Button>
      <Button onClick={createOrder} disabled={isPending || busy !== null}>
        Create order
      </Button>
    </div>
  ) : (
    <Link href="/orders/garment-orders" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
      ← Back to Order Entry
    </Link>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Upload Buyer PO"
        description="Upload the buyer's PO, check what was read, then open it as a new order. Nothing is saved until you press Save on Order Entry."
        actions={headerActions}
      />

      {!configured && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          PO reading is not set up on this deployment (ANTHROPIC_API_KEY is missing). You can still upload a file, but it
          cannot be read until an administrator sets the key.
        </p>
      )}

      {!current && (
        <Card>
          <CardBody className="space-y-3">
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-10 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void upload(f);
              }}
            >
              <FileUp className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm">Drop the buyer&apos;s PO here — PDF, Excel, CSV or a photo (up to 15 MB).</p>
              <Button onClick={() => fileInput.current?.click()} disabled={busy !== null}>
                {busy === "uploading" ? "Uploading…" : busy === "reading" ? "Reading the PO…" : "Choose file"}
              </Button>
              {busy === "reading" && <p className="text-xs text-muted-foreground">Reading can take up to a minute.</p>}
              <input
                ref={fileInput}
                type="file"
                accept={PO_IMPORT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(f);
                }}
              />
            </div>
            {recent.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Recent uploads</p>
                <ul className="space-y-1 text-sm">
                  {recent.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <Link href={`/orders/po-import?id=${r.id}`} className="text-primary hover:underline">
                        {r.file_name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(r.created_at)} · {STATUS_WORD[r.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {current && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* ---- the buyer's own file ---- */}
          <Card>
            <CardBody className="space-y-2">
              <p className="text-sm font-semibold">{current.file_name}</p>
              <Preview url={current.previewUrl} fileName={current.file_name} mime={current.mime_type} />
            </CardBody>
          </Card>

          {/* ---- what was read ---- */}
          <div className="min-w-0 space-y-4" data-focus-scope>
            {problem && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{problem}</p>
            )}
            {!stored && (
              <Card>
                <CardBody className="space-y-2 text-sm">
                  <p>This PO has not been read yet.</p>
                  <Button onClick={() => void read(current.id)} disabled={busy !== null || !configured}>
                    {busy === "reading" ? "Reading the PO…" : "Read the PO"}
                  </Button>
                </CardBody>
              </Card>
            )}

            {stored && (
              <>
                {open.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    <p className="font-semibold">Still to resolve</p>
                    <ul className="list-disc pl-5">
                      {open.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Card>
                  <CardBody className="space-y-3">
                    <p className="text-sm font-semibold">Order header</p>
                    {/* Customer (party) + PO No (term) + 2 dates (code) ≈ 200+176+144+144 = 664px + gaps: one row at xl. */}
                    <FieldRow>
                      <Field label="Customer" w="party">
                        <div className={warn("header.customer_name", !stored.customer_id)}>
                          <RecordPicker
                            label="Customer"
                            compact
                            items={liveCustomers.map((c) => ({ id: c.id, code: c.code ?? null, name: c.name, inactive: c.inactive ?? false }))}
                            value={stored.customer_id}
                            onChange={(id) => edit((s) => ({ ...s, customer_id: id }))}
                          />
                        </div>
                        {stored.draft.header.customer_name && (
                          <p className="mt-0.5 text-xs text-muted-foreground">PO says: {stored.draft.header.customer_name}</p>
                        )}
                      </Field>
                      <Field label="PO No" w="term">
                        {/* caps-input: exempt -- the buyer's PO number is kept exactly as typed (client 2026-09-30, budgetupdate.md §2) */}
                        <Input
                          uppercase={false}
                          value={stored.draft.header.po_no ?? ""}
                          className={warn("header.po_no", !stored.draft.header.po_no)}
                          onChange={(e) => setHeader({ po_no: e.target.value })}
                        />
                      </Field>
                      <Field label="PO Date" w="code">
                        <Input
                          type="date"
                          min="2000-01-01"
                          max="2099-12-31"
                          value={stored.draft.header.po_date ?? ""}
                          className={warn("header.po_date")}
                          onChange={(e) => setHeader({ po_date: e.target.value || null })}
                        />
                      </Field>
                      <Field label="Delivery Date" w="code">
                        <Input
                          type="date"
                          min="2000-01-01"
                          max="2099-12-31"
                          value={stored.draft.header.delivery_date ?? ""}
                          className={warn("header.delivery_date")}
                          onChange={(e) => setHeader({ delivery_date: e.target.value || null })}
                        />
                      </Field>
                    </FieldRow>
                    {/* Currency (hug) + Season (code) + Country (term) = 88+144+176. */}
                    <FieldRow>
                      <Field label="Currency" w="hug">
                        <div className={warn("header.currency", !!stored.draft.header.currency && !stored.currency_code)}>
                          <Select
                            value={stored.currency_code ?? ""}
                            onChange={(e) => edit((s) => ({ ...s, currency_code: e.target.value || null }))}
                          >
                            <option value="">—</option>
                            {masters.currencies.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </Field>
                      <Field label="Season" w="code">
                        <Input
                          value={stored.draft.header.season ?? ""}
                          className={warn("header.season")}
                          onChange={(e) => setHeader({ season: e.target.value || null })}
                        />
                      </Field>
                      <Field label="Country" w="term">
                        <div className={warn("header.country", !!stored.draft.header.country && !stored.country_id)}>
                          <RecordPicker
                            label="Country"
                            compact
                            items={liveCountries.map((c) => ({ id: c.id, code: c.code ?? null, name: c.name, inactive: c.inactive ?? false }))}
                            value={stored.country_id}
                            onChange={(id) => edit((s) => ({ ...s, country_id: id }))}
                          />
                        </div>
                      </Field>
                    </FieldRow>
                  </CardBody>
                </Card>

                <Card>
                  <CardBody className="space-y-2">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <p className="text-sm font-semibold">Lines · size-wise quantities</p>
                      <div className="flex items-end gap-2">
                        <Field label="New size" w="hug">
                          <Input value={newSize} onChange={(e) => setNewSize(e.target.value)} />
                        </Field>
                        {/* toolbar-size: exempt -- a dense control inside the lines card, not the page's header row */}
                        <Button size="sm" variant="outline" onClick={addSize} disabled={!newSize.trim()}>
                          <Plus className="h-4 w-4" /> Size
                        </Button>
                      </div>
                    </div>
                    {/* default-row: exempt -- the rows are what was read from the buyer's PO, not a typing surface opened empty */}
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="px-1 py-1 font-medium" style={{ width: FIELD_WIDTH_CSS.term }}>Style Ref</th>
                            <th className="px-1 py-1 font-medium" style={{ width: FIELD_WIDTH_CSS.code }}>Colour</th>
                            <th className="px-1 py-1 font-medium" style={{ width: FIELD_WIDTH_CSS.term }}>Description</th>
                            {sizes.map((label) => {
                              const mapped = stored.size_map[label] ?? null;
                              return (
                                <th key={label} className="px-1 py-1 font-medium" style={{ width: FIELD_WIDTH_CSS.num }}>
                                  <div className={cn(!mapped && AMBER)}>
                                    <Select
                                      aria-label={`Size ${label}`}
                                      value={mapped ?? ""}
                                      onChange={(e) =>
                                        edit((s) => ({ ...s, size_map: { ...s.size_map, [label]: e.target.value || null } }))
                                      }
                                    >
                                      <option value="">{label} ?</option>
                                      {sizeOptions.map((z) => (
                                        <option key={z.id} value={z.id}>
                                          {z.name}
                                        </option>
                                      ))}
                                    </Select>
                                  </div>
                                </th>
                              );
                            })}
                            <th className="px-1 py-1 text-right font-medium" style={{ width: FIELD_WIDTH_CSS.num }}>Total</th>
                            <th className="px-1 py-1 font-medium" style={{ width: FIELD_WIDTH_CSS.num }}>Price</th>
                            <th className="px-1 py-1 font-medium" style={{ width: FIELD_WIDTH_CSS.code }}>Delivery</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {stored.draft.lines.map((l, i) => {
                            const lineTotal = l.sizes.reduce((a, z) => a + z.qty, 0);
                            return (
                              <tr key={i} data-grid-row className="border-b align-top">
                                <td className="px-1 py-1">
                                  <Input
                                    value={l.style_ref_no ?? ""}
                                    className={warn(`lines.${i}.style_ref_no`, !l.style_ref_no)}
                                    onChange={(e) => setLine(i, { style_ref_no: e.target.value || null })}
                                  />
                                </td>
                                <td className="px-1 py-1">
                                  <Input
                                    value={l.colour ?? ""}
                                    className={warn(`lines.${i}.colour`)}
                                    onChange={(e) => setLine(i, { colour: e.target.value || null })}
                                  />
                                </td>
                                <td className="px-1 py-1">
                                  <Input
                                    value={l.description ?? ""}
                                    className={warn(`lines.${i}.description`)}
                                    onChange={(e) => setLine(i, { description: e.target.value || null })}
                                  />
                                </td>
                                {sizes.map((label) => {
                                  const q = l.sizes.find((z) => sizeKey(z.size) === label)?.qty ?? 0;
                                  return (
                                    <td key={label} className="px-1 py-1">
                                      <Input
                                        type="number"
                                        min={0}
                                        value={q ? String(q) : ""}
                                        className={warn(`lines.${i}.sizes`)}
                                        onChange={(e) => setSizeQty(i, label, Math.max(0, Number(e.target.value) || 0))}
                                      />
                                    </td>
                                  );
                                })}
                                <td className="px-1 py-2 text-right tabular-nums">{fmtNumber(lineTotal)}</td>
                                <td className="px-1 py-1">
                                  <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={l.unit_price == null ? "" : String(l.unit_price)}
                                    className={warn(`lines.${i}.unit_price`)}
                                    onChange={(e) => setLine(i, { unit_price: e.target.value === "" ? null : Number(e.target.value) })}
                                  />
                                </td>
                                <td className="px-1 py-1">
                                  <Input
                                    type="date"
                                    min="2000-01-01"
                                    max="2099-12-31"
                                    value={l.delivery_date ?? ""}
                                    className={warn(`lines.${i}.delivery_date`)}
                                    onChange={(e) => setLine(i, { delivery_date: e.target.value || null })}
                                  />
                                </td>
                                <td className="px-1 py-1">
                                  <button
                                    type="button"
                                    data-row-remove
                                    aria-label={`Remove line ${i + 1}`}
                                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                    onClick={() =>
                                      edit((s) => ({ ...s, draft: { ...s.draft, lines: s.draft.lines.filter((_, j) => j !== i) } }))
                                    }
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* toolbar-size: exempt -- a grid's "+ Add line", dense on purpose like every ChildGrid's */}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-row-add
                      onClick={() =>
                        edit((s) => ({
                          ...s,
                          draft: {
                            ...s.draft,
                            lines: [
                              ...s.draft.lines,
                              { style_ref_no: null, description: null, colour: null, sizes: [], unit_price: null, delivery_date: null },
                            ],
                          },
                        }))
                      }
                    >
                      <Plus className="h-4 w-4" /> Add line
                    </Button>

                    {totals && (
                      <TotalsCheck
                        qty={totals.qty}
                        value={totals.value}
                        statedQty={stored.draft.stated_total_qty}
                        statedValue={stored.draft.stated_total_value}
                        currency={stored.currency_code}
                      />
                    )}
                    {stored.draft.notes && (
                      <p className="text-xs text-muted-foreground">Reader&apos;s note: {stored.draft.notes}</p>
                    )}
                  </CardBody>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_WORD: Record<PoImportStatus, string> = {
  uploaded: "not read yet",
  extracted: "read — ready to review",
  failed: "could not be read",
  used: "opened as an order",
};

function Preview({ url, fileName, mime }: { url: string | null; fileName: string; mime: string | null }) {
  if (!url) return <p className="text-sm text-muted-foreground">The file preview could not be opened.</p>;
  const kind = poFileKind(fileName, mime);
  if (kind === "pdf") {
    return <iframe src={url} title={fileName} className="h-[75vh] w-full rounded-md border" />;
  }
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; next/image would cache it
    return <img src={url} alt={fileName} className="max-h-[75vh] w-full rounded-md border object-contain" />;
  }
  return (
    <p className="text-sm text-muted-foreground">
      Spreadsheets cannot be previewed here.{" "}
      <a href={url} className="text-primary hover:underline" target="_blank" rel="noreferrer">
        Download the file
      </a>{" "}
      to compare.
    </p>
  );
}

function TotalsCheck({
  qty,
  value,
  statedQty,
  statedValue,
  currency,
}: {
  qty: number;
  value: number | null;
  statedQty: number | null;
  statedValue: number | null;
  currency: string | null;
}) {
  const qtyOff = statedQty != null && Math.abs(statedQty - qty) > 0.5;
  const valueOff = statedValue != null && value != null && Math.abs(statedValue - value) > 0.5;
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", (qtyOff || valueOff) && "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40")}>
      <p>
        Lines add up to <strong>{fmtNumber(qty)} pcs</strong>
        {value != null && (
          <>
            {" "}
            · <strong>{fmtNumber(value)} {currency ?? ""}</strong>
          </>
        )}
        .
      </p>
      {statedQty != null && (
        <p className={cn(qtyOff ? "text-amber-900 dark:text-amber-200" : "text-muted-foreground")}>
          The PO&apos;s own total quantity is {fmtNumber(statedQty)} pcs{qtyOff ? " — they do not match. Check the lines." : " — they match."}
        </p>
      )}
      {statedValue != null && value != null && (
        <p className={cn(valueOff ? "text-amber-900 dark:text-amber-200" : "text-muted-foreground")}>
          The PO&apos;s own total value is {fmtNumber(statedValue)}{valueOff ? " — they do not match." : " — they match."}
        </p>
      )}
    </div>
  );
}
