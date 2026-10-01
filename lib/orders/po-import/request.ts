import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { poDraftSchema } from "./types";

/**
 * The request body for reading a buyer PO — split out of `anthropic.ts`
 * (which is `server-only`) so `scripts/check-po-import-match.mts` can assert
 * its shape without an API key or a server runtime.
 */

export const PO_READER_MODEL = "claude-opus-5-5";

export type PoReadInput =
  | { kind: "pdf"; base64: string }
  | { kind: "image"; base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }
  | { kind: "text"; text: string; fileName: string };

const SYSTEM = [
  "You read garment buyers' purchase orders for an apparel exporter and return their contents as data.",
  "Copy values exactly as the document states them; never invent a value that is not on the document. Use null for anything absent or unreadable.",
  "Dates: return YYYY-MM-DD. Convert printed dates using the document's own convention; if a date is ambiguous (for example 03/04/2026 with no other clue), still convert it but list its path in `uncertain`.",
  "Currency: return the ISO 4217 code when the document makes it clear (a $ on a US buyer's PO is USD).",
  "Lines: one entry per style + colour combination. `sizes` lists every size column with its ordered quantity in pieces; omit sizes with no quantity. If quantities are given in packs or cartons, convert to pieces only when the pieces per pack is printed, otherwise give the printed figure and list the path in `uncertain`.",
  "`stated_total_qty` and `stated_total_value` are the totals PRINTED on the document — never your own sums. Null when not printed.",
  "`uncertain` lists the paths you are not sure of, like \"header.po_date\", \"lines.2.colour\", \"lines.0.sizes\". `notes` mentions anything a reviewer should know (an unreadable page, a table you did not use).",
].join("\n");

const INSTRUCTION =
  "Read this buyer purchase order and return the header, the order lines with size-wise quantities and unit prices, and the printed totals.";

function contentOf(input: PoReadInput): Anthropic.Beta.BetaContentBlockParam[] {
  switch (input.kind) {
    case "pdf":
      return [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } },
        { type: "text", text: INSTRUCTION },
      ];
    case "image":
      return [
        { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } },
        { type: "text", text: INSTRUCTION },
      ];
    case "text":
      return [
        {
          type: "text",
          text: `${INSTRUCTION}\n\nThe PO is a spreadsheet ("${input.fileName}"), given below as comma-separated rows, one sheet after another.\n\n${input.text}`,
        },
      ];
  }
}

/**
 * Per the claude-api skill: the current default model; structured outputs via
 * `output_config.format` (validated against the same Zod schema the rest of
 * the feature reads); refusal fallbacks in their `"default"` form, whose beta
 * header is `server-side-fallback-2026-07-01`; non-streaming at 16k tokens.
 */
export function poReadRequest(input: PoReadInput) {
  return {
    model: PO_READER_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    output_config: { effort: "medium" as const, format: betaZodOutputFormat(poDraftSchema) },
    system: SYSTEM,
    messages: [{ role: "user" as const, content: contentOf(input) }],
  };
}
