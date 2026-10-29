/**
 * Message formatting for Pulse (user 2026-10-29: the Slack-style formatting
 * bar). A message is STILL STORED AS PLAIN TEXT — the bar writes markers into
 * the text and the reader draws them:
 *
 *   **bold**   _italic_   __underline__   ~~strike~~   `code`
 *   [label](https://…)   lines starting "- ", "1. ", "> ", and ``` fences
 *
 * Parsed into a small tree that is rendered as React elements, never as HTML,
 * so nothing a colleague types can inject markup into anyone else's screen —
 * the same guarantee message-body.tsx gave before formatting existed. A link
 * label's URL must be http(s), checked with `new URL`, exactly as bare URLs are.
 *
 * Mention and record tokens (`<@uuid>`, `<rec:kind:uuid>`) pass through as
 * text; the renderer draws them inside whatever span holds them.
 */

import { RECORD_KINDS, bodyPieces } from "./types";

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "b" | "i" | "u" | "s"; children: Inline[] }
  | { t: "link"; label: Inline[]; url: string };

export type Block =
  | { kind: "p"; text: string }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; start: number; items: string[] };

const FENCE = /^\s*```/;
const QUOTE = /^> ?(.*)$/;
const BULLET = /^\s*[-*•] +(.*)$/;
const NUMBERED = /^\s*(\d{1,4})[.)] +(.*)$/;

/** Lines → blocks. An unclosed fence runs to the end, as Slack does. */
export function parseBlocks(body: string | null | undefined): Block[] {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const push = (b: Block) => {
    const last = out[out.length - 1];
    if (b.kind === "p" && last?.kind === "p") last.text += "\n" + b.text;
    else if (b.kind === "quote" && last?.kind === "quote") last.text += "\n" + b.text;
    else if (b.kind === "ul" && last?.kind === "ul") last.items.push(...b.items);
    else if (b.kind === "ol" && last?.kind === "ol") last.items.push(...b.items);
    else out.push(b);
  };
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const rest = line.replace(FENCE, "");
      const code: string[] = [];
      // ```one line``` on a single line
      if (rest.trimEnd().endsWith("```") && rest.trim().length > 3) {
        out.push({ kind: "code", text: rest.trimEnd().slice(0, -3) });
        i += 1;
        continue;
      }
      if (rest.trim()) code.push(rest);
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i += 1; // the closing fence
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = QUOTE.exec(line))) push({ kind: "quote", text: m[1] });
    else if ((m = BULLET.exec(line))) push({ kind: "ul", items: [m[1]] });
    else if ((m = NUMBERED.exec(line))) push({ kind: "ol", start: Number(m[1]), items: [m[2]] });
    else push({ kind: "p", text: line });
    i += 1;
  }
  // Leading / trailing blank paragraph lines are noise in a chat bubble.
  for (const b of out) if (b.kind === "p") b.text = b.text.replace(/^\n+|\n+$/g, "");
  return out.filter((b) => b.kind !== "p" || b.text.length > 0);
}

// Order matters: `code` first (nothing inside it is formatting), then the
// two-character markers before the one-character `_`.
const INLINE_RE =
  /`([^`\n]+)`|\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|__(?=\S)([\s\S]+?)(?<=\S)__|~~(?=\S)([\s\S]+?)(?<=\S)~~|(?<![\p{L}\p{N}_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\p{L}\p{N}_])|\[([^\]\n]+)\]\(([^\s)]+)\)/gu;

function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** One block's text → inline nodes. Depth-limited so a crafted message cannot recurse deep. */
export function parseInline(text: string, depth = 0): Inline[] {
  if (depth > 3 || !text) return text ? [{ t: "text", text }] : [];
  const out: Inline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index ?? 0;
    let node: Inline | null = null;
    if (m[1] !== undefined) node = { t: "code", text: m[1] };
    else if (m[2] !== undefined) node = { t: "b", children: parseInline(m[2], depth + 1) };
    else if (m[3] !== undefined) node = { t: "u", children: parseInline(m[3], depth + 1) };
    else if (m[4] !== undefined) node = { t: "s", children: parseInline(m[4], depth + 1) };
    else if (m[5] !== undefined) node = { t: "i", children: parseInline(m[5], depth + 1) };
    else if (m[6] !== undefined) {
      const url = safeUrl(m[7]);
      // A link to anything but http(s) stays as the text the person typed.
      if (url) node = { t: "link", label: parseInline(m[6], depth + 1), url };
    }
    if (!node) continue;
    if (i > at) out.push({ t: "text", text: text.slice(at, i) });
    out.push(node);
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ t: "text", text: text.slice(at) });
  return out;
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.t === "text" || n.t === "code" ? n.text : n.t === "link" ? inlineText(n.label) : inlineText(n.children)))
    .join("");
}

/**
 * The message with its markers taken out — for one-line previews (the Pulse
 * list), where `**` and ``` would be noise. Tokens are left for the caller.
 */
export function plainText(body: string | null | undefined): string {
  return parseBlocks(body)
    .map((b) =>
      b.kind === "code"
        ? b.text
        : b.kind === "ul" || b.kind === "ol"
          ? b.items.map((x) => inlineText(parseInline(x))).join(" · ")
          : inlineText(parseInline(b.text)),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A one-line preview for the Pulse list: tokens drawn as "@Name" and
 * "[PO]", then the markers taken out. `names` resolves mention ids; an id it
 * does not know reads "@someone", never a uuid (see message-body.tsx).
 */
export function previewText(body: string | null | undefined, names: Map<string, string | null>): string {
  const flat = bodyPieces(body)
    .map((p) =>
      "text" in p ? p.text : "mention" in p ? `@${names.get(p.mention) ?? "someone"}` : `[${RECORD_KINDS[p.record.kind].short}]`,
    )
    .join("");
  return plainText(flat);
}

/** The ids a body mentions — so a caller can resolve them in one call. */
export function mentionIds(body: string | null | undefined): string[] {
  return bodyPieces(body).flatMap((p) => ("mention" in p ? [p.mention] : []));
}
