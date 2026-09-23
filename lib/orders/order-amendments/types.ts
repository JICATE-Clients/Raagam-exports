import { z } from "zod";
import { capsName } from "@/lib/validation/formats";
import {
  AMENDMENT_MODULES,
  AMENDMENT_ORIGINS,
  ORDER_CHANGE_KINDS,
  type AmendmentModule,
  type OrderChangeKind,
} from "@/lib/orders/amendments/amendment-entry";

/**
 * The door's input (doc/order/amenment update.md §2). Client-safe — the page
 * parses it before the round trip and the action parses it again.
 *
 * THE MODULES ARE THE CHOICE (0619): Order Entry · Material BOM · Fabric BOM ·
 * Order Budget. Order Entry is picked with its detail — what changes on the
 * order — and at least one is required when it is ticked; the action turns the
 * pair into the kinds the RPC freezes (`kindsForSelection`).
 *
 * The REMARKS are mandatory and capitalised in the schema (`capsName`) — the
 * write-side half of the CAPITALS rule lives in Zod, never only in the action;
 * the RPC refuses a blank too, so the two agree.
 */
export const raiseAmendmentInput = z
  .object({
    order_id: z.string().uuid("Pick the order to revise"),
    origin: z.enum(AMENDMENT_ORIGINS.map((o) => o.value) as [string, ...string[]], {
      message: "Say who asked for the change — By Customer or By Us",
    }),
    modules: z
      .array(z.enum(AMENDMENT_MODULES.map((m) => m.key) as [AmendmentModule, ...AmendmentModule[]]))
      .min(1, "Pick at least one module to revise"),
    order_kinds: z
      .array(z.enum(ORDER_CHANGE_KINDS as unknown as [OrderChangeKind, ...OrderChangeKind[]]))
      .default([]),
    remarks: capsName("Say why this order is being revised"),
  })
  .refine((v) => !v.modules.includes("order_entry") || v.order_kinds.length > 0, {
    message: "Say what changes on the order — PO Qty, Delivery Date, FOB Price or Color Combos",
    path: ["order_kinds"],
  });
export type RaiseAmendmentInput = z.input<typeof raiseAmendmentInput>;
