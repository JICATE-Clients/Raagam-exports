import { z } from "zod";
import { capsName } from "@/lib/validation/formats";
import {
  AMENDMENT_ENTRY_TYPE_VALUES,
  AMENDMENT_ORIGINS,
  type AmendmentEntryType,
} from "@/lib/orders/amendments/amendment-entry";

/**
 * The door's input (doc/order/amedment.md §2). Client-safe — the sheet parses
 * it before the round trip and the action parses it again.
 *
 * The REMARKS are mandatory and capitalised in the schema (`capsName`) — the
 * write-side half of the CAPITALS rule lives in Zod, never only in the action;
 * the RPC refuses a blank too, so the two agree.
 */
export const raiseAmendmentInput = z.object({
  order_id: z.string().uuid("Pick the order to amend"),
  origin: z.enum(AMENDMENT_ORIGINS.map((o) => o.value) as [string, ...string[]], {
    message: "Say who asked for the change — By Customer or By Us",
  }),
  types: z
    .array(z.enum(AMENDMENT_ENTRY_TYPE_VALUES as [AmendmentEntryType, ...AmendmentEntryType[]]))
    .min(1, "Pick at least one Change Category"),
  remarks: capsName("Say why this order is being amended"),
});
export type RaiseAmendmentInput = z.input<typeof raiseAmendmentInput>;
