import { fmtTime } from "@/lib/format";
import { bodyPieces } from "@/lib/comms/types";
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
 * Plain text only — no HTML, no markdown — so nothing a colleague types can
 * inject markup into anyone else's screen.
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
  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground", className)}>
      {bodyPieces(body).map((p, i) =>
        "text" in p ? (
          <span key={i}>{p.text}</span>
        ) : "record" in p ? (
          <RecordChip key={i} kind={p.record.kind} id={p.record.id} link={recordLinks} />
        ) : (
          <span
            key={i}
            className={cn(
              "rounded px-0.5 font-semibold",
              p.mention === meId ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary",
            )}
          >
            @{names.get(p.mention) ?? "someone"}
          </span>
        ),
      )}
    </p>
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
