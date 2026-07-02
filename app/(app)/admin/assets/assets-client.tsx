"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { createAsset } from "@/lib/admin/extras-actions";
import { ASSET_STATUS_LABELS, type AssetStatus } from "@/lib/admin/extras-types";
import type { AssetWithRefs, LocationOption } from "@/lib/admin/extras-service";

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
  canCreate: boolean;
}

export function AssetsClient({ rows, locations, canCreate }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [group, setGroup] = useState("");
  const [locationId, setLocationId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [value, setValue] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createAsset({
        name,
        category: category || null,
        asset_group: group || null,
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
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2"><Label htmlFor="as-name">Name</Label><Input id="as-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
                  <div><Label htmlFor="as-cat">Category</Label><Input id="as-cat" placeholder="e.g. Machinery" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
                  <div><Label htmlFor="as-group">Group</Label><Input id="as-group" value={group} onChange={(e) => setGroup(e.target.value)} /></div>
                  <div>
                    <Label htmlFor="as-loc">Location</Label>
                    <Select id="as-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                      <option value="">— none —</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="as-date">Purchase date</Label><Input id="as-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
                  <div><Label htmlFor="as-val">Value</Label><Input id="as-val" type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New asset</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No assets yet." />
    </div>
  );
}
