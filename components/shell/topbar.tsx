"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bug, Check, ChevronDown, ChevronRight, LogOut, MapPin, Monitor, Moon, Search, Sun, Type, UserRound } from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { setCurrentLocation } from "@/lib/auth/location-actions";
import { setRolePreview } from "@/lib/auth/role-simulation-actions";
import type { PreviewableRole } from "@/lib/auth/role-simulation";
import { useAppUser } from "@/lib/auth/permission-context";
import { useLocationState } from "@/lib/auth/location-context";
import { confirmDiscard } from "@/lib/reload-guard";
import { useSearch } from "@/components/search/search-provider";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { useTheme } from "@/components/shell/theme-provider";
import { useAppearanceItems } from "@/components/shell/appearance-menu";
import type { Theme } from "@/lib/theme";
import { SEG_IDLE, SEG_ITEM, SEG_LIT, SEG_TRACK } from "@/components/ui/segmented";
import { InstallMenuItem } from "@/components/pwa/install-menu-item";
import { Select } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { bugPortalUrl, bugReporterConfigured } from "@/lib/bug-reporter";
import { cn } from "@/lib/utils";

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

/** Order-independent set equality, for "has the pending pick actually changed". */
function sameRoleSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((id) => s.has(id));
}

/**
 * THE ONE SIZE EVERY CONTROL IN THE TOP BAR TAKES (operator, 2026-09-15:
 * "Make the 'Location' dropdown, the '1 selected' dropdown, and the 'Search'
 * input field ... strictly uniform in size and styling ... the exact same
 * height, padding, text size, and border classes").
 *
 * Three controls from three primitives — a native `<Select>`, a `MultiSelect`
 * trigger and a plain `<button>` — each of which carries its own height and
 * text size (`h-9 ... text-base md:text-sm`), so "the same" has to be said
 * once and merged last on all three, or they drift the way they did: h-9
 * beside h-8, text-sm beside text-xs, px-2 beside px-2.5. Stated as classes
 * the primitives already understand rather than raw colours (`border-border`,
 * not `border-gray-300`; `bg-surface`, not `bg-white`) so the bar follows the
 * theme like everything else does.
 *
 * `md:text-xs` alongside `text-xs`: the controls declare `text-base
 * md:text-sm`, so a bare `text-xs` wins only BELOW `md` — both halves are
 * needed, or the bar goes back to `text-sm` on a desktop.
 *
 * LEFT PADDING ONLY, AND THAT IS NOT AN OVERSIGHT. The two dropdowns each
 * reserve their right edge for a chevron — `Combobox` (what a desktop
 * `<Select>` renders) with `AFFORDANCE_PAD` (`pr-8`), `MultiSelect` with
 * `pr-9` — and `cn()` is tailwind-merge, where a later `px-*` REMOVES an
 * earlier `pl-*`/`pr-*`. The first cut said `px-2.5` here, and the merge
 * quietly dropped both reservations: "1 selected" ran under its own arrow.
 * So this states `pl-2.5` — the edge the text starts from, which is the one
 * the eye lines up — and leaves each control its own right edge. The Search
 * button is the one with nothing on its right, so it adds `pr-2.5` itself.
 */
const BAR_CONTROL = "h-8 rounded-md border border-border bg-surface pl-2.5 text-xs md:text-xs";

