import type { AppUser } from "@/lib/auth/types";
import { today } from "@/lib/calendar";
import { getCalendar } from "@/lib/my-calendar/data";
import { NoolGreeter, type NoolTask } from "@/components/dashboard/nool-greeter";

const DAY_MS = 86_400_000;
/** Whole days from `a` to `b`, both `YYYY-MM-DD` (parsed as UTC, so no DST drift). */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** "Thursday, 29 October 2026", in the factory's timezone like the rest of the page. */
function dateLabel(): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

/**
 * The welcome card's data: the signed-in person's OWN work for today, plus
 * anything of theirs still open from before (user 2026-10-29: "Mine" only —
 * the card is personal; Team stays on My Calendar).
 *
 * Read through `getCalendar`, the loader My Calendar and the calendar panel
 * already use, so all three agree on what is due. When that loader falls back
 * to Team because the login has no staff record, the card does NOT show the
 * team's work as if it were the person's: Nool says why instead.
 */
export async function WelcomeSection({ user }: { user: AppUser }) {
  const t = today();
  const data = await getCalendar(user, { scope: "mine", from: t, to: t, withOverdue: true });

  const own = data.available && !data.autoTeam;
  const tasks: NoolTask[] = own
    ? data.events
        .filter((e) => e.date === t || (!e.done && e.date < t))
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          title: e.title,
          reNo: e.reNo,
          date: e.date,
          daysLate: !e.done && e.date < t ? daysBetween(e.date, t) : 0,
          done: e.done,
          href: e.href,
        }))
    : [];

  const note = !data.available
    ? (data.reason ?? undefined)
    : data.autoTeam
      ? "Your login isn't linked to a staff record yet, so I can't see your own tasks."
      : tasks.length === 0 && data.errors.length > 0
        ? "I couldn't load your tasks just now. My Calendar has the full list."
        : undefined;

  return (
    <NoolGreeter
      name={user.fullName?.split(" ")[0] ?? "there"}
      dateLabel={dateLabel()}
      today={t}
      tasks={tasks}
      note={note}
      calendarHref={`/my-calendar?cv=day&cd=${t}`}
    />
  );
}

/** Streams in while the tasks load: the greeting at once, rows to follow. */
export function WelcomeSkeleton({ name }: { name: string }) {
  return (
    <section aria-label="Your day" aria-busy className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3.5">
        <div className="h-[86px] w-[72px] flex-none animate-pulse rounded-xl bg-surface-muted sm:h-[108px] sm:w-[90px]" />
        <div className="space-y-2">
          <p className="text-[1.4rem] font-bold leading-tight text-heading">
            Vanakkam, <span className="text-brand-blue">{name}</span>
          </p>
          <div className="h-3 w-56 animate-pulse rounded bg-surface-muted" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
    </section>
  );
}
