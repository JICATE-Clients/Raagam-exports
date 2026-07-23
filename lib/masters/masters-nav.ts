import { SUBMODULES } from "./submodules";
import { MATERIALS_CHILDREN, isCustomChild } from "./registry";

/**
 * Nav/quick-action metadata for the Masters module, generated from the same
 * registries the hub pages render from (`registry.ts` for Materials,
 * `submodules.ts` for the rest) — so a new master automatically gets its
 * mobile ＋ action and FAB listing with no extra wiring.
 *
 * Pure data (no "use client") — imported by `components/shell/nav.ts`.
 */
export type MastersNavEntry = { href: string; label: string; singular: string };

/** Bulk-assign / singleton screens that have no "New X" create form. */
const NO_CREATE_CUSTOMS = new Set([
  "tcs_assign",
  "gst_assign",
  "customer_gst_assign",
  "hsn_assign_material",
  "hsn_assign_process",
  "default_account_head",
]);

/** All entity pages (custom children only), optionally scoped to one hub. */
export function mastersEntityLinks(subSlug?: string): MastersNavEntry[] {
  const out: MastersNavEntry[] = [];
  for (const sub of SUBMODULES) {
    if (subSlug && sub.slug !== subSlug) continue;
    if (sub.slug === "materials") {
      for (const c of MATERIALS_CHILDREN) {
        if (isCustomChild(c)) {
          out.push({ href: `/masters/materials/${c.slug}`, label: c.label, singular: c.singular });
        }
      }
    } else {
      for (const c of sub.children) {
        if (c.type === "custom") {
          out.push({ href: `/masters/${sub.slug}/${c.slug}`, label: c.label, singular: c.singular });
        }
      }
    }
  }
  return out;
}

function hasCreateForm(href: string): boolean {
  // Resolve the child back to its `custom` key to skip assign/singleton screens.
  const [, , subSlug, childSlug] = href.split("/");
  if (subSlug === "materials") return true; // all materials children are CRUD masters
  const sub = SUBMODULES.find((s) => s.slug === subSlug);
  const child = sub?.children.find((c) => c.slug === childSlug);
  return !(child && child.type === "custom" && NO_CREATE_CUSTOMS.has(child.custom));
}

/** `?new=1` quick actions per entity route — spread into `SECTION_ACTIONS`. */
export const MASTERS_SECTION_ACTIONS: Record<string, string[]> = Object.fromEntries(
  mastersEntityLinks()
    .filter((e) => hasCreateForm(e.href))
    .map((e) => [e.href, [`New ${e.singular}`]]),
);

/**
 * Sections for the mobile FAB while inside /masters: the entities of the hub
 * the user is in (current entity listed first). At the /masters root (or an
 * unknown segment) it lists every entity, in hub order.
 */
export function mastersFabSections(pathname: string): { href: string; label: string }[] {
  const seg = pathname.split("/")[2];
  const subSlug = SUBMODULES.some((s) => s.slug === seg) ? seg : undefined;
  const entries = mastersEntityLinks(subSlug);
  const current = entries.find((e) => pathname === e.href || pathname.startsWith(`${e.href}/`));
  const rest = current ? entries.filter((e) => e !== current) : entries;
  return (current ? [current, ...rest] : rest).map((e) => ({ href: e.href, label: e.label }));
}
