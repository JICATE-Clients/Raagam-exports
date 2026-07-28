"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";

export function CompletionForm() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [uptoDate, setUptoDate] = useState("");
  const [notes, setNotes] = useState("");

  useUnsavedGuard(open && isPending);

  function reset() {
    setUptoDate("");
    setNotes("");
    setOpen(false);
  }

  function handleSubmit() {
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.from("po_completions").insert({
        completion_type: "PO",
        upto_date: uptoDate || null,
        notes: notes.trim() || null,
      });
      if (error) {
        toastError(error.message);
      } else {
        // mark all approved/partially_received POs up to date as closed
        if (uptoDate) {
          await supabase
            .from("purchase_orders")
            .update({ status: "closed" })
            .in("status", ["approved", "partially_received"])
            .lte("order_date", uptoDate);
        }
        success("PO completion recorded. Matching POs closed.");
        reset();
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Complete POs</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Complete Purchase Orders">
        <div className="space-y-4 p-4">
          <div>
            <Label>Complete POs up to date</Label>
            <Input type="date" value={uptoDate} onChange={(e) => setUptoDate(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for completion..." />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button disabled={isPending} onClick={handleSubmit}>
              {isPending ? "Completing..." : "Complete"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