export function Topbar({
  previewableRoles,
}: {
  /** Every role a Super Admin may preview — empty for anyone else. */
  previewableRoles: PreviewableRole[];
}) {
  const user = useAppUser();
  const search = useSearch();
  const router = useRouter();
  // THE PHONE HOME IS A BLUE BAND (user 2026-11-04, mock-up
  // https://claude.ai/artifact/1wBnFsT36NUb6LBasuGSxm v2, "this is only for mobile view").
  // On "/" this bar becomes the top of that band: "Hi, <name>!", the unit, and white
  // Search / bell / account. The band continues into the page (`MobileHome`'s first
  // element) and the order-book card overlaps it. Every other route keeps the white bar.
  const home = usePathname() === "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const appearance = useAppearanceItems();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [switching, startSwitch] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [previewError, setPreviewError] = useState<string | null>(null);

  /**
   * TICKING IS NOT APPLYING. `MultiSelect` reports every tick as it happens
   * (it has no "closed" event to hang a commit on — see its own file), and a
   * role switch triggers `router.refresh()` on every server component, so
   * committing per-tick would fire `confirmDiscard()`'s "Discard unsaved
   * changes?" prompt on every single checkbox click. Local `pendingPreview`
   * holds the in-progress pick; an explicit "Apply" is the one moment that
   * actually switches the session, once, however many roles were ticked.
   *
   * Re-synced from `user.simulatedRoleIds` whenever the server's answer
   * changes (a fresh page load, another tab applying a different preview) —
   * otherwise a stale local pick would survive past the refresh it was
   * supposed to cause. Done by adjusting state DURING RENDER (React's own
   * pattern for "reset local state when a prop changes") rather than in a
   * `useEffect`, which would commit the stale value for one extra frame and
   * trip `react-hooks/set-state-in-effect`.
   */
  const [syncedIds, setSyncedIds] = useState(user.simulatedRoleIds);
  const [pendingPreview, setPendingPreview] = useState(user.simulatedRoleIds);
  if (!sameRoleSet(syncedIds, user.simulatedRoleIds)) {
    setSyncedIds(user.simulatedRoleIds);
    setPendingPreview(user.simulatedRoleIds);
  }
  const previewDirty = !sameRoleSet(pendingPreview, user.simulatedRoleIds);

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

  /**
   * A REAL Super Admin only — `realIsSuperAdmin`, not `isSuperAdmin`, which is
   * false while already previewing. Same `confirmDiscard()` guard as the unit
   * switch and for the same reason: this triggers `router.refresh()`, which
   * re-runs every Server Component and can redirect a page the newly-applied
   * roles can't reach — exactly the kind of re-render that must not silently
   * eat a half-typed form. Fired once, on Apply, never per tick — see
   * `pendingPreview`'s note above.
   */
  function onApplyPreview() {
    if (!previewDirty) return;
    if (!confirmDiscard()) return;

    setPreviewError(null);
    startPreview(async () => {
      const result = await setRolePreview(pendingPreview);
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    // PHONE ONLY (`md:hidden`, user 2026-10-01). From md up its three jobs
    // moved: unit, role preview and account to `SidebarDock` at the foot of
    // the sidebar; search, appearance and the bell to the end of
    // `WorkspaceTabsBar`, which is now the work panel's first row. The
    // Location row above the tabs was the "orphaned" strip the user reported.
    <header
      data-topbar=""
      className={cn(
        "flex shrink-0 items-center justify-between px-4 md:hidden",
        home ? "h-16 bg-[#0a2e4d] text-white" : "h-14 border-b border-border bg-surface",
      )}
    >
      {/* `BAR_CONTROL` (top of file) is the ONE size every control in this bar
          takes — Location, the role preview, Search. See its own note. */}
      {/* Location switcher (two GST entities) */}
      {/* `min-w-0`: without it this group is sized by the Select's fixed width
          and cannot give a pixel back, which is half of why the bar had a hard
          378px floor (see the Select's own note). */}
      <div className="flex min-w-0 items-center gap-2">
        {home && (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-white/70 bg-gradient-to-br from-brand-green to-[#5aa61b] text-base font-extrabold text-white">
              {(user.fullName ?? user.email ?? "?").charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-lg font-bold leading-tight">
                Hi, {user.fullName?.split(" ")[0] ?? "there"}!
              </span>
              {current && <span className="block truncate text-xs text-[#b9d6ec]">{current.name}</span>}
            </span>
          </div>
        )}
        <span className={cn("hidden text-xs text-muted-foreground", !home && "sm:inline")}>
          Location
        </span>
        {/* `className` IS THE WRAPPER'S WIDTH AND NOTHING ELSE. On a desktop
            `<Select>` renders a `Combobox` — a wrapper `<div>` around an
            `<input>` — and forwards `className` to BOTH, so `BAR_CONTROL`'s
            `border … bg-surface … pl-2.5` sent that way drew a SECOND box
            around the control and shoved the input 10px right inside it: the
            "double border" beside the role preview (2026-09-16). That box had
            been fixed once before, by stripping border/bg from this className
            — and the 09-15 uniformity pass put them straight back, because
            `BAR_CONTROL` has to carry them for the `<button>` Search trigger,
            which draws none of its own. So the constant now goes through
            `inputClassName`, the hook `MultiSelect` beside this already takes
            it on, and the two controls are styled by the identical string on
            the identical element. `font-medium` rides with it: it is the
            control's text, not the wrapper's.

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

        {/* Role Preview — Super Admin only, and only when there's a role to
            preview. Hidden below `md`: this is a testing/support tool for an
            admin at a desk, not a shop-floor control, and the bar's mobile
            width budget is already spoken for (see the Location `<Select>`'s
            own note above the 314px floor this bar was cut down to).

            A MULTI-select, not a single one — an operator can hold more than
            one role at once (see `AppUser.simulatedRoleIds`), and previewing
            only ever one at a time cannot represent that. Ticking is local
            (`pendingPreview`); "Apply" is the one moment that actually
            switches the session — see that state's own note above.

            `hideChips`: the RolePreviewBanner below states every active
            preview role in one line ("Previewing as X, Y") once applied,
            which is this control's "elsewhere" for a chip row — the bar has
            no width to spare for one, and it would wrap the header onto a
            second line on every pick.

            `triggerClassName` reaches the trigger's WIDTH; `inputClassName`
            (added 2026-09-15, the same hook `<Select>` threads into
            `Combobox`) reaches the input itself, so this now takes
            `BAR_CONTROL` and sits at the bar's h-8 / text-xs exactly like the
            Location box and the Search trigger beside it. It used to render
            at the primitive's own h-9 — "accepted rather than forked" — until
            the operator asked for the three to be strictly uniform. */}
        {user.realIsSuperAdmin && previewableRoles.length > 0 && (
          <div className="hidden items-center gap-1.5 md:flex">
            <MultiSelect
              compact
              hideChips
              id="role-preview"
              label="Preview as role"
              options={previewableRoles.map((r) => ({ id: r.id, label: r.name }))}
              values={pendingPreview}
              onChange={setPendingPreview}
              disabled={previewing}
              placeholder="Super Admin (you)"
              triggerClassName="w-40"
              inputClassName={BAR_CONTROL}
            />
            {previewDirty && (
              <button
                type="button"
                onClick={onApplyPreview}
                disabled={previewing}
                className="shrink-0 text-xs font-medium text-primary underline underline-offset-2 disabled:opacity-60"
              >
                Apply
              </button>
            )}
          </div>
        )}
        {previewError && (
          <span
            id="role-preview-error"
            role="alert"
            className="hidden text-xs text-danger lg:inline"
          >
            {previewError}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {home && (
          <button
            type="button"
            onClick={() => search.open()}
            aria-label="Search"
            className="grid size-9 place-items-center rounded-control bg-white/12 text-white hover:bg-white/20"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
        )}
        <NotificationsBell onDark={home} />

        <div className="relative">
          {/* On the home band the avatar is already the greeting's, so the menu
              trigger is a plain chevron — same menu, one face on screen. */}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Account menu"
            className={cn(
              "flex items-center gap-2 rounded-md text-sm",
              home ? "grid size-9 place-items-center bg-white/12 text-white hover:bg-white/20" : "px-2 py-1.5 hover:bg-surface-muted",
            )}
          >
            {!home && (
              <>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {(user.fullName ?? user.email ?? "?").charAt(0).toUpperCase()}
                </span>
                <span className="hidden max-w-[10rem] truncate sm:inline">
                  {user.fullName ?? user.email}
                </span>
              </>
            )}
            <ChevronDown className={cn("h-3.5 w-3.5", home ? "text-white" : "text-muted-foreground")} />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-64 max-h-[80vh] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg">
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
                <div className="border-b border-border px-3 py-2">
                  <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> Unit
                  </p>
        <Select
          value={current?.id ?? ""}
          onChange={(e) => onSwitchUnit(e.target.value)}
          disabled={switching || allowed.length === 0}
          aria-label="Location"
          aria-describedby={error ? "location-switch-error" : undefined}
          className="w-full"
          inputClassName={cn(BAR_CONTROL, "font-medium")}
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
                  {error && (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      {error}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <Sun className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-sm">Theme</span>
                  <div role="radiogroup" aria-label="Theme" data-segmented="" className={SEG_TRACK}>
                    {THEMES.map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={theme === id}
                        aria-label={label}
                        title={label}
                        onClick={() => setTheme(id)}
                        className={cn(SEG_ITEM, "justify-center px-2", theme === id ? SEG_LIT : SEG_IDLE)}
                      >
                        <Icon aria-hidden />
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  aria-expanded={appearanceOpen}
                  title={appearance.summary}
                  onClick={() => setAppearanceOpen((o) => !o)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-foreground hover:bg-surface-muted"
                >
                  <Type className={cn("h-4 w-4", appearance.compact ? "text-primary" : "text-muted-foreground")} />
                  <span className="flex-1 text-left">Appearance</span>
                  <span className="max-w-[6rem] truncate text-xs text-muted-foreground">{appearance.styleLabel}</span>
                  <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", appearanceOpen && "rotate-90")} />
                </button>
                {appearanceOpen && (
                  <div className="ml-4 border-l border-border pl-1">
                    {appearance.items.map((item, i) => {
                      const heading = item.section && item.section !== appearance.items[i - 1]?.section;
                      return (
                        <div key={`${item.section}-${item.label}`}>
                          {heading && (
                            <p className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {item.section}
                            </p>
                          )}
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={!!item.checked}
                            onClick={item.onClick}
                            className="flex w-full items-center gap-2 rounded px-2.5 py-1 text-sm text-foreground hover:bg-surface-muted"
                          >
                            {item.swatch ? (
                              <span className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-border" style={{ background: item.swatch }} />
                            ) : (
                              <span className="w-3.5 flex-none" />
                            )}
                            <span className="flex-1 truncate text-left" style={item.labelStyle}>{item.label}</span>
                            {item.checked && <Check className="h-4 w-4 flex-none text-primary" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    search.open();
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-foreground hover:bg-surface-muted"
                >
                  <Search className="h-4 w-4" /> Search
                </button>
                {/* MY PROFILE (user 2026-10-01) — the signed-in person's own
                    HR staff record, for every login and with no permission
                    needed (app/(app)/my-profile). `router.push` rather than a bare
                    link so the menu closes the same way the rows below do. */}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push("/my-profile");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-3 py-2 text-sm",
                    "text-foreground hover:bg-surface-muted",
                  )}
                >
                  <UserRound className="h-4 w-4" /> My Profile
                </button>
                {/* No "My Work" row (user 2026-10-01: "not in profile"). A
                    person's work lives in its module — T&A tasks on Orders ▸
                    TA Worklist — not under their name in the profile menu. */}
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
                {/* Install as an app — from the menu, not only the toast the
                    operator may have dismissed (client 2026-09-22). The row
                    reads the same store as the toast, so it can never claim
                    "installed" while the toast is still offering to. */}
                <InstallMenuItem onDone={() => setMenuOpen(false)} />
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
