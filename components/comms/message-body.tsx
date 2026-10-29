import type { ReactNode } from "react";
import { fmtTime } from "@/lib/format";
import { parseBlocks, parseInline, type Inline } from "@/lib/comms/format";
import { bodyPieces, linkPieces } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { RecordChip } from "./record-chip";

/**
 * A message's text with its `<@uuid>` mentions drawn as @Name chips and its
 * `<rec:kind:uuid>` links drawn as record chips (resolved for the viewer —
 * see record-chip.tsx).
 *
 * Names come from the conversation's own member list (`names`), never from the
 * token — the body stores the id so a rename never rewrites history. An id the
 * map does not know (a member since removed, a token typed by hand) renders as
 * "@someone": a raw uuid printed at the operator is the failure `creatorName()`
 * exists to prevent (AGENTS.md "Created Date / Created User").
 *
 * FORMATTING (user 2026-10-29): bold, italic, underline, strike, code, links,
 * lists, quotes and code blocks, parsed by lib/comms/format.ts into a tree and
 * drawn as React elements — still NO HTML from the message, so nothing a
 * colleague types can inject markup into anyone else's screen. http(s) URLs
 * become links (`linkPieces`, which refuses every other scheme), opened in a
 * new tab with no opener and no referrer, so a link cannot reach back into
 * the ERP tab.
 */
export function MessageBody({
  body,
  names,
  meId,
  className,
  recordLinks = true,
}: {
  body: string | null;
  names: Map<string, string | null>;
  meId: string;
  className?: string;
  /** False when the whole message is already a link (Saved, Search). */
  recordLinks?: boolean;
}) {
  const ctx: Ctx = { names, meId, recordLinks, links: true };
  return (
    <div className={cn("space-y-1 break-words text-sm leading-relaxed text-foreground", className)}>
      {parseBlocks(body).map((b, i) => {
        switch (b.kind) {
          case "code":
            return (
              <pre key={i} className="overflow-x-auto whitespace-pre rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-xs">
                {b.text}
              </pre>
            );
          case "quote":
            return (
              <blockquote key={i} className="whitespace-pre-wrap border-l-2 border-border pl-3 text-muted-foreground">
                {inline(parseInline(b.text), ctx)}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-0.5 pl-5">
                {b.items.map((it, j) => (
                  <li key={j} className="whitespace-pre-wrap">{inline(parseInline(it), ctx)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} start={b.start} className="list-decimal space-y-0.5 pl-6">
                {b.items.map((it, j) => (
                  <li key={j} className="whitespace-pre-wrap">{inline(parseInline(it), ctx)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i} className="whitespace-pre-wrap">
                {inline(parseInline(b.text), ctx)}
              </p>
            );
        }
      })}
    </div>
  );
}

type Ctx = { names: Map<string, string | null>; meId: string; recordLinks: boolean; links: boolean };

function inline(nodes: Inline[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "code":
        return (
          <code key={i} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em] text-danger">
            {n.text}
          </code>
        );
      case "b":
        return <strong key={i} className="font-semibold">{inline(n.children, ctx)}</strong>;
      case "i":
        return <em key={i}>{inline(n.children, ctx)}</em>;
      case "u":
        return <u key={i} className="underline-offset-2">{inline(n.children, ctx)}</u>;
      case "s":
        return <s key={i}>{inline(n.children, ctx)}</s>;
      case "link":
        // `links` is false only INSIDE a link's own label, where a second <a>
        // would be invalid HTML.
        return ctx.links ? (
          <a
            key={i}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={n.url}
            className="text-primary underline underline-offset-2 hover:text-primary-hover"
          >
            {inline(n.label, { ...ctx, links: false })}
          </a>
        ) : (
          <span key={i} className="text-primary">{inline(n.label, ctx)}</span>
        );
      default:
        return <span key={i}>{tokens(n.text, ctx)}</span>;
    }
  });
}

/** Plain text → mention chips, record chips and bare http(s) links. */
function tokens(text: string, ctx: Ctx): ReactNode[] {
  return bodyPieces(text).map((p, i) =>
    "text" in p ? (
      <span key={i}>
        {linkPieces(p.text).map((l, j) =>
          "url" in l && ctx.links ? (
            <a
              key={j}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="break-all text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              {l.url}
            </a>
          ) : (
            <span key={j}>{"url" in l ? l.url : l.text}</span>
          ),
        )}
      </span>
    ) : "record" in p ? (
      <RecordChip key={i} kind={p.record.kind} id={p.record.id} link={ctx.recordLinks} />
    ) : (
      <span
        key={i}
        className={cn(
          "rounded px-0.5 font-semibold",
          p.mention === ctx.meId ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary",
        )}
      >
        @{ctx.names.get(p.mention) ?? "someone"}
      </span>
    ),
  );
}

/** "3:05 pm" — the app's clock (lib/format.ts), from a timestamp. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return fmtTime(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
}

/** Calendar-day key in the viewer's time zone, for day separators. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Two-letter initials for an avatar disc. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}
