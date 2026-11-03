import { GroupHub } from "@/components/shell/group-hub";

// Sub-module hub — cards and permission come from lib/nav/module-groups.ts.
// This group is `hidden` (user 2026-11-02): no sidebar row, but the screens on it
// are live, and an operator who reaches one from search can walk back up to a page
// that says why the menu no longer offers them.
export default function Page() {
  return <GroupHub moduleHref="/purchase" slug="retired" />;
}
