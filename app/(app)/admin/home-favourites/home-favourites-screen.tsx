"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { confirmDiscard, useUnsavedGuard } from "@/lib/reload-guard";
import { saveFavoriteDefaults } from "@/lib/favorites/actions";
import { favoriteWellStyle, resolveFavorite } from "@/lib/favorites/registry";
import type { DefaultsByScope } from "@/lib/favorites/service";
import { FavoriteListEditor, type EditRow } from "@/components/favorites/favorite-list-editor";
import { cn } from "@/lib/utils";

/**
 * Pick a scope on the left (Everyone, or one role), arrange its tiles on the right, Save.
 * One scope at a time, saved whole — the same "replace this list" the action does.
 *
 * Width (raagam-screen-layout, "build it compact the first time"): 16rem scope list + 1rem gap
 * + 38rem editor = 55rem, capped at max-w-[56rem] so the editor's rows never stretch into a
 * line too long to scan.
 */
export function HomeFavouritesScreen({
  defaults,
  roles,
  canEdit,
}: {
  defaults: DefaultsByScope;
  roles: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const scopes = [{ id: "everyone", name: "Everyone" }, ...roles];
  const [scope, setScope] = useState("everyone");
  const rowsOf = (id: string): EditRow[] => (defaults[id] ?? []).map((key) => ({ key, source: "role", hidden: false }));
  const [rows, setRows] = useState<EditRow[]>(() => rowsOf("everyone"));
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedGuard(dirty || pending);

  function pick(id: string) {
    if (id === scope) return;
    if (dirty && !confirmDiscard()) return;
    setScope(id);
    setRows(rowsOf(id));
    setDirty(false);
  }

  function save() {
    start(async () => {
      const res = await saveFavoriteDefaults(scope, rows.map((r) => r.key));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDirty(false);
      toast.success(`Home tiles saved for ${scopes.find((s) => s.id === scope)?.name ?? "this role"}.`);
      router.refresh();
    });
  }

  const current = scopes.find((s) => s.id === scope);
  return (
    <div className="grid max-w-[56rem] gap-4 md:grid-cols-[16rem_1fr]">
      <nav aria-label="Who the tiles are for" className="rounded-2xl border border-border bg-surface p-2">
        <ul className="space-y-0.5">
          {scopes.map((s) => {
            const n = (s.id === scope ? rows.length : (defaults[s.id] ?? []).length) || 0;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pick(s.id)}
                  aria-current={s.id === scope ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-sm",
                    s.id === scope ? "bg-primary-soft font-semibold text-primary" : "hover:bg-surface-muted",
                  )}
                >
                  {s.id === "everyone" && <Users className="size-4 shrink-0" aria-hidden />}
                  <span className="min-w-0 flex-1">{s.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{n || ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label={`Tiles for ${current?.name ?? ""}`} data-focus-scope className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold text-heading">{current?.name}</h2>
          {scope === "everyone" && <span className="text-xs text-muted-foreground">Every login, including staff with no role</span>}
        </div>
        <div className="p-4">
          {canEdit ? (
            <FavoriteListEditor
              idPrefix={`fav-def-${scope}`}
              mode="admin"
              rows={rows}
              onChange={(next) => {
                setRows(next);
                setDirty(true);
              }}
            />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tiles set.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {rows.map((r) => {
                const it = resolveFavorite(r.key);
                return it ? (
                  <li key={r.key} className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-[7px]" style={favoriteWellStyle(it.hue)}>
                      <it.icon className="size-3.5" aria-hidden />
                    </span>
                    {it.label}
                  </li>
                ) : null;
              })}
            </ol>
          )}
        </div>
        {canEdit && (
          <div data-focus-region="footer" className="flex justify-end gap-2 rounded-b-2xl border-t border-border bg-primary-soft px-4 py-3">
            <Button variant="outline" size="md" disabled={!dirty || pending} onClick={() => { setRows(rowsOf(scope)); setDirty(false); }}>
              Cancel
            </Button>
            <Button size="md" disabled={!dirty || pending} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
