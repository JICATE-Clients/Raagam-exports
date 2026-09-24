import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

/**
 * The way out of the Fabric BOM's CAD gate (0628): a new BOM for an order whose
 * CAD is not yet approved opens read-only with this in its banner. A LINK — the
 * approval is recorded on the lifecycle screen, never from inside the BOM.
 */
export function CadLifecycleLink() {
  return (
    <Link href="/orders/cad-lifecycle" className={buttonClasses({ size: "sm", className: "shrink-0" })}>
      Open CAD Lifecycle
    </Link>
  );
}
