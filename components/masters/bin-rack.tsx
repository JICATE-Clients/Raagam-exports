"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { creatorName } from "@/components/ui/created-columns";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { deletedToast } from "@/lib/masters/delete-message";
import { createBinRange, updateBin, deleteBin } from "@/lib/masters/bin-actions";
import { binRangeCodes, BIN_RANGE_MAX, type Bin } from "@/lib/masters/bin-types";
import type { BinStock } from "@/lib/masters/bin-service";
import type { StoreRow } from "@/lib/masters/store-master-types";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * THE BINS RACK (user 2026-11-04, approved mockup "Bin Master Redesign"). A store list
 * on the left; the chosen store drawn as a physical rack on the right — two uprights,
 * a beam under every ten bins, each bin a compartment on its shelf, numbered by its
 * place in the store's own sequence (MAT01 sits on shelf 01, MAT14 on shelf 11).
 *
 * The store's STYLE is read from its own codes, never stored: the most-used prefix,
 * its widest number and the next free one. That is what lets "+ Add Bins" open
 * already filled — MAT and 31, or PUR/ and 002 — so a range continues the codes the
 * store already has instead of starting a second style (PUR/02 beside PUR/001).
 *
 * Adding and editing happen IN THE PANE, never in a dialog (user: "inline, compact,
 * no another dialog box"). A bin holding stock is shaded and cannot be deleted from
 * here — its Delete is greyed with the reason, not hidden (AGENTS.md "Row actions").
 */

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Style = { prefix: string; width: number; next: string; last: string };

/** The prefix this store's bins mostly use, its widest number and the next free one. */
export function storeStyle(bins: Pick<Bin, "bin_code">[]): Style | null {
  const parts = bins
    .map((b) => (b.bin_code ?? "").match(/^(.*?)(\d+)$/))
    .filter((m): m is RegExpMatchArray => !!m);
  if (!parts.length) return null;
  const tally = new Map<string, number>();
  for (const m of parts) tally.set(m[1], (tally.get(m[1]) ?? 0) + 1);
  const prefix = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const mine = parts.filter((m) => m[1] === prefix);
  const top = Math.max(...mine.map((m) => Number(m[2])));
  const width = Math.max(...mine.map((m) => m[2].length));
  return {
    prefix,
    width,
    next: String(top + 1).padStart(width, "0"),
    last: prefix + String(top).padStart(width, "0"),
  };
}

export function BinRack({
  bins,
  stores,
  stock,
  perms,
  adding,
  setAdding,
  toolbar,
}: {
  bins: Bin[];
  stores: StoreRow[];
  stock: Record<string, BinStock>;
  perms: Perms;
  /** Owned by the screen, so its one "+ Add Bins" button can open this from either view. */
  adding: boolean;
  setAdding: (v: boolean) => void;
  /** The screen's view toggle + Add button, drawn at the right of this pane's own row. */
  toolbar: ReactNode;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();

  // Stores with bins first (they are what the operator came for), then the empty
  // active ones as the places a first range can go. A switched-off store still shows
  // while it holds bins.
  const storeList = useMemo(() => {
    const count = new Map<string, number>();
    for (const b of bins) count.set(b.store_id, (count.get(b.store_id) ?? 0) + 1);
    const shown = stores.filter((s) => s.is_active || count.has(s.id));
    return {
      withBins: shown.filter((s) => count.has(s.id)),
      empty: shown.filter((s) => !count.has(s.id)),
      count,
    };
  }, [bins, stores]);

  const [storeId, setStoreId] = useState<string>(() => storeList.withBins[0]?.id ?? storeList.empty[0]?.id ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editStore, setEditStore] = useState("");
  const [fresh, setFresh] = useState<string[]>([]);
  const [draft, setDraft] = useState({ prefix: "", from: "", to: "", desc: "" });

  useUnsavedGuard(adding || editing || isPending);

  const current = stores.find((s) => s.id === storeId) ?? null;
  const mine = useMemo(() => bins.filter((b) => b.store_id === storeId), [bins, storeId]);
  const style = useMemo(() => storeStyle(mine), [mine]);
  const holding = mine.filter((b) => stock[b.id]).length;

  // Numbered bins sit on the rack by their number; anything outside the store's
  // sequence (another prefix, no digits) is listed under it, never dropped.
  const { byNumber, loose } = useMemo(() => {
    const byNumber = new Map<number, Bin>();
    const loose: Bin[] = [];
    for (const b of mine) {
      const m = (b.bin_code ?? "").match(/^(.*?)(\d+)$/);
      if (style && m && m[1] === style.prefix && !byNumber.has(Number(m[2]))) byNumber.set(Number(m[2]), b);
      else loose.push(b);
    }
    return { byNumber, loose };
  }, [mine, style]);

  const pickedBin = picked ? (mine.find((b) => b.id === picked) ?? null) : null;

  /* ---------------------------------------------------------------- add */

  // The screen's "+ Add Bins" flips `adding` on. Seed the draft from the store's own
  // style on the first render it is on (state adjusted during render, React's pattern
  // for "reset when a prop changes"), and drop the picked bin so one strip shows.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (adding && seededFor !== storeId) {
    setSeededFor(storeId);
    setDraft({ prefix: style?.prefix ?? "", from: style?.next ?? "1", to: "", desc: "" });
    setPicked(null);
    setEditing(false);
  }
  if (!adding && seededFor !== null) setSeededFor(null);

  const taken = useMemo(() => new Set(bins.map((b) => (b.bin_code ?? "").toUpperCase())), [bins]);
  const preview = useMemo(() => {
    const p = draft.prefix.trim();
    const f = draft.from.trim();
    const t = draft.to.trim();
    if (!p || !/^\d+$/.test(f) || (t && !/^\d+$/.test(t))) return { ok: false, text: "Enter a prefix and a From number." };
    if (t && Number(t) < Number(f)) return { ok: false, text: "To must not be less than From." };
    if (Number(t || f) - Number(f) + 1 > BIN_RANGE_MAX) return { ok: false, text: `At most ${BIN_RANGE_MAX} bins in one go.` };
    const codes = binRangeCodes(p, f, t);
    const clash = codes.filter((c) => taken.has(c));
    if (clash.length)
      return {
        ok: false,
        bad: true,
        text: `Already exist: ${clash.slice(0, 5).join(", ")}${clash.length > 5 ? ` and ${clash.length - 5} more` : ""}. Change From or the prefix.`,
      };
    const n = codes.length;
    return { ok: true, text: `Will create ${n} bin${n > 1 ? "s" : ""}: ${n > 1 ? `${codes[0]} – ${codes[n - 1]}` : codes[0]}`, codes };
  }, [draft, taken]);

  function saveRange(e: FormEvent) {
    e.preventDefault();
    if (!preview.ok || isPending || !storeId) return;
    const codes = preview.codes ?? [];
    startTransition(async () => {
      const res = await createBinRange({
        store_id: storeId,
        prefix: draft.prefix,
        from_no: draft.from,
        to_no: draft.to,
        description: draft.desc || null,
        inactive: false,
      });
      if (!res.ok) {
        error(res.error);
        return;
      }
      success(res.message ?? "Bins added.");
      setFresh(codes);
      setAdding(false);
      router.refresh();
    });
  }

  /* --------------------------------------------------------- pick & edit */

  function pick(b: Bin) {
    if (adding) return;
    setEditing(false);
    setPicked((p) => (p === b.id ? null : b.id));
  }
  function startEdit(b: Bin) {
    setEditDesc(b.description ?? "");
    setEditStore(b.store_id);
    setEditing(true);
  }
  function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!pickedBin || isPending) return;
    startTransition(async () => {
      const res = await updateBin(pickedBin.id, {
        bin_code: "", // blank = keep the code it has (updateBin)
        store_id: editStore,
        description: editDesc.trim() || null,
        inactive: pickedBin.inactive,
      });
      if (!res.ok) {
        error(res.error);
        return;
      }
      success(`Bin ${pickedBin.bin_code} updated.`);
      setEditing(false);
      if (editStore !== storeId) setStoreId(editStore);
      router.refresh();
    });
  }
  function remove(b: Bin) {
    startTransition(async () => {
      const res = await deleteBin(b.id);
      if (!res.ok) {
        error(res.error);
        return;
      }
      success(deletedToast("Bin", { inactive: res.inactive, usedBy: res.usedBy }));
      setPicked(null);
      router.refresh();
    });
  }

  /* -------------------------------------------------------------- render */

  const keys = [...byNumber.keys()];
  const lo = keys.length ? Math.min(...keys) : 0;
  const hi = keys.length ? Math.max(...keys) : 0;
  const shelves: number[] = [];
  for (let start = Math.floor((lo - 1) / 10) * 10 + 1; keys.length && start <= hi; start += 10) shelves.push(start);
  const pad = (n: number) => String(n).padStart(style?.width ?? 2, "0");

  function binCell(b: Bin, label: string) {
    const s = stock[b.id];
    return (
      // button-shape: exempt -- a rack compartment that selects its bin for the detail strip, not a pick-one word control
      <button
        key={b.id}
        type="button"
        onClick={() => pick(b)}
        aria-pressed={picked === b.id}
        title={`${b.bin_code}${s ? ` · holds ${fmtNumber(s.qty)} qty, ${s.items} item${s.items > 1 ? "s" : ""}` : " · empty"}${b.inactive ? " · inactive" : ""}`}
        className={cn(
          "relative grid h-full min-w-0 place-items-center rounded-t-md border border-b-0 border-border bg-surface font-mono text-[13px] font-semibold text-foreground transition-colors",
          "hover:border-primary hover:text-primary",
          s && "border-primary/40 bg-primary-soft text-primary after:absolute after:inset-x-1.5 after:bottom-1 after:h-[3px] after:rounded-full after:bg-primary/70",
          fresh.includes((b.bin_code ?? "").toUpperCase()) && "ring-2 ring-inset ring-success",
          b.inactive && "text-muted-foreground line-through opacity-60",
          picked === b.id && "border-primary bg-primary text-white hover:text-white after:bg-white/80",
        )}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* No "Find a bin" box (user 2026-11-04, screenshot 122222: a blank field under the
          breadcrumb) — the store list and the rack ARE the way to a bin; List view keeps search. */}
      <div className="flex flex-wrap items-center justify-end gap-2">{toolbar}</div>

      <div className="grid items-start gap-4 md:grid-cols-[15rem_1fr]">
        {/* ---------------- store list ---------------- */}
        <nav aria-label="Stores" className="grid gap-0.5 rounded-lg border border-border bg-surface p-2">
          {[...storeList.withBins, ...storeList.empty].map((s, i) => {
            const n = storeList.count.get(s.id) ?? 0;
            return (
              <div key={s.id}>
                {i === storeList.withBins.length && storeList.withBins.length > 0 && <div className="mx-2 my-1.5 h-px bg-border" />}
                <button
                  type="button"
                  aria-current={s.id === storeId}
                  onClick={() => {
                    setStoreId(s.id);
                    setPicked(null);
                    setEditing(false);
                    setAdding(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-surface-muted",
                    s.id === storeId && "bg-primary-soft text-primary hover:bg-primary-soft",
                    !n && s.id !== storeId && "font-normal text-muted-foreground",
                  )}
                >
                  <Warehouse className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                  <Truncated className="min-w-0 flex-1">{s.name}</Truncated>
                  <span className="font-mono text-xs opacity-80">{n || "—"}</span>
                </button>
              </div>
            );
          })}
          {!stores.length && <p className="p-2 text-sm text-muted-foreground">No stores in this unit yet.</p>}
        </nav>

        {/* ---------------- the rack ---------------- */}
        <section className="grid gap-4 rounded-lg border border-border bg-surface p-5" aria-label={current?.name ?? "Store"}>
          <div>
            <h2 className="text-lg font-semibold">{current?.name ?? "—"}</h2>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
              {style && (
                <span>
                  Prefix <b className="font-mono font-semibold text-foreground">{style.prefix}</b>
                </span>
              )}
              <span>
                <b className="font-mono font-semibold text-foreground">{mine.length}</b> bins
              </span>
              {mine.length > 0 && (
                <span>
                  <b className="font-mono font-semibold text-foreground">{holding}</b> holding stock
                </span>
              )}
              {style && (
                <span>
                  Next <b className="font-mono font-semibold text-foreground">{style.prefix + style.next}</b>
                </span>
              )}
            </div>
          </div>

          {adding && perms.canCreate && (
            <form
              onSubmit={saveRange}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              data-focus-scope
              className="grid gap-2 rounded-lg border border-primary bg-primary-soft p-3"
            >
              <FieldRow gap="tight">
                <Field label="Prefix" w="hug" required>
                  <Input
                    value={draft.prefix}
                    onChange={(e) => setDraft((d) => ({ ...d, prefix: e.target.value }))}
                    className="font-mono"
                    autoFocus={!style}
                  />
                </Field>
                <Field label="From" w="num" required>
                  <Input
                    inputMode="numeric"
                    value={draft.from}
                    onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value.replace(/\D/g, "") }))}
                    className="font-mono"
                  />
                </Field>
                <Field label="To" w="num">
                  <Input
                    inputMode="numeric"
                    value={draft.to}
                    placeholder="One"
                    onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value.replace(/\D/g, "") }))}
                    className="font-mono"
                    autoFocus={!!style}
                  />
                </Field>
                <Field label="Description" w="name">
                  <Input value={draft.desc} onChange={(e) => setDraft((d) => ({ ...d, desc: e.target.value }))} />
                </Field>
                <div className="ml-auto flex gap-1.5">
                  {/* toolbar-size: exempt -- inline row actions inside the pane, the grid's dense size */}
                  <Button type="button" variant="outline" size="sm" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={!preview.ok || isPending}>
                    {isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </FieldRow>
              <p
                aria-live="polite"
                className={cn(
                  "text-[13px] text-muted-foreground",
                  preview.ok && "font-medium text-success",
                  "bad" in preview && preview.bad && "font-medium text-danger",
                )}
              >
                {preview.ok && "✓ "}
                {preview.text}
              </p>
            </form>
          )}

          {shelves.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="grid min-w-[36rem] grid-cols-[2.25rem_1fr] gap-x-2.5">
                {/* shelf labels */}
                <div className="grid auto-rows-[3.25rem] gap-2.5 pt-2.5" aria-hidden>
                  {shelves.map((s) => (
                    <span key={s} className="flex items-center justify-end font-mono text-[11px] text-muted-foreground">
                      {pad(s)}
                    </span>
                  ))}
                </div>
                {/* frame: two uprights, a beam under every shelf — SOFT hairlines, not dark bars
                    (user 2026-11-04, screenshot 4032: "dark lines … soft division"). The LAST shelf drops
                    its bottom margin so the uprights end on its beam instead of hanging 10px
                    below it (screenshot 4033: "not finished line hanging"). */}
                <div className="relative px-3 pt-2.5">
                  <span className="absolute inset-y-0 left-0 w-px bg-border" aria-hidden />
                  <span className="absolute inset-y-0 right-0 w-px bg-border" aria-hidden />
                  {shelves.map((start) => (
                    <div key={start} className="relative mb-2.5 grid h-[3.25rem] grid-cols-10 gap-1.5 px-1 pb-1.5 last:mb-0">
                      {Array.from({ length: 10 }, (_, i) => {
                        const n = start + i;
                        const b = byNumber.get(n);
                        if (b) return binCell(b, pad(n));
                        if (n < lo || n > hi) return <span key={n} aria-hidden />;
                        return (
                          <span
                            key={n}
                            title={`${style?.prefix ?? ""}${pad(n)} is not made`}
                            className="grid place-items-center rounded-t-md border border-b-0 border-dashed border-border font-mono text-[13px] text-muted-foreground"
                          >
                            {pad(n)}
                          </span>
                        );
                      })}
                      <span className="absolute -inset-x-3 bottom-0 h-px bg-border" aria-hidden />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            !loose.length &&
            !adding && (
              <p className="text-sm text-muted-foreground">
                No bins in {current?.name ?? "this store"} yet.{perms.canCreate && " Press + Add Bins and give them a prefix."}
              </p>
            )
          )}

          {shelves.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <i className="h-3 w-3 rounded-[3px] border border-border bg-surface" />
                Empty
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-3 w-3 rounded-[3px] border border-primary bg-primary-soft" />
                Holds stock
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-3 w-3 rounded-[3px] border border-dashed border-border" />
                Number not made
              </span>
            </div>
          )}

          {loose.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <span>{style ? "Not in the numbering" : "Bins"}</span>
              {loose.map((b) => (
                <span key={b.id} className="h-8">
                  {binCell(b, b.bin_code ?? "—")}
                </span>
              ))}
            </div>
          )}

          {/* ---------------- the picked bin ---------------- */}
          {pickedBin && (
            <form
              onSubmit={saveEdit}
              onKeyDown={(e) => e.key === "Escape" && (editing ? setEditing(false) : setPicked(null))}
              data-focus-scope={editing || undefined}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-surface-muted px-3.5 py-3 text-[13px]"
            >
              <span className="font-mono text-[15px] font-semibold">{pickedBin.bin_code}</span>
              <span className="text-muted-foreground">
                {stock[pickedBin.id] ? (
                  <>
                    Holds <b className="font-semibold text-foreground">{fmtNumber(stock[pickedBin.id].qty)}</b> qty ·{" "}
                    <b className="font-semibold text-foreground">{stock[pickedBin.id].items}</b> item
                    {stock[pickedBin.id].items > 1 ? "s" : ""}
                  </>
                ) : (
                  "Empty"
                )}
              </span>
              {editing ? (
                <>
                  <Select
                    aria-label="Store"
                    value={editStore}
                    onChange={(e) => setEditStore(e.target.value)}
                    className="w-44"
                  >
                    {stores
                      .filter((s) => s.is_active || s.id === pickedBin.store_id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </Select>
                  <Input
                    aria-label="Description"
                    placeholder="Description"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="w-56"
                    autoFocus
                  />
                </>
              ) : (
                <span className="text-muted-foreground">{pickedBin.description || "No description"}</span>
              )}
              <span className="text-muted-foreground">
                Created {fmtDate(pickedBin.created_at)}
                {creatorName(pickedBin) ? ` by ${creatorName(pickedBin)}` : ""}
                {pickedBin.inactive ? " · Inactive" : ""}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {editing ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={isPending}>
                      {isPending ? "Saving…" : "Save"}
                    </Button>
                  </>
                ) : (
                  <>
                    {perms.canEdit && (
                      <Button type="button" variant="outline" size="sm" onClick={() => startEdit(pickedBin)}>
                        Edit
                      </Button>
                    )}
                    {perms.canDelete &&
                      (stock[pickedBin.id] ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled
                          title="Holds stock. Move it to another bin with a Stock Transfer first."
                        >
                          Delete
                        </Button>
                      ) : (
                        <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(pickedBin)} />
                      ))}
                  </>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
