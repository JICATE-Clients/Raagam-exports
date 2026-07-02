"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  colorCardInput,
  colorRowInput,
  COLOR_CARD_STATUSES,
  type ColorCardInput,
  type ColorRowInput,
  type ColorCardStatus,
} from "./types";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; cardId: string } | { ok: false; error: string };

const LIST_PATH = "/orders/color-cards";

// ---------- create colour card (+ initial colours) ----------

export async function createColorCard(
  payload: ColorCardInput,
): Promise<CreateResult> {
  if (!(await can("orders", "create"))) {
    throw new Error("Forbidden");
  }

  const parsed = colorCardInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { colors, ...card } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("color_cards")
    .insert(card)
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create colour card" };
  }

  if (colors.length > 0) {
    const { error: cErr } = await supabase.from("color_card_colors").insert(
      colors.map((c, i) => ({
        ...c,
        color_card_id: data.id,
        sort_order: c.sort_order || (i + 1) * 10,
      })),
    );
    if (cErr) {
      // card created; log colour insert failure but don't fail the whole op
      console.error("color_card_colors insert error:", cErr.message);
    }
  }

  await writeAudit({
    action: "color_card.created",
    entityType: "color_card",
    entityId: data.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, cardId: data.id };
}

// ---------- add a colour to an existing card ----------

export async function addColorCardColor(
  cardId: string,
  data: ColorRowInput,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }

  const parsed = colorRowInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("color_card_colors")
    .insert({ ...parsed.data, color_card_id: cardId });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${cardId}`);
  return { ok: true };
}

// ---------- remove a colour ----------

export async function deleteColorCardColor(
  colorId: string,
  cardId: string,
): Promise<ActionResult> {
  if (!(await can("orders", "delete"))) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("color_card_colors")
    .delete()
    .eq("id", colorId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${cardId}`);
  return { ok: true };
}

// ---------- archive / restore a card ----------

export async function setColorCardStatus(
  cardId: string,
  status: ColorCardStatus,
): Promise<ActionResult> {
  if (!(await can("orders", "edit"))) {
    throw new Error("Forbidden");
  }
  if (!COLOR_CARD_STATUSES.includes(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("color_cards")
    .update({ status })
    .eq("id", cardId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`${LIST_PATH}/${cardId}`);
  revalidatePath(LIST_PATH);
  return { ok: true };
}
