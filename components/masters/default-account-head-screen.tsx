"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { upsertDefaultAccountHead } from "@/lib/masters/default-account-head-actions";
import type {
  DefaultAccountHead,
  DefaultAccountHeadInput,
} from "@/lib/masters/default-account-head-types";
import type { AccountHead } from "@/lib/masters/account-head-types";

type Perms = { canEdit: boolean };

const FIELD_DEFS = [
  {
    group: "Transaction Accounts",
    fields: [
      { key: "discount_ac_id" as const, label: "Discount" },
      { key: "freight_ac_id" as const, label: "Freight" },
      { key: "insurance_ac_id" as const, label: "Insurance" },
      { key: "agency_commission_ac_id" as const, label: "Agency Commission" },
      { key: "round_off_ac_id" as const, label: "Round Off" },
    ],
  },
  {
    group: "Exchange Rate Accounts",
    fields: [
      { key: "exchange_gain_ac_id" as const, label: "Exchange Gain" },
      { key: "exchange_loss_ac_id" as const, label: "Exchange Loss" },
    ],
  },
  {
    group: "Difference Accounts",
    fields: [
      { key: "qty_diff_ac_id" as const, label: "Qty Difference" },
      { key: "rate_diff_ac_id" as const, label: "Rate Difference" },
    ],
  },
];

type FieldKey = (typeof FIELD_DEFS)[number]["fields"][number]["key"];

const BLANK: Record<FieldKey, string | null> = {
  discount_ac_id: null,
  freight_ac_id: null,
  insurance_ac_id: null,
  agency_commission_ac_id: null,
  round_off_ac_id: null,
  exchange_gain_ac_id: null,
  exchange_loss_ac_id: null,
  qty_diff_ac_id: null,
  rate_diff_ac_id: null,
};

function toForm(row: DefaultAccountHead | null): Record<FieldKey, string | null> {
  if (!row) return { ...BLANK };
  return {
    discount_ac_id: row.discount_ac_id,
    freight_ac_id: row.freight_ac_id,
    insurance_ac_id: row.insurance_ac_id,
    agency_commission_ac_id: row.agency_commission_ac_id,
    round_off_ac_id: row.round_off_ac_id,
    exchange_gain_ac_id: row.exchange_gain_ac_id,
    exchange_loss_ac_id: row.exchange_loss_ac_id,
    qty_diff_ac_id: row.qty_diff_ac_id,
    rate_diff_ac_id: row.rate_diff_ac_id,
  };
}

export function DefaultAccountHeadScreen({
  row,
  accountHeads,
  perms,
}: {
  row: DefaultAccountHead | null;
  accountHeads: AccountHead[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(() => toForm(row));

  function setField(key: FieldKey, value: string | null) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    startTransition(async () => {
      const payload: DefaultAccountHeadInput = { ...form };
      const res = await upsertDefaultAccountHead(row?.id ?? null, payload);
      if (res.ok) {
        success("Default account heads saved.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const activeHeads = accountHeads.filter((h) => !h.inactive);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {FIELD_DEFS.map((group) => (
        <DetailSection key={group.group} label={group.group}>
          {group.fields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`dah-${field.key}`}>{field.label}</Label>
              <Select
                id={`dah-${field.key}`}
                value={form[field.key] ?? ""}
                onChange={(e) =>
                  setField(field.key, e.target.value || null)
                }
                disabled={!perms.canEdit}
                className="text-base md:text-sm"
              >
                <option value="">— None —</option>
                {activeHeads.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.short_name ? `${h.short_name} — ${h.name}` : h.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </DetailSection>
      ))}

      {perms.canEdit && (
        <div className="flex justify-end">
          <Button size="md" disabled={isPending} onClick={submit}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
