-- =============================================================================
-- 0813 · Stock Transfer — one lot may go into SEVERAL To bins (GRN's bin split)
-- =============================================================================
-- User 2026-11-05: "To Bin — which concept the GRN page has, the better bin UI concept,
-- use it for this too", choosing the FULL split: a line's Transfer Qty is put away across
-- bins, each with its own qty, exactly as GRN receives into bins (lib/purchase/bin-split.ts).
--
-- The screen keeps ONE row per lot and saves one `stock_transfer_lines` row per BIN, all
-- naming the same source layer. 0803's `unique (transfer_id, source_ledger_id)` refused the
-- second of those, so it becomes unique per (transfer, layer, bin):
--
--   * NULLS NOT DISTINCT — a lot with no To bin ("blank keeps the bin it is in" on a same-
--     store move) can still appear only once, as before. Two NULL-bin rows for one layer
--     would be the same move entered twice.
--   * `stock_transfer_post` needs no change: it already walks every line, checks each qty
--     against what the layer holds, and decrements its working balance per line ("the next
--     line drawing the same layer sees what this one left", 0803 §9) — so two bin rows of one
--     lot can never move more than the lot holds.
--   * `assignBin` (0809, bin_to_bin) writes one line per layer into one bin, which the new
--     rule allows unchanged.
-- =============================================================================

alter table public.stock_transfer_lines
  drop constraint if exists stock_transfer_lines_transfer_id_source_ledger_id_key;

alter table public.stock_transfer_lines
  add constraint stock_transfer_lines_transfer_layer_bin_key
  unique nulls not distinct (transfer_id, source_ledger_id, to_bin_id);
