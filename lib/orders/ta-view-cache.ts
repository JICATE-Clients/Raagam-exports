/**
 * THE LAST T&A ANSWER, REMEMBERED FOR THE TAB (2026-09-24, "T&A tab takes 2
 * seconds to read").
 *
 * `MasterFullScreen` renders only the ACTIVE rail section, so the Fabric BOM ▸
 * T&A tab and Material BOM ▸ Trims T&A unmount the moment the operator steps
 * to another section — and every return used to start the whole read again
 * from "Reading…". This keeps the last answer per order so a return paints it
 * immediately, while the tab still fetches afresh underneath and replaces it.
 * Stale-while-revalidate, with the revalidate always on: nothing here decides
 * the data is fresh enough to skip a read. The trackers are derived from POs,
 * GRNs and process documents a colleague may post at any moment, so a cached
 * answer is only ever a placeholder for the one on its way.
 *
 * Module scope, so it lives as long as the tab (a full reload clears it) and
 * never reaches another operator. Bounded, because an operator can walk
 * through a long list of orders in one sitting.
 */

const LIMIT = 24;
const memory = new Map<string, unknown>();

export function recallTaView<T>(key: string): T | undefined {
  return memory.get(key) as T | undefined;
}

export function rememberTaView(key: string, value: unknown): void {
  memory.delete(key); // re-insert, so the Map's order is least-recently-stored first
  memory.set(key, value);
  if (memory.size > LIMIT) memory.delete(memory.keys().next().value as string);
}
