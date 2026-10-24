import { EyeOff, ShieldCheck, Users } from "lucide-react";

/**
 * WHO WILL SEE THIS — said in plain words, and it changes with the toggles.
 *
 * The complainant decides what to write based on who will read it, so this is
 * the most important text on the form. Every sentence states what the server
 * actually does (plan §10.2–§10.4); none of it is a promise the code does not
 * keep:
 *
 * - sensitive / about-a-superior → named handler and committee only, never
 *   triage, never anyone in the reporter's management chain;
 * - anonymous → no name stored anywhere, so the ONLY way to follow it is the
 *   one-time tracking link (lost link = no way back, by design).
 */
export function WhoSeesIt({
  sensitive,
  anonymous,
  aboutSuperior,
  responseHours,
}: {
  sensitive: boolean;
  anonymous: boolean;
  aboutSuperior: boolean;
  /** The category's response window, when known. */
  responseHours: number | null;
}) {
  const restricted = sensitive || aboutSuperior;
  return (
    <div role="note" aria-live="polite" className="space-y-2 rounded-lg border border-border bg-surface-muted/50 p-3 text-sm">
      <p className="flex items-start gap-2 text-foreground">
        {restricted ? (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        ) : (
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        )}
        <span>
          {aboutSuperior
            ? "Because it is about your superior, it goes to an independent handler outside your reporting line. Your manager and anyone above them will not see it."
            : sensitive
              ? "This is a sensitive category: only the named handler and the complaints committee for it can read it. Managers and triage staff cannot."
              : "The handler for this category and your unit's Resolve Hub managers can read it."}
          {responseHours
            ? ` Someone must respond within ${responseHours >= 24 && responseHours % 24 === 0 ? `${responseHours / 24} day${responseHours === 24 ? "" : "s"}` : `${responseHours} hours`}, or it is escalated.`
            : ""}
        </span>
      </p>
      <p className="flex items-start gap-2 text-foreground">
        <EyeOff className={anonymous ? "mt-0.5 h-4 w-4 shrink-0 text-success" : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"} aria-hidden />
        <span>
          {anonymous
            ? "Sent anonymously: we will not store who you are, so the handler cannot see your name and cannot contact you. You will get a private tracking link once — it is the only way to follow this complaint, so keep it safe."
            : "Sent with your name. The handler can see who you are and reply to you, and you can follow it under My Complaints."}
        </span>
      </p>
    </div>
  );
}
