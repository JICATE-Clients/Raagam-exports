"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  processJobInput,
  processReceiptInput,
  processLoss,
  type ProcessJobInput,
  type ProcessReceiptInput,
  type ProcessJobStatus,
} from "./types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;
type CreateJobResult = { ok: true; jobId: string } | ErrResult;

function revalidateProcess(jobId?: string): void {
  if (jobId) revalidatePath(`/process/${jobId}`);
  revalidatePath("/process");
}

// ---------- createJob ----------

/** Create a new process job in draft status. Missing processor/sent_qty is allowed. */
export async function createJob(payload: ProcessJobInput): Promise<CreateJobResult> {
  if (!(await can("process_planning", "create"))) throw new Error("Forbidden");

  const parsed = processJobInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await getAppUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("process_jobs")
    .insert({
      ...parsed.data,
      status: "draft",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create job" };
  }

  revalidateProcess((data as { id: string }).id);
  return { ok: true, jobId: (data as { id: string }).id };
}

// ---------- updateJob ----------

/** Update editable fields of a job (only draft/issued). */
export async function updateJob(
  id: string,
  payload: ProcessJobInput,
): Promise<ActionResult> {
  if (!(await can("process_planning", "edit"))) throw new Error("Forbidden");

  const parsed = processJobInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("process_jobs")
    .update(parsed.data)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidateProcess(id);
  return { ok: true };
}

// ---------- issueJob ----------

/** Transition a draft job to 'issued'. Requires processor_id and sent_qty > 0. */
export async function issueJob(id: string): Promise<ActionResult> {
  if (!(await can("process_planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: job, error: fetchErr } = await supabase
    .from("process_jobs")
    .select("id, status, processor_id, sent_qty")
    .eq("id", id)
    .single();

  if (fetchErr || !job) return { ok: false, error: "Job not found" };

  const j = job as { id: string; status: string; processor_id: string | null; sent_qty: number };

  if (j.status !== "draft") {
    return { ok: false, error: "Only draft jobs can be issued" };
  }
  if (!j.processor_id) {
    return { ok: false, error: "A processor (vendor) must be assigned before issuing" };
  }
  if (!j.sent_qty || j.sent_qty <= 0) {
    return { ok: false, error: "Sent quantity must be greater than 0 before issuing" };
  }

  const { error } = await supabase
    .from("process_jobs")
    .update({ status: "issued" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidateProcess(id);
  return { ok: true };
}

// ---------- recordReceipt ----------

/** Record a partial or final receipt against a process job. */
export async function recordReceipt(
  payload: ProcessReceiptInput,
): Promise<ActionResult> {
  if (!(await can("process_planning", "edit"))) throw new Error("Forbidden");

  const parsed = processReceiptInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { process_job_id, received_date, received_qty, good_qty, rejected_qty, quality_status, quality_notes } =
    parsed.data;

  const supabase = await createClient();

  // Fetch the job for sent_qty and existing receipts total
  const { data: job, error: jobErr } = await supabase
    .from("process_jobs")
    .select("id, status, sent_qty, item_id")
    .eq("id", process_job_id)
    .single();

  if (jobErr || !job) return { ok: false, error: "Job not found" };

  const j = job as {
    id: string;
    status: ProcessJobStatus;
    sent_qty: number;
    item_id: string | null;
  };

  if (j.status === "closed") {
    return { ok: false, error: "Cannot record receipt on a closed job" };
  }

  // Sum all prior receipts to compute cumulative total after this one
  const { data: priorRows } = await supabase
    .from("process_job_receipts")
    .select("received_qty")
    .eq("process_job_id", process_job_id);

  const priorTotal = ((priorRows ?? []) as { received_qty: number }[]).reduce(
    (sum, r) => sum + (r.received_qty ?? 0),
    0,
  );

  const cumulativeReceived = priorTotal + (received_qty ?? 0);
  const loss_qty = processLoss(j.sent_qty, cumulativeReceived);

  const user = await getAppUser();

  // Insert the receipt
  const { error: receiptErr } = await supabase.from("process_job_receipts").insert({
    process_job_id,
    received_date: received_date ?? new Date().toISOString().split("T")[0],
    received_qty: received_qty ?? 0,
    good_qty: good_qty ?? 0,
    rejected_qty: rejected_qty ?? 0,
    loss_qty,
    quality_status,
    quality_notes: quality_notes ?? null,
    created_by: user?.id ?? null,
  });

  if (receiptErr) return { ok: false, error: receiptErr.message };

  // Determine new job status based on cumulative received vs sent
  const newStatus: ProcessJobStatus =
    cumulativeReceived >= j.sent_qty ? "received" : "in_process";

  const { error: updateErr } = await supabase
    .from("process_jobs")
    .update({ status: newStatus })
    .eq("id", process_job_id);

  if (updateErr) return { ok: false, error: updateErr.message };

  await writeAudit({
    action: "process_job.receipt_recorded",
    entityType: "process_job",
    entityId: process_job_id,
    metadata: { received_qty, good_qty, rejected_qty, quality_status, loss_qty, new_status: newStatus },
  });

  // Process receipt → stock-in: good fabric returns to the Processing store.
  // Privileged client (process planners lack per-store access). Best-effort: a
  // stock-in hiccup must not fail the receipt. Needs the job mapped to an item.
  if ((good_qty ?? 0) > 0 && j.item_id) {
    try {
      const admin = createAdminClient();
      const { data: store } = await admin
        .from("stores")
        .select("id")
        .eq("store_type", "processing")
        .limit(1)
        .maybeSingle();
      const storeId = (store as { id: string } | null)?.id;
      if (storeId) {
        await admin.from("stock_ledger").insert({
          store_id: storeId,
          item_id: j.item_id,
          movement_type: "receipt",
          quantity: good_qty,
          reference_type: "process_job",
          reference_id: process_job_id,
          note: "Process return stock-in",
          created_by: user?.id ?? null,
        });
        revalidatePath("/stores");
      }
    } catch {
      // best-effort stock-in
    }
  }

  revalidateProcess(process_job_id);
  return { ok: true };
}

// ---------- closeJob ----------

/** Close a received job. */
export async function closeJob(id: string): Promise<ActionResult> {
  if (!(await can("process_planning", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: job, error: fetchErr } = await supabase
    .from("process_jobs")
    .select("id, status")
    .eq("id", id)
    .single();

  if (fetchErr || !job) return { ok: false, error: "Job not found" };

  const j = job as { id: string; status: string };
  if (j.status !== "received") {
    return { ok: false, error: "Only received jobs can be closed" };
  }

  const { error } = await supabase
    .from("process_jobs")
    .update({ status: "closed" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidateProcess(id);
  return { ok: true };
}
