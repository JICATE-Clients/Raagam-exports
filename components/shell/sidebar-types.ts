/** A store record surfaced as a sidebar link under the Stores group.
 *  Its own file so `GlobalSidebar` / `ContextSidebar` and `sidebar.tsx` can
 *  both import it without a cycle (`sidebar.tsx` composes those two). */
export interface StoreNavLink {
  id: string;
  name: string;
}
