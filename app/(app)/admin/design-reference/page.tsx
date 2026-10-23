import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { DesignReference } from "./design-reference";

/**
 * Administration ▸ System ▸ Design Reference (2026-10-16). Every button, status
 * pill, colour token and common icon, drawn by the SAME primitives the screens
 * use — so this page cannot drift from the app: change `button.tsx`,
 * `status-pill.tsx` or `lib/ui/status-tone.ts` and the reference changes with
 * it. It follows the operator's own colour preset, New look and dark mode,
 * which is the point: it shows the app as THIS operator sees it.
 */
export default async function DesignReferencePage() {
  await requirePermission("system_admin", "view");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Design Reference"
        description="The buttons, status colours, colour tokens and icons the app is built from — live, in your current theme."
      />
      <DesignReference />
    </div>
  );
}
