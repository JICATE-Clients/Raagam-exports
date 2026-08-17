import { GroupHub } from "@/components/shell/group-hub";

// Sub-module hub — cards and permission come from lib/nav/module-groups.ts,
// the same registry the sidebar reads.
//
// This group is `hidden`, so it has no sidebar row and nothing links here. The
// page exists anyway for two reasons: assertion 1 in check-module-groups.mts
// requires a hub per group, and the three screens listed on it are still live —
// an operator who reaches one from search can walk back up to a page that says
// in one line why the menu no longer offers them.
export default function Page() {
  return <GroupHub moduleHref="/orders" slug="retired" />;
}
