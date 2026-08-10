import { GroupHub } from "@/components/shell/group-hub";

// Sub-module hub — cards and permission come from lib/nav/module-groups.ts,
// the same registry the sidebar reads.
export default function Page() {
  return <GroupHub moduleHref="/hr" slug="people" />;
}
