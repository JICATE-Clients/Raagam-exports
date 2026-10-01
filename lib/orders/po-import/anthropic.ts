import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { poReadRequest, type PoReadInput } from "./request";
import { poDraftSchema, type PoDraft } from "./types";

/**
 * The one call to Claude that reads a buyer PO into a draft
 * (doc/order/digitalisation-plan.md §2). The request body is `request.ts`.
 *
 * Same stance as `lib/email/send.ts`: `server-only`, configured-or-not checked
 * up front, NEVER THROWS — a discriminated result the caller turns into a
 * sentence on screen. An unset key is a normal state of a deployment, not an
 * error: the screen says "PO reading is not set up" and the merchandiser types
 * the order by hand exactly as before.
 */

export type { PoReadInput };

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export type PoReadResult =
  | { ok: true; draft: PoDraft; model: string }
  | { ok: false; reason: "not_configured" | "refused" | "unreadable" | "failed"; detail: string };

export async function readBuyerPo(input: PoReadInput): Promise<PoReadResult> {
  if (!anthropicConfigured()) {
    return { ok: false, reason: "not_configured", detail: "ANTHROPIC_API_KEY is not set on this deployment." };
  }
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
    // A long PDF can take a while to read; the route allows 120 s.
    timeout: 110_000,
    maxRetries: 1,
  });
  try {
    const res = await client.beta.messages.parse(poReadRequest(input));
    // The whole fallback chain declined: a refusal is a sentence, not an exception.
    if (res.stop_reason === "refusal") {
      return { ok: false, reason: "refused", detail: "The document could not be read (the request was declined)." };
    }
    if (res.stop_reason === "max_tokens") {
      return { ok: false, reason: "unreadable", detail: "The PO is too long to read in one go. Split it and upload each part." };
    }
    const checked = res.parsed_output ? poDraftSchema.safeParse(res.parsed_output) : null;
    if (!checked?.success) {
      return { ok: false, reason: "unreadable", detail: "The reader's answer did not match the expected shape. Try again." };
    }
    return { ok: true, draft: checked.data, model: res.model };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, reason: "failed", detail: "The ANTHROPIC_API_KEY on this deployment was refused." };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: "failed", detail: "The PO reader is busy. Try again in a minute." };
    }
    if (error instanceof Anthropic.BadRequestError) {
      return { ok: false, reason: "unreadable", detail: `The file could not be read: ${error.message}` };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: "failed", detail: `The PO reader answered ${error.status ?? "an error"}: ${error.message}` };
    }
    return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}
