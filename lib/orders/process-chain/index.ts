/**
 * Multi-process chaining and the Grey-to-Processed lifecycle (doc/file.md §6).
 *
 * One import for a screen: the chain rules live in `chain.ts`, the four
 * lifecycle states in `lifecycle.ts`, and neither re-derives anything the
 * Material BOM, the challan or the stock ledger already own. Read either file's
 * header before changing a rule — both record what they deliberately do NOT do.
 */

export {
  readChain,
  dispatchCeiling,
  qtyOutRefusal,
  chainVerdicts,
  chainSaveRefusal,
  greyCoverage,
  isRefusal,
} from "@/lib/orders/process-chain/chain";

export type {
  ChainRow,
  ChainStage,
  ChainIndex,
  DispatchCeiling,
  ChainStageVerdict,
  GreyCoverage,
  Refusal,
} from "@/lib/orders/process-chain/chain";

export { lifecycleOf, greyShortfall } from "@/lib/orders/process-chain/lifecycle";
export type { Lifecycle, LifecycleInput } from "@/lib/orders/process-chain/lifecycle";
