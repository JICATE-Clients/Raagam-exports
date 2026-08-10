/**
 * The app's status colour vocabulary.
 *
 * Declared here rather than in `components/ui/status-pill.tsx` for the same
 * reason `FieldSize` moved to `./sizes.ts`: a screen DESCRIPTOR names a status's
 * tone, and `lib/screens/**` has to stay loadable by plain Node — by
 * `lib/data-io`, by `"use server"` action files, and by the check script under
 * type stripping. One `.tsx` anywhere in that import graph and the purity
 * assertion stops being provable by reading the graph.
 *
 * `status-pill.tsx` re-exports it, so nothing that imports `StatusTone` from
 * there has to move. The `Record<StatusTone, string>` class maps stay in that
 * file — this is the vocabulary, that is the rendering.
 */

/**
 * `neutral` is the default and means "no claim" — a draft is neutral, not
 * warning. Reserve `danger` for a state the operator must act on (rejected,
 * cancelled), not merely one they may dislike.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";
