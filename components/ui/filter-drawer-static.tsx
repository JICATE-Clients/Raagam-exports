import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE GROUPED FILTER DRAWER'S LOOK, FOR A PLAIN GET FORM — server-safe: no
 * hooks, no "use client", no context (user, 2026-09-23: "implement the
 * Material BOM filter in every Orders child").
 *
 * `components/ui/filter-drawer.tsx` is the real thing — `useFacetFilter`
 * holds the facet state in the client and filters as the operator picks. Two
 * Orders screens cannot take it: TA Followup (Approvals Worklist) and TA
 * Worklist are server components BY DESIGN — every filter is a URL search
 * param, the bucket tabs are plain `Link`s that carry them along, and the only
 * client boundary is the row buttons. Converting them to client state would
 * undo that, so they keep their `<form method="get">` and borrow only the
 * CHROME: grouped sections with an icon title, 10px uppercase labels, h-7 raw
 * selects with a chevron, the ~20rem-per-group cap.
 *
 * THE COST, STATED: a GET form cannot filter as you pick without client JS,
 * so this panel keeps an Apply button (and Clear, a link back to the
 * unfiltered URL) where the client drawer has none. Everything else — the
 * widths, the type, the set-reads-as-set border — is the same classes as
 * `FilterField` there, copied rather than imported because that file is a
 * client module and importing it here would put a client boundary under a
 * server page for the sake of a class list.
 *
 * Autofill: every control here is RAW, so it sets `autoComplete="off"` plus
 * the password-manager trio itself (AGENTS.md "Browser autofill").
 */

const COLS: Record<number, string> = { 1: "", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3" };
const CAP: Record<number, string> = { 1: "max-w-[20rem]", 2: "max-w-[40rem]", 3: "max-w-[60rem]" };

function controlClass(set: boolean) {
  return cn(
    "h-7 w-full rounded-md border bg-surface text-xs text-foreground",
    "transition-colors hover:border-border-strong",
    "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15",
    set ? "border-border-strong font-medium" : "border-border",
  );
}

/**
 * The panel: a GET `<form>` framed like the drawer's `<section>`, one column
 * per group (at most three), and an Apply / Clear strip beneath. `hidden` are
 * params the form must carry through unchanged (the active bucket tab, a
 * scope toggle) — a GET submit sends ONLY the form's own controls.
 */
export function StaticFilterDrawer({
  action,
  hidden,
  groups,
  active,
  clearHref,
}: {
  action: string;
  hidden?: Record<string, string | undefined>;
  groups: { title: string; icon?: ReactNode; children: ReactNode }[];
  /** Any filter set — shows Clear. */
  active: boolean;
  clearHref: string;
}) {
  const across = Math.min(groups.length, 3);
  return (
    <form
      method="get"
      action={action}
      aria-label="Filters"
      className={cn("rounded-lg border border-border bg-surface shadow-xs", CAP[across])}
    >
      {Object.entries(hidden ?? {}).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <div className={cn("grid grid-cols-1 divide-y divide-border lg:divide-x lg:divide-y-0", COLS[across])}>
        {groups.map((g) => (
          <div key={g.title} className="grid min-w-0 content-start gap-1.5 p-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              {g.icon && <span className="text-muted-foreground/70 [&>svg]:h-3.5 [&>svg]:w-3.5">{g.icon}</span>}
              {g.title}
            </h3>
            <div className="grid grid-cols-2 gap-1.5">{g.children}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5 border-t border-border px-2 py-1.5">
        {active && (
          <Link
            href={clearHref}
            className="h-7 rounded-md border border-border px-2.5 text-xs leading-7 text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
        <button
          type="submit"
          className="h-7 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
        >
          Apply
        </button>
      </div>
    </form>
  );
}

/** A 10px uppercase label over a 28px raw `<select>` with a chevron. The
 *  first option is "no filter" (`value=""`) unless `all` is null — a facet
 *  whose own vocabulary includes its "All" (a Status toggle) passes that. */
export function StaticFilterSelect({
  id,
  name,
  label,
  defaultValue,
  options,
  all = "All",
  wide,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  all?: string | null;
  wide?: boolean;
}) {
  /* "Set" is judged against the first option, so a Status whose default is
     its own "all" value does not read as set. */
  const unset = all != null ? "" : (options[0]?.value ?? "");
  return (
    <div className={cn("grid min-w-0 gap-0.5", wide && "col-span-2")}>
      <label htmlFor={id} className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name={name}
          defaultValue={defaultValue}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className={cn(controlClass(defaultValue !== unset), "appearance-none pl-2 pr-7")}
        >
          {all != null && <option value="">{all}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
      </div>
    </div>
  );
}

/**
 * A 28px raw text box. A search box, not a stored value — no uppercase
 * transform (AGENTS.md CAPS §"Exempt": a search box). Raw rather than the
 * `Input` primitive because `Input` pulls in `field.tsx`'s context hooks,
 * which force a client boundary under a server page.
 */
export function StaticFilterText({
  id,
  name,
  label,
  defaultValue,
  placeholder,
  wide,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("grid min-w-0 gap-0.5", wide && "col-span-2")}>
      <label htmlFor={id} className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </label>
      {/* caps-input: exempt -- a search box, not a stored value */}
      <input
        id={id}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        className={cn(controlClass(!!defaultValue), "px-2")}
      />
    </div>
  );
}
