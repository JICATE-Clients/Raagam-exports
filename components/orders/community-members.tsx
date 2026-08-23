import { Users } from "lucide-react";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate } from "@/lib/format";
import {
  CHANNEL_ROLE_LABELS,
  type ChannelMember,
  type ChannelRole,
} from "@/lib/orders/community/types";

/**
 * Who is in the channel (doc/file.md §4's "Role-Based Auto-Assignment").
 *
 * ## `join_reason` IS SHOWN, AND THAT IS THE POINT OF THE COLUMN
 *
 * Membership here is MATERIALISED from a rule that re-runs (0458). Without a
 * visible reason the list is a set of names an operator cannot reason about:
 * they cannot tell whether removing someone will stick, whether a missing person
 * is an oversight or a permission they have not been granted, or why somebody
 * they do not recognise can read the order's file. The reason turns each row
 * into an explanation.
 *
 * A server component: the names arrive already resolved through
 * `creator_names()`, because a PostgREST embed on `profiles` would render every
 * name but the reader's own as blank (`profiles_read_own`, 0001).
 */

const REASON_LABELS: Record<ChannelMember["join_reason"], string> = {
  order_owner: "This order's merchandiser",
  rule: "Auto-joined by role",
  manual: "Added by hand",
};

export function CommunityMembers({ members }: { members: ChannelMember[] }) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Users className="h-4 w-4 text-muted-foreground" />
        Members ({members.length})
      </h3>

      {members.length === 0 ? (
        // Not "no members": a channel always has some, so an empty list means
        // the reader cannot see them — a different fact, and saying the wrong
        // one sends them looking for a bug in the auto-join.
        <p className="text-xs text-muted-foreground">
          You cannot see this channel&rsquo;s members.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li key={m.id} className="rounded-md border border-border px-2 py-1.5">
              <Truncated
                text={m.full_name ?? "Unknown user"}
                className="text-sm font-medium text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                {m.channel_role
                  ? CHANNEL_ROLE_LABELS[m.channel_role as ChannelRole]
                  : REASON_LABELS[m.join_reason]}
                {m.channel_role ? ` · ${REASON_LABELS[m.join_reason]}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                Joined {fmtDate(m.added_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
