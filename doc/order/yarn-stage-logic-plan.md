# Yarn & Yarn-Dyed stage logic · implementation plan

Spec: the "Yarn & Yarn-Dyed (YD) Stage Logic Rules for Process Listing" document
(client 2026-09-21). Written after mapping it onto this repo. Most of it is
already built; this says exactly what was missing, what is built for it, and
what was deliberately not copied from the spec's DDL.

## 1. Section by section

| Spec | Status |
|---|---|
| §2 Process → stage matrix, `is_base_process` | **Exists** — `process_fabric_stages` (0563), `is_base` per (process, stage), edited on Master Data ▸ Processes ▸ Stages grid. Seeds 0563/0570 already map KNITTING·GREIGE base, DYEING·DYED base, WASHING·WASH base, PRINTING·PRINT base, STENTER/COMPACTING as secondaries, FABRIC PURCHASE·GREIGE base. |
| §2 "base for at most ONE stage" | **Half built** — `baseStageProblem` refused it at Save (screen + action) since 0563; nothing in the DB enforced it and the tick was not exclusive. **Built now:** partial unique index (0611) + the Base tick unticks its siblings. |
| §2 YARN PURCHASE · YARN DYEING on the yarn side | **Missing** — the Process Master only kept stage rows for a `for_fabric` process, so no yarn process could be mapped; the Yarn Process tab's Process ▾ narrowed by `for_yarn` alone. **Built now** (§2 below). |
| §3 Solid vs YD sequences (fabric side) | **Exists** — `stage-routes.ts`: GREIGE→DYED/WASH→PRINT is forward-only (0570), a YD fabric refuses DYEING (0557, Save rule since 09-19) and is offered DYED only for a dyed-roll purchase (09-20); `standard-routes.ts` proves all five client chains enter. |
| §4A per-shade dyeing loss, ÷(1−L), 4.34 % | **Exists** — 0568 (shade loss on Yarn Dyed Details), 0606 (colour-wise loss on a step), `sectionAverageLoss` prints 1 − plan/ordered. The spec's own numbers are the vectors. |
| §4B greige consolidation per yarn | **Exists** — `yarnPurchase` sums every colourway into ONE lot per yarn, rounded once; Fabric T&A's Step 8/9 use the same grain. |
| §5 `process_master_stages` | Is `process_fabric_stages` (id-keyed to the `fabric_stage` lookup, not a code enum — the operator renamed GREY→GREIGE on it, which an enum would not survive). Only the partial index was missing. |
| §5 `order_fabric_process_routes` | Is `order_fabric_bom_processes` + 0606's `color_wise_loss` / `color_losses`. `is_base_process` on the route row is not stored — it is the master's fact and is read from there. |
| §6.1–6.4 Fabric Process tab filtering, base first, unmapped fallback | **Exists** — `narrowToStage`, `baseProcessesForStage`, `stageMismatchBlocked`, `baseProcessMissing`, all Save rules via `stageRouteProblems`. |
| §6.5 colour-wise loss modal | **Exists** — 0606, driven by the For field since 2026-09-21. |
| §7 `calculateYdRequirements()` in process-chain | Not that file: the YD arithmetic lives in `lib/orders/fabric-bom/yarn-process.ts` (`shadeDyeFactor`, `yarnPurchase`) and is what the report prints. |
| §7 Base Process column 8.5 rem, centred 32 px cell | **Exists** (2026-09-18). |

## 2. What is built (the gaps)

1. **Yarn processes are classified on the same Stages grid.** The grid shows for a
   `for_yarn` process too; `normalizeFabricStages` keeps its rows. Stages stay
   the `fabric_stage` lookup (GREIGE · DYED · WASH · PRINT); the Yarn Process
   tab's own list is the `yarn_stage` lookup (GREIGE · DYED), and the two are
   matched **by code** (`grey`/`dyed`), the way `stageRank` already reads a
   stage — never by id, since they are different rows.
2. **Yarn Process tab: Stage → Process.** `YarnProcessOption` carries
   `stage_roles` (resolved to `yarn_stage` ids by the loader); `processesForYarn`
   narrows exactly as `processesForFabric` does (`narrowToStage`: allowed
   processes, then the base first, unmapped = universal, empty = fall open).
   Inline twins name a held process its stage does not allow and a stage opened
   by a non-base step; the same two are Save rules (`yarnStageProblems`, screen
   gate + server guard).
3. **Base is exclusive per process** — ticking it on one stage row unticks the
   others; `baseStageProblem` stays as the refusal; 0611 adds
   `uq_process_fabric_stages_one_base (process_id) where is_base`.
4. **Seed (0611):** `YARN PURCHASE` (`for_yarn`, GREIGE, base) and
   `YARN DYEING → DYED, base` — the spec's two yarn-side rows. Matched by name;
   nothing overwritten.

## 3. Not adopted, and why

- A second mapping table for yarn stages. One classification per process, read
  by both tabs, is one thing to maintain; the code match costs nothing.
- Enforcing "no YARN DYEING for a yarn used only in solid cloth" — the spec's
  §3 sequences imply it but do not state it, and a solid cloth is legitimately
  knitted from dyed yarn (melange, mock-YD). Left as it is.

## 4. Verification

`scripts/check-yarn-stage-routes.mts` (`npm run check:yarn-stage-routes`): the
code match, the narrowing, the base-first floor, the twins and the exclusive
base — each shown failing against a mutation first.

**0611 applied 2026-09-21** — the seeds first through the API while the
database connection was down, then the whole file once it returned. Verified
from the catalog: the index exists, no process is base on two stages, and the
ledger reads `0611_yarn_stage_logic`.
