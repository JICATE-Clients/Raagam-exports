import { ModuleHub } from "@/components/shell/module-hub";

// PROCESS — its own module (user 2026-11-12: "like purchase, production, process also
// module"). Job work done by outside processors; Knitting is its first sub-module. Cards come
// from lib/nav/module-groups.ts, the same registry the sidebar reads.
export default function ProcessPage() {
  return <ModuleHub moduleHref="/process" />;
}
