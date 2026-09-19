"use client";

/**
 * Advised Items ▸ Convert to Available — the buyer has confirmed the material,
 * so its details are filled in and the line stops being "To be advised". From
 * that moment its purchase order is no longer blocked.
 *
 * A sub-detail of the order's register page, so AGENTS.md "A sub-detail Sheet's
 * size": `size="sm"`, `alignToPane`, `origin` from the row's button. It WRITES
 * on confirm — one targeted update, `convertAdvisedItem`, never the Material
 * BOM editor's full save — so its footer is Cancel / Convert, not a
 * SubSheetFooter.
 *
 * EVERY WARNING SITS UNDER ITS FIELD (`Field error`): a refusal the action ties
 * to a field is shown there; only a failure no field owns is a toast.
 *
 * MOUNT IT ONLY WHILE OPEN (`{line && <ConvertAdvisedSheet … />}`), so each
 * conversion starts from the line's own values and not the last one's.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { useToast } from "@/components/ui/toast";
import { convertAdvisedItem } from "@/lib/orders/advised/actions";
import type { AdvisedConvertField, AdvisedLine } from "@/lib/orders/advised/types";

export function ConvertAdvisedSheet({
  line,
  colours,
  origin,
  onClose,
}: {
  line: AdvisedLine;
  /** The colours this line's material can take. */
  colours: PickerItem[];
  origin?: SheetOrigin | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [form, setForm] = useState({
    brand: line.brand ?? "",
    artwork_code: line.artwork_code ?? "",
    item_color_id: line.item_color_id,
    size: line.size ?? "",
    specification: line.specification ?? "",
  });
  /** The action's refusal, held against the field it names. */
  const [refusal, setRefusal] = useState<{ field: AdvisedConvertField; message: string } | null>(null);
  const errorOf = (f: AdvisedConvertField) => (refusal && refusal.field === f ? refusal.message : null);
  const set = (patch: Partial<typeof form>) => {
    setForm((x) => ({ ...x, ...patch }));
    // Editing the field that was refused retires its message.
    setRefusal(null);
  };

  function convert() {
    start(async () => {
      const res = await convertAdvisedItem(line.id, {
        brand: form.brand || null,
        artwork_code: form.artwork_code || null,
        item_color_id: form.item_color_id,
        size: form.size || null,
        specification: form.specification || null,
      });
      if (res.ok) {
        success(`${line.item_name ?? "Material"} converted — its purchase order is no longer blocked`);
        onClose();
        router.refresh();
        return;
      }
      if (res.field) setRefusal({ field: res.field, message: res.error });
      else toastError(res.error);
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Convert ${line.item_name ?? "material"} to Available`}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={convert}>
            {isPending ? "Converting…" : "Convert to Available"}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label="Brand" size="full" htmlFor="cv-brand" error={errorOf("brand")}>
          <Input
            id="cv-brand"
            value={form.brand}
            onChange={(e) => set({ brand: e.target.value })}
          />
        </Field>
        <Field label="Artwork Code" size="full" htmlFor="cv-artwork" error={errorOf("artwork_code")}>
          <Input
            id="cv-artwork"
            value={form.artwork_code}
            onChange={(e) => set({ artwork_code: e.target.value })}
          />
        </Field>
        <Field label="Colour" size="full" htmlFor="cv-colour" error={errorOf("item_color_id")}>
          <RecordPicker
            id="cv-colour"
            label="Colour"
            compact
            items={colours}
            value={form.item_color_id}
            onChange={(id) => set({ item_color_id: id })}
          />
        </Field>
        <Field label="Size" size="full" htmlFor="cv-size" error={errorOf("size")}>
          <Input id="cv-size" value={form.size} onChange={(e) => set({ size: e.target.value })} />
        </Field>
        {/* REQUIRED — the one confirmed fact the schema insists on: the PO
            block's own sentence asks for the final specification, so a
            conversion without one would unblock a purchase of a material still
            undescribed (`advisedConversionInput`). */}
        <Field
          label="Specification"
          required
          size="full"
          htmlFor="cv-spec"
          error={errorOf("specification")}
        >
          <Input
            id="cv-spec"
            value={form.specification}
            onChange={(e) => set({ specification: e.target.value })}
          />
        </Field>
      </FieldGrid>
    </Sheet>
  );
}
