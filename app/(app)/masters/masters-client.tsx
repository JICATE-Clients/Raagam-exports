"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Buyer, Item, Uom, Currency } from "@/lib/masters/types";
import type { BuyerInput, ItemInput, UomInput } from "@/lib/masters/types";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  createBuyer,
  updateBuyer,
  createItem,
  updateItem,
  createUom,
  updateUom,
} from "@/lib/masters/actions";

/* ------------------------------------------------------------------ */
/* Buyers                                                               */
/* ------------------------------------------------------------------ */

const BUYER_DEFAULTS: BuyerInput = {
  code: "",
  name: "",
  country: null,
  currency_code: null,
  contact_email: null,
  contact_phone: null,
  address: null,
  is_active: true,
};

function BuyersSection({
  buyers,
  currencies,
}: {
  buyers: Buyer[];
  currencies: Currency[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<BuyerInput>(BUYER_DEFAULTS);

  function openAdd() {
    setForm(BUYER_DEFAULTS);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(b: Buyer) {
    setForm({
      code: b.code,
      name: b.name,
      country: b.country,
      currency_code: b.currency_code,
      contact_email: b.contact_email,
      contact_phone: b.contact_phone,
      address: b.address,
      is_active: b.is_active,
    });
    setEditId(b.id);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = editId
        ? await updateBuyer(editId, form)
        : await createBuyer(form);
      if (result.ok) {
        success(editId ? "Buyer updated." : "Buyer created.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<Buyer>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs">{r.code}</span>,
    },
    { header: "Name", cell: (r) => r.name },
    { header: "Country", cell: (r) => r.country ?? "—" },
    { header: "Currency", cell: (r) => r.currency_code ?? "—" },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={openAdd}>
          + Add Buyer
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-sm font-semibold text-foreground">
                {editId ? "Edit Buyer" : "New Buyer"}
              </div>

              <div>
                <Label htmlFor="b-code">Code *</Label>
                <Input
                  id="b-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="b-name">Name *</Label>
                <Input
                  id="b-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="b-country">Country</Label>
                <Input
                  id="b-country"
                  value={form.country ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, country: e.target.value || null })
                  }
                />
              </div>
              <div>
                <Label htmlFor="b-currency">Currency</Label>
                <Select
                  id="b-currency"
                  value={form.currency_code ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, currency_code: e.target.value || null })
                  }
                >
                  <option value="">— Select —</option>
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="b-email">Contact Email</Label>
                <Input
                  id="b-email"
                  type="email"
                  value={form.contact_email ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, contact_email: e.target.value || null })
                  }
                />
              </div>
              <div>
                <Label htmlFor="b-phone">Contact Phone</Label>
                <Input
                  id="b-phone"
                  value={form.contact_phone ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, contact_phone: e.target.value || null })
                  }
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="b-address">Address</Label>
                <Textarea
                  id="b-address"
                  rows={2}
                  value={form.address ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value || null })
                  }
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="b-active"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                  className="h-4 w-4 cursor-pointer"
                />
                <label
                  htmlFor="b-active"
                  className="text-sm text-foreground cursor-pointer"
                >
                  Active
                </label>
              </div>
              <div className="col-span-2 flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancel}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                >
                  {isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={buyers}
        getKey={(r) => r.id}
        empty="No buyers yet. Add one above."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Items                                                                */
/* ------------------------------------------------------------------ */

const ITEM_DEFAULTS: ItemInput = {
  code: "",
  name: "",
  category: null,
  uom_id: null,
  is_active: true,
};

function ItemsSection({ items, uoms }: { items: Item[]; uoms: Uom[] }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemInput>(ITEM_DEFAULTS);

  const uomMap = Object.fromEntries(uoms.map((u) => [u.id, `${u.name} (${u.code})`]));

  function openAdd() {
    setForm(ITEM_DEFAULTS);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(item: Item) {
    setForm({
      code: item.code,
      name: item.name,
      category: item.category,
      uom_id: item.uom_id,
      is_active: item.is_active,
    });
    setEditId(item.id);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = editId
        ? await updateItem(editId, form)
        : await createItem(form);
      if (result.ok) {
        success(editId ? "Item updated." : "Item created.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<Item>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs">{r.code}</span>,
    },
    { header: "Name", cell: (r) => r.name },
    { header: "Category", cell: (r) => r.category ?? "—" },
    {
      header: "UOM",
      cell: (r) => (r.uom_id ? (uomMap[r.uom_id] ?? "—") : "—"),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={openAdd}>
          + Add Item
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-sm font-semibold text-foreground">
                {editId ? "Edit Item" : "New Item"}
              </div>

              <div>
                <Label htmlFor="i-code">Code *</Label>
                <Input
                  id="i-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="i-name">Name *</Label>
                <Input
                  id="i-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="i-category">Category</Label>
                <Input
                  id="i-category"
                  value={form.category ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value || null })
                  }
                />
              </div>
              <div>
                <Label htmlFor="i-uom">Unit of Measure</Label>
                <Select
                  id="i-uom"
                  value={form.uom_id ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, uom_id: e.target.value || null })
                  }
                >
                  <option value="">— Select —</option>
                  {uoms.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="i-active"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                  className="h-4 w-4 cursor-pointer"
                />
                <label
                  htmlFor="i-active"
                  className="text-sm text-foreground cursor-pointer"
                >
                  Active
                </label>
              </div>
              <div className="col-span-2 flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancel}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                >
                  {isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={items}
        getKey={(r) => r.id}
        empty="No items yet. Add one above."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UOMs                                                                 */
/* ------------------------------------------------------------------ */

const UOM_DEFAULTS: UomInput = { code: "", name: "", is_active: true };

function UomsSection({ uoms }: { uoms: Uom[] }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<UomInput>(UOM_DEFAULTS);

  function openAdd() {
    setForm(UOM_DEFAULTS);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(u: Uom) {
    setForm({ code: u.code, name: u.name, is_active: u.is_active });
    setEditId(u.id);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = editId
        ? await updateUom(editId, form)
        : await createUom(form);
      if (result.ok) {
        success(editId ? "UOM updated." : "UOM created.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<Uom>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono text-xs">{r.code}</span>,
    },
    { header: "Name", cell: (r) => r.name },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={openAdd}>
          + Add UOM
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-sm font-semibold text-foreground">
                {editId ? "Edit Unit of Measure" : "New Unit of Measure"}
              </div>

              <div>
                <Label htmlFor="u-code">Code *</Label>
                <Input
                  id="u-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="u-name">Name *</Label>
                <Input
                  id="u-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="u-active"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                  className="h-4 w-4 cursor-pointer"
                />
                <label
                  htmlFor="u-active"
                  className="text-sm text-foreground cursor-pointer"
                >
                  Active
                </label>
              </div>
              <div className="col-span-2 flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancel}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                >
                  {isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={uoms}
        getKey={(r) => r.id}
        empty="No units of measure yet. Add one above."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root export                                                          */
/* ------------------------------------------------------------------ */

export default function MastersClient({
  buyers,
  items,
  uoms,
  currencies,
}: {
  buyers: Buyer[];
  items: Item[];
  uoms: Uom[];
  currencies: Currency[];
}) {
  const tabs = [
    {
      key: "buyers",
      label: "Buyers",
      content: <BuyersSection buyers={buyers} currencies={currencies} />,
    },
    {
      key: "items",
      label: "Items",
      content: <ItemsSection items={items} uoms={uoms} />,
    },
    {
      key: "uoms",
      label: "Units of Measure",
      content: <UomsSection uoms={uoms} />,
    },
  ];

  return <Tabs items={tabs} defaultKey="buyers" />;
}
