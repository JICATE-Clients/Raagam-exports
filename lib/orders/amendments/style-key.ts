/**
 * The style key, normalised — the one function, on its own so both sides of the
 * server/client boundary can call it.
 *
 * Trim + upper-case, because field VALUES are stored in capitals app-wide
 * (AGENTS.md "CAPITALS") but rows saved before that rule are not — so
 * `"tsh-001 "` off an old order and `"TSH-001"` off a new one are the same style
 * and must match. Returns "" for a row with no style at all, which callers treat
 * as unkeyed rather than as a style named "".
 *
 * WHY IT IS ITS OWN FILE. It lived in `order-seed.ts`, which starts with
 * `import "server-only"` — so the moment the Style(s) sub-grid needed to regroup
 * saved sizes under their style ON THE SCREEN (0407), importing it would have
 * pulled a server module into a client component. That fails at BUILD, not at
 * `tsc`, which is precisely the class of break AGENTS.md's "run the build before
 * vouching for a tree" exists for.
 *
 * The alternative — a second trim-and-upper-case helper beside the client code —
 * is worse than the import it avoids. This string is the Orders module's join
 * key: `garment_order_amendment_style_sizes` binds to its style by it, and Price
 * Details, Quantities and Approval Qty all resolve on it. Two copies of a key
 * rule stay identical exactly until one of them is "improved".
 *
 * `order-seed.ts` re-exports this, so every existing importer is unchanged.
 *
 * NOTHING HERE PARSES THE REF, and nothing added later should. As of 0402 the
 * style code carries SLASHES (`STL/2627/0001`), so a split-on-a-delimiter would
 * shred the key rather than read it.
 */
export function styleKey(refNo: string | null, styleNo?: string | null): string {
  return (refNo?.trim() || styleNo?.trim() || "").toUpperCase();
}
