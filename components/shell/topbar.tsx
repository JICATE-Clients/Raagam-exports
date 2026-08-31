"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bug, ChevronDown, LogOut, Search } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { setCurrentLocation } from "@/lib/auth/location-actions";
import { useAppUser } from "@/lib/auth/permission-context";
import { useLocationState } from "@/lib/auth/location-context";
import { confirmDiscard } from "@/lib/reload-guard";
import { useSearch } from "@/components/search/search-provider";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Select } from "@/components/ui/select";
import { bugPortalUrl, bugReporterConfigured } from "@/lib/bug-reporter";
import { cn } from "@/lib/utils";

export function Topbar() {
  const user = useAppUser();
  const search = useSearch();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, startSwitch] = useTransition();

  /**
   * THE UNIT NOW COMES FROM THE SESSION, NOT FROM LOCAL STATE.
   *
   * This `<Select>` shipped from the first build with its value in a
   * `useState` that nothing else read: changing it changed nothing, anywhere,
   * and reported nothing. The list was also every active location in the
   * database rather than the ones this operator may act in.
   *
   * Both halves now come from `LocationProvider`, seeded server-side by
   * `getCurrentLocation()` — so the dropdown shows what the server will
   * actually use, and cannot drift from it.
   */
  const { current, allowed, source } = useLocationState();

  const [error, setError] = useState<string | null>(null);

  function onSwitchUnit(nextId: string) {
    if (!nextId || nextId === current?.id) return;

    /**
     * A SWITCH REFRESHES THE TREE, SO IT MUST ASK FIRST.
     *
     * Per AGENTS.md's standing auto-reload guard, the only thing between a
     * re-render and a half-typed order is `lib/reload-guard.ts`. Changing unit
     * re-runs every Server Component, which throws away in-progress edits
     * exactly as a deploy would — and worse than a deploy, because the operator
     * asked for something small and lost something large.
     *
     * `confirmDiscard()` is the same question Escape asks before abandoning an
     * editor, so the wording an operator sees here is the wording they already
     * know. It returns true immediately when nothing is dirty, so the common
     * case is uninterrupted.
     */
    if (!confirmDiscard()) return;

    setError(null);
    startSwitch(async () => {
      const result = await setCurrentLocation(nextId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // `profiles.current_location_id` is written and the layout path
      // revalidated; this re-renders the current route against the new unit.
      // Every RLS policy narrows to that column, so the data changes with it.
      router.refresh();
    });
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
      {/* Location switcher (two GST entities) */}
      {/* `min-w-0`: without it this group is sized by the Select's fixed width
          and cannot give a pixel back, which is half of why the bar had a hard
          378px floor (see the Select's own note). */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Location
        </span>
        {/* Border, background, radius and focus ring all come from the control
            itself — repeating them here drew a SECOND box around it. `h-8`
            matches the Search trigger opposite; `md:text-xs` has to be spelled
            out because the control declares `text-base md:text-sm`, and a bare
            `text-xs` only wins below the md breakpoint.

            `w-28` UNTIL `sm`, AND THAT IS THE WHOLE MOBILE FIX. Every element
            in this bar was a fixed width with no shrink allowance: 176px here,
            plus 170px of search + theme + bell + avatar opposite, plus 32px of
            `px-4` — a 378px floor in a bar that has to fit a 360px Android and
            a 320px SE. Nothing could give, so `justify-between` pushed the
            overflow off the trailing edge and the shell's `overflow-hidden`
            (app/(app)/layout.tsx) clipped it: the avatar was sliced in half and
            there was no scrollbar to say anything was missing.

            176 → 112 drops the floor to 314px, which clears every phone. The
            trade is that a long location name clips inside the control below
            640px — a native `<select>` has no ellipsis — and that is the right
            way round: the name is re-read from the open list, while a
            half-rendered avatar is a control the operator cannot press. Above
            `sm` it is 176px exactly as before. */}
        <Select
          value={current?.id ?? ""}
          onChange={(e) => onSwitchUnit(e.target.value)}
          disabled={switching || allowed.length === 0}
          aria-label="Location"
          aria-describedby={error ? "location-switch-error" : undefined}
          className="h-8 w-28 text-xs font-medium sm:w-44 md:text-xs"
        >
          {/* No unit resolved. Shown rather than auto-picking `allowed[0]`,
              which is how the old code answered "which company's books?" by
              array order. An empty value is a prompt; a wrong one is silent. */}
          {!current && (
            <option value="">
              {allowed.length === 0 ? "No unit assigned" : "Select unit…"}
            </option>
          )}
          {allowed.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>

        {/* THE OPERATOR DID NOT CHOOSE THIS UNIT, SO IT IS SAID OUT LOUD.
            `"default"` is their home unit; `"fallback"` is the house default
            (Head Office), which they land on when their profile names no unit
            at all. Neither is a silent move: an operator who does not notice
            which GST entity they are in posts documents to the wrong company's
            books, and it looks entirely ordinary. */}
        {(source === "default" || source === "fallback") && (
          <span
            title={
              source === "fallback"
                ? "You have not chosen a unit, so you are working in the default one. Pick another from this box if that is not right."
                : "Working in your home unit. Your previous unit was never set, or is no longer available to you."
            }
            className="hidden text-xs text-warning lg:inline"
          >
            default
          </span>
        )}

        {/* `text-danger`, NOT `text-destructive` — this repo defines `--danger`
            and has no `--destructive`, so the shadcn-habitual name compiles to
            nothing and would render this message invisible. */}
        {error && (
          <span
            id="location-switch-error"
            role="alert"
            className="hidden text-xs text-danger lg:inline"
          >
            {error}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {/* Search Everywhere trigger */}
        <button
          type="button"
          onClick={search.open}
          aria-label="Search everywhere"
          className={cn(
            "flex items-center gap-2 rounded-md border border-border text-muted-foreground",
            "h-8 px-2 hover:bg-surface-muted",
            "md:w-56 md:justify-start md:px-2.5",
          )}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden flex-1 text-left text-xs md:inline">
            Search…
          </span>
          <kbd className="hidden shrink-0 rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] md:inline">
            ⌘K
          </kbd>
        </button>

        <ThemeToggle />

        <NotificationsBell />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {(user.fullName ?? user.email ?? "?").charAt(0).toUpperCase()}
            </span>
            <span className="hidden max-w-[10rem] truncate sm:inline">
              {user.fullName ?? user.email}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-surface p-1 shadow-lg">
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-medium">
                    {user.fullName ?? "—"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email ?? user.phone}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {user.isSuperAdmin
                      ? "Super Admin"
                      : user.roleNames.join(", ") || "No roles assigned"}
                  </p>
                </div>
                {/* WHAT HAPPENED TO THE BUG I REPORTED. The widget takes
                    reports and says nothing back; this is the vendor's
                    reporter-facing portal, keyed on the same email the SDK
                    already sends as `userContext.email`.

                    Gated on `bugReporterConfigured` so it cannot outlive the
                    widget — offering a portal for an app the platform has never
                    been told about lands the operator on someone else's 404 —
                    and on the email itself, which is the portal's only key.

                    `rel="noopener"` because it is an external domain: without
                    it the opened tab can reach back through `window.opener`. */}
                {bugReporterConfigured && user.email && (
                  <a
                    href={bugPortalUrl(user.email)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-3 py-2 text-sm",
                      "text-foreground hover:bg-surface-muted",
                    )}
                  >
                    <Bug className="h-4 w-4" /> My bug reports
                  </a>
                )}
                <form action={signOut}>
                  <button
                    type="submit"
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-3 py-2 text-sm",
                      "text-foreground hover:bg-surface-muted",
                    )}
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
