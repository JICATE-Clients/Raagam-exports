import Link from "next/link";
import { Truncated } from "@/components/ui/truncated";
import { MOOD_COLOUR } from "@/components/viz/kit";

export type AccessRole = { id: string; name: string; users: number; all: boolean; grants: ReadonlySet<string> };
export type AccessModule = { key: string; label: string };

/**
 * "WHO CAN OPEN WHAT?" — the access map (overview plan, Admin's new picture, 2026-11-06).
 *
 * Roles down the side, modules across the top. A filled dot = the role can open the module
 * (it holds `<module>:view`); a faint ring = it cannot. The row ends with how many people hold
 * the role, so a wide role held by many people — the over-grant the Users list cannot show —
 * stands out. Super Admin is "All access" by definition and drawn as a full row.
 *
 * Module grain only: a role narrowed screen by screen (0658) still shows the module as open,
 * and the page says so under the map rather than pretending to a precision it does not have.
 */
export function AccessMap({ roles, modules }: { roles: AccessRole[]; modules: AccessModule[] }) {
  if (!roles.length) return <p className="px-3.5 py-3 text-sm text-muted-foreground">No role is set up yet.</p>;
  const cols = `minmax(0,11rem) repeat(${modules.length}, minmax(2.25rem,1fr)) 4rem`;
  const on = MOOD_COLOUR.normal;
  return (
    <div className="overflow-x-auto px-3.5 py-3">
      <div role="table" aria-label="Which role can open which module" className="min-w-[40rem] space-y-0.5">
        <div role="row" className="grid items-end gap-1 pb-1" style={{ gridTemplateColumns: cols }}>
          <span role="columnheader" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Role
          </span>
          {modules.map((m) => (
            <span key={m.key} role="columnheader" className="min-w-0 text-center text-[10.5px] font-semibold text-muted-foreground">
              <Truncated text={m.label} className="block" />
            </span>
          ))}
          <span role="columnheader" className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            People
          </span>
        </div>
        {roles.map((r) => (
          <div key={r.id} role="row" className="grid items-center gap-1 border-t border-dashed border-border py-0.5" style={{ gridTemplateColumns: cols }}>
            <span role="cell" className="min-w-0">
              <Link href="/admin/access-control" className="block hover:text-primary hover:underline">
                <Truncated text={r.all ? `${r.name} · All access` : r.name} className="block text-[12.5px] font-semibold" />
              </Link>
            </span>
            {modules.map((m) => {
              const yes = r.all || r.grants.has(m.key);
              return (
                <span key={m.key} role="cell" className="grid place-items-center" title={`${r.name} ${yes ? "can" : "cannot"} open ${m.label}`}>
                  <i
                    aria-label={yes ? "can open" : "cannot open"}
                    className="size-2.5 rounded-full"
                    style={yes ? { background: on, boxShadow: `0 0 6px -1px ${on}` } : { border: "1.5px solid var(--border-strong)" }}
                  />
                </span>
              );
            })}
            <span role="cell" className="text-right text-[12.5px] font-semibold tabular-nums">
              {r.users}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
