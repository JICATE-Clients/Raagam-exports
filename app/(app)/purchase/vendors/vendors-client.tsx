"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createVendor, updateVendor } from "@/lib/purchase/po-actions";
import type { Vendor, VendorInput, VendorType } from "@/lib/purchase/types";
import { VENDOR_TYPES } from "@/lib/purchase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";

const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  yarn: "Yarn",
  knitting: "Knitting",
  dyeing: "Dyeing",
  trims: "Trims",
  packing: "Packing",
  processing: "Processing",
  general: "General",
};

const EMPTY_FORM: VendorInput = {
  name: "",
  vendor_type: null,
  contact_person: null,
  email: null,
  phone: null,
  address: null,
  gst_number: null,
  is_active: true,
};

function vendorToForm(v: Vendor): VendorInput {
  return {
    name: v.name,
    vendor_type: v.vendor_type,
    contact_person: v.contact_person,
    email: v.email,
    phone: v.phone,
    address: v.address,
    gst_number: v.gst_number,
    is_active: v.is_active,
  };
}

export function VendorsClient({
  vendors,
  canCreate,
  canEdit,
}: {
  vendors: Vendor[];
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  useCreateIntent(() => setShowForm(true));
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<VendorInput>(EMPTY_FORM);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(v: Vendor) {
    setForm(vendorToForm(v));
    setEditId(v.id);
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
        ? await updateVendor(editId, form)
        : await createVendor(form);
      if (result.ok) {
        success(editId ? "Vendor updated." : "Vendor created.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<Vendor>[] = [
    {
      header: "Code",
      cell: (r) => (
        <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span>
      ),
    },
    {
      header: "Name",
      cell: (r) => <span className="text-sm font-medium">{r.name}</span>,
    },
    {
      header: "Type",
      cell: (r) =>
        r.vendor_type ? (
          <StatusPill tone="info">
            {VENDOR_TYPE_LABELS[r.vendor_type]}
          </StatusPill>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: "Contact",
      cell: (r) => (
        <span className="text-sm">{r.contact_person ?? "—"}</span>
      ),
    },
    {
      header: "Phone",
      cell: (r) => <span className="text-sm">{r.phone ?? "—"}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    ...(canEdit
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: Vendor) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openEdit(r)}
              >
                Edit
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Button size="sm" onClick={openAdd}>
            + New vendor
          </Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardBody>
            <form
              onSubmit={handleSubmit}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <div className="text-sm font-semibold text-foreground sm:col-span-2">
                {editId ? "Edit vendor" : "New vendor"}
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="v-name">Name *</Label>
                <Input
                  id="v-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="v-type">Type</Label>
                <Select
                  id="v-type"
                  value={form.vendor_type ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      vendor_type: (e.target.value as VendorType) || null,
                    })
                  }
                >
                  <option value="">— Select —</option>
                  {VENDOR_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {VENDOR_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="v-contact">Contact person</Label>
                <Input
                  id="v-contact"
                  value={form.contact_person ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, contact_person: e.target.value || null })
                  }
                />
              </div>

              <div>
                <Label htmlFor="v-email">Email</Label>
                <Input
                  id="v-email"
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, email: e.target.value || null })
                  }
                />
              </div>

              <div>
                <Label htmlFor="v-phone">Phone</Label>
                <Input
                  id="v-phone"
                  value={form.phone ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, phone: e.target.value || null })
                  }
                />
              </div>

              <div>
                <Label htmlFor="v-gst">GST number</Label>
                <Input
                  id="v-gst"
                  value={form.gst_number ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, gst_number: e.target.value || null })
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="v-address">Address</Label>
                <Textarea
                  id="v-address"
                  rows={2}
                  value={form.address ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value || null })
                  }
                />
              </div>

              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  id="v-active"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                  className="h-4 w-4 cursor-pointer"
                />
                <label
                  htmlFor="v-active"
                  className="cursor-pointer text-sm text-foreground"
                >
                  Active
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-1 sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancel}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={vendors}
        getKey={(r) => r.id}
        empty="No vendors yet. Add one above."
      />
    </div>
  );
}
