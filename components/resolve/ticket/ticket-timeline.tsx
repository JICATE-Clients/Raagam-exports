import {
  Ban,
  Check,
  CircleAlert,
  CirclePlay,
  CircleSlash,
  Hand,
  MessageSquare,
  Pencil,
  Repeat,
  ShieldCheck,
  Star,
  TriangleAlert,
  Undo2,
  UserCheck,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { StatusPill } from "@/components/ui/status-pill";
import { ticketStatusTone } from "@/lib/resolve/sla";
import { STATUS_LABEL, type TicketActivity, type TicketStatus } from "@/lib/resolve/types";

/* The words and glyph for each activity action the RPCs write. An action not
   listed reads as its own word, so a new RPC never renders blank. */
const ACTION: Record<string, { verb: string; icon: LucideIcon }> = {
  created: { verb: "Reported", icon: CircleAlert },
  routed: { verb: "Routed", icon: Repeat },
  joined: { verb: "Joined", icon: UserPlus },
  claimed: { verb: "Claimed", icon: Hand },
  assigned: { verb: "Assigned", icon: UserCheck },
  started: { verb: "Work started", icon: CirclePlay },
  blocked: { verb: "Blocked", icon: CircleSlash },
  unblocked: { verb: "Work resumed", icon: CirclePlay },
  fixed: { verb: "Marked fixed", icon: Wrench },
  spot_check_passed: { verb: "Spot check passed", icon: ShieldCheck },
  spot_check_failed: { verb: "Spot check failed", icon: Undo2 },
  spot_check: { verb: "Spot checked", icon: ShieldCheck },
  owner_confirmed: { verb: "Closed by the owner", icon: Check },
  closed: { verb: "Closed", icon: Check },
  disputed: { verb: "Reported not fixed", icon: TriangleAlert },
  cancelled: { verb: "Cancelled", icon: Ban },
  withdrawn: { verb: "Withdrawn", icon: Undo2 },
  edited: { verb: "Report edited", icon: Pencil },
  reclassified: { verb: "Reclassified", icon: Repeat },
  note: { verb: "Note added", icon: MessageSquare },
  rated: { verb: "Rated", icon: Star },
  escalated: { verb: "Escalated", icon: TriangleAlert },
  resolved: { verb: "Resolved", icon: Check },
};

function wordsFor(action: string) {
  return ACTION[action] ?? { verb: action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), icon: CircleAlert };
}

/**
 * The ticket's history, oldest first. A server component: it renders the
 * append-only `rh_ticket_activity` rows and decides nothing. Same record
 * boundary as `ApprovalTimeline` (operator rule 4a: a 2px rule between records,
 * never a box each).
 */
export function TicketTimeline({ rows }: { rows: TicketActivity[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>;
  }
  return (
    <ol>
      {rows.map((r, i) => {
        const { verb, icon: Icon } = wordsFor(r.action);
        const to = r.to_status as TicketStatus | null;
        return (
          <li key={r.id} className={i > 0 ? "flex gap-3 border-t-2 border-border-strong py-3" : "flex gap-3 py-3"}>
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-muted-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-foreground">{verb}</span>
                {to && r.from_status !== to && STATUS_LABEL[to] ? (
                  <StatusPill tone={ticketStatusTone(to)}>{STATUS_LABEL[to]}</StatusPill>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {r.actor_name ? `${r.actor_name} · ` : ""}
                {fmtDateTime(r.created_at)}
              </p>
              {r.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{r.note}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
