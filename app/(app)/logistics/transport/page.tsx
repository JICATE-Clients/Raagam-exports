import { ModuleHub } from "@/components/shell/module-hub";

// Transport module landing page — one card per sub-module, from
// lib/nav/module-groups.ts (the same registry the sidebar reads).
export default function TransportPage() {
  return <ModuleHub moduleHref="/logistics/transport" />;
}
