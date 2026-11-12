/**
 * A KNITTING ORDER'S JOB WORK DC, INSIDE PROCESS (user 2026-11-12: "job work dc report is
 * redirecting to the purchase module — open in the same tab, no more redirect"). The print lived
 * only at /stores/process-dc/<id>/print, which the sidebar owns under Purchase, so opening it from
 * the Knitting Analysis jumped the operator into another module. Same sheet, reached under the
 * order's own route; the Purchase register keeps its link.
 */
export { default } from "@/app/(app)/stores/process-dc/[dcId]/print/page";
