import { GroupHub } from "@/components/shell/group-hub";

// Sub-module hub — cards and permission come from lib/nav/module-groups.ts,
// the same registry the sidebar reads. The slug is `changes` rather than
// `amendments` because /orders/amendments is one of this group's own children.
export default function Page() {
  return <GroupHub moduleHref="/orders" slug="changes" />;
}
