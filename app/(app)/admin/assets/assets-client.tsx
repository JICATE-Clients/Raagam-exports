"use client";

import { useMemo, useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { createAsset } from "@/lib/admin/extras-actions";
import { ASSET_STATUS_LABELS, type AssetStatus } from "@/lib/admin/extras-types";
import type { AssetItemOption, AssetWithRefs, LocationOption } from "@/lib/admin/extras-service";
import { withCreatedColumns } from "@/components/ui/created-columns";

function tone(s: AssetStatus): StatusTone {
  switch (s) {
    case "active":
      return "success";
    case "assigned":
      return "info";
    case "retired":
      return "neutral";
    case "disposed":
      return "danger";
  }
}

interface Props {
  rows: AssetWithRefs[];
  locations: LocationOption[];
  /** Active Capital Goods materials the asset name can be picked from (0350). */
  items: AssetItemOption[];
  canCreate: boolean;
}

export function AssetsClient({ rows, locations, items, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  // Machinery normally already exists as a Capital Goods material, so that is
  // the default source for the name (client 2026-07-28). "One-off" stays a
  // first-class choice on screen: a machine bought before the master existed
  // must still be enterable, and it simply saves item_id null.
  const [source, setSource] = useState<"material" | "manual">("material");
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [group, setGroup] = useState("");
  const [locationId, setLocationId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [value, setValue] = useState("");

  const itemOptions = useMemo(
    () => items.map((i) => ({ value: i.id, label: i.name, sublabel: i.category ?? undefined })),
    [items],
  );

  /** Picking a material COPIES its name + category onto the asset rather than
   *  leaving them to be read through the link — the register has to keep
   *  reading correctly after the material row is deleted (0350: SET NULL). */
  function pickItem(id: string) {
    setItemId(id);
    const it = items.find((i) => i.id === id);
    if (!it) return;
    setName(it.name);
    if (it.category) setCategory(it.category);
  }

  /** Switching source clears whichever half no longer applies, so a half-filled
   *  pick can't be saved alongside a hand-typed name. */
  function switchSource(next: "material" | "manual") {
    setSource(next);
    setItemId("");
    setName("");
  }

  const dirty = !!(itemId || name || category || group || locationId || purchaseDate || value);
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setSource("material");
    setItemId("");
    setName("");
    setCategory("");
    setGroup("");
    setLocationId("");
    setPurchaseDate("");
    setValue("");
  }

  function close() {
    reset();
    setOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createAsset({
        name,
        category: category || null,
        asset_group: group || null,
        item_id: source === "material" ? itemId || null : null,
        location_id: locationId || null,
        purchase_date: purchaseDate || null,
        value: value ? parseFloat(value) : null,
        notes: null,
      });
      if (r.ok) {
        success("Asset created");
        router.push(`/admin/assets/${r.id}`);
      } else toastError(r.error);
    });
  }

  const columns: Column<AssetWithRefs>[] = [
    {
      header: "Asset #",
      cell: (r) => (
        <Link href={`/admin/assets/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Category", cell: (r) => <span className="text-sm">{r.category ?? "—"}</span> },
    { header: "Location", cell: (r) => <span className="text-sm">{r.location_code ?? "—"}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{ASSET_STATUS_LABELS[r.status]}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New asset</CardTitle>
              <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="as-name">Name</Label>
                    <div className="mb-2 flex flex-wrap gap-4">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="as-source"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          checked={source === "material"}
                          onChange={() => switchSource("material")}
                        />
                        <span>Capital Goods material</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="as-source"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          checked={source === "manual"}
                          onChange={() => switchSource("manual")}
                        />
                        <span>One-off (type a name)</span>
                      </label>
                    </div>
                    {source === "material" ? (
                      <>
                        <Combobox
                          id="as-name"
                          options={itemOptions}
                          value={itemId}
                          onChange={pickItem}
                          clearable
                          placeholder={items.length ? "Search capital goods…" : "No capital goods materials yet"}
                          disabled={items.length === 0}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Fills the name and category from the material master. Nothing to pick? Choose
                          “One-off” and type the name.
                        </p>
                      </>
                    ) : (
                      <Input id="as-name" value={name} onChange={(e) => setName(e.target.value)} required />
                    )}
                  </div>
                  <div><Label htmlFor="as-cat">Category</Label><Input id="as-cat" placeholder="e.g. Machinery" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
                  <div><Label htmlFor="as-group">Group</Label><Input id="as-group" value={group} onChange={(e) => setGroup(e.target.value)} /></div>
                  <div>
                    <Label htmlFor="as-loc">Location</Label>
                    <Select id="as-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                      <option value="">— none —</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="as-date">Purchase date</Label><Input id="as-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
                  <div><Label htmlFor="as-val">Value</Label><Input id="as-val" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                  <Button type="submit" disabled={isPending || !name.trim()}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New asset</Button></div>
        ))}
      <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No assets yet." />
    </div>
  );
}
