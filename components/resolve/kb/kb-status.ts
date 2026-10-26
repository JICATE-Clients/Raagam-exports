import { statusTone, type StatusToneOverrides } from "@/lib/ui/status-tone";

/**
 * An article's PUBLISHED is its working state — requesters are being shown it
 * — so it reads success, where the shared table has no word for it. Draft
 * (no claim yet) and retired (set aside) are the shared table's neutral.
 */
const KB_TONES: StatusToneOverrides = { published: "success", retired: "neutral" };

export function kbStatusTone(status: string | null | undefined) {
  return statusTone(status, KB_TONES);
}
