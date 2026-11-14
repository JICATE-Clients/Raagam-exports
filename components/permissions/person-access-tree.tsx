"use client";

import { PermissionTree } from "@/components/permissions/permission-tree";
import type { CatalogModule } from "@/lib/permissions/screen-catalog";
import type { PermissionTree as Tree } from "@/lib/permissions/effective";
import type { ScreenBlock } from "@/lib/permissions/service";
import {
  applyPersonCells,
  catalogWithin,
  effectiveTree,
  personModel,
  treeDiff,
  type Offered,
} from "@/lib/permissions/levels";

/**
 * ONE PERSON'S ACCESS IN THE FAMILIAR EDITOR (user 2026-11-14, screenshot
 * 4179: "previously look easier"). The module rail + screen grid the app had
 * before the four-word rows, drawn over what the person can REALLY open —
 * their role(s), plus what was added for them, minus what was removed.
 *
 * An edit is a whole new tree; `treeDiff` turns it back into cells and
 * `applyPersonCells` files each one where it belongs: a role cell unticked is a
 * BLOCK (0840), anything else ticked is an EXTRA. So the stored shape, and the
 * "Changes for this person" words, are exactly what they were.
 *
 * `scope = "role"` shows only the screens the role(s) give (plus anything the
 * person already holds, so it can be taken away) and refuses to switch on a
 * cell beyond the role; `"all"` offers every module, for access the client
 * asks for on top of the role.
 */
export function PersonAccessTree({
  catalog,
  offered,
  roleTrees,
  tree,
  blocks,
  scope,
  readOnly = false,
  onChange,
}: {
  catalog: CatalogModule[];
  offered: Offered;
  /** The role(s) as currently picked. */
  roleTrees: Tree[];
  /** Their extras. */
  tree: Tree;
  /** Role cells removed for them — only those a picked role gives. */
  blocks: ScreenBlock[];
  scope: "role" | "all";
  readOnly?: boolean;
  onChange: (next: { extras: Tree; blocks: ScreenBlock[] }) => void;
}) {
  const model = personModel(roleTrees, tree, blocks);
  const effective = effectiveTree(model.has, offered);
  const shown =
    scope === "role" ? catalogWithin(catalog, offered, (sc, a) => model.roleHas(sc, a) || model.has(sc, a)) : catalog;

  if (shown.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
        This role opens no module yet — switch to All modules to give access on request.
      </p>
    );

  return (
    <PermissionTree
      key={scope}
      catalog={shown}
      offered={offered}
      value={effective}
      readOnly={readOnly}
      onChange={(next) => {
        const changes = treeDiff(effective, next, offered).filter(
          (c) => scope === "all" || !c.on || model.roleHas(c.sc, c.a),
        );
        if (changes.length === 0) return;
        const res = applyPersonCells(roleTrees, tree, blocks, changes);
        onChange({ extras: res.extras, blocks: res.blocks });
      }}
    />
  );
}
