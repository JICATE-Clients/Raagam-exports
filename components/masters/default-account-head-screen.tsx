"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid } from "@/components/masters/section-grid";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRegisterShortcut } from "@/lib/shortcuts";
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

  // This screen is neither a Sheet nor a MasterFullScreen, so it inherits
  // NOTHING: no modal guard, no autofocus, no Ctrl+S, and `submitSurface` cannot
  // reach its Save button by DOM. Until this was wired, Enter did nothing and
  // navigating away silently discarded every edit. Same pattern as the
  // bulk-assign screens (tcs-assign / gst-assign) — see LAYOUT.md §1.
  const saved = toForm(row);
  const dirty = (Object.keys(form) as FieldKey[]).some((k) => form[k] !== saved[k]);

  useUnsavedGuard(dirty || isPending);

  useRegisterShortcut("save", () => {
    if (perms.canEdit && dirty && !isPending) submit();
  });

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

  // Every field here points at the same list, so it is normalized once for
  // `RecordPicker`. The short name rides in the label because that is how the
  // legacy dropdown read ("DISC — DISCOUNT ALLOWED"), and it is what an operator
  // types to find the head. A deactivated head stays in the list while a field
  // still points at it — dropping it outright would show that field as empty and
  // silently blank the FK on the next save.
  const chosen = new Set(Object.values(form).filter(Boolean) as string[]);
  const headOptions: PickerItem[] = accountHeads
    .filter((h) => !h.inactive || chosen.has(h.id))
    .map((h) => ({
      id: h.id,
      code: h.short_name,
      name: h.short_name ? `${h.short_name} — ${h.name}` : h.name,
    }));

  return (
    // A singleton settings page rather than a record editor, so it declares its
    // own `@container/editor` at the contract's 1180px. It was capped at
    // `max-w-2xl` (672px) — below SectionGrid's 896px two-up threshold — so nine
    // dropdowns could only ever stack in one narrow column.
    <div className="@container/editor mx-auto w-full max-w-[1180px] space-y-3">
      <SectionGrid>
        {FIELD_DEFS.map((group) => (
          <DetailSection key={group.group} label={group.group} cols={12}>
            {/* The Field carries the span only — the picker prints its own
                label, as everywhere else a picker sits inside a Field. */}
            {group.fields.map((field) => (
              <Field key={field.key} size="lg">
                <RecordPicker
                  label={field.label}
                  items={headOptions}
                  value={form[field.key]}
                  onChange={(v) => setField(field.key, v)}
                  disabled={!perms.canEdit}
                />
              </Field>
            ))}
          </DetailSection>
        ))}
      </SectionGrid>

      {perms.canEdit && (
        <div data-focus-region="footer" className="flex justify-end">
          <Button size="md" disabled={!dirty || isPending} onClick={submit}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
