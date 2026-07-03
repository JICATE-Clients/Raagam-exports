import { z } from "zod";

export type NotificationType = "info" | "success" | "warning" | "danger";

/** A row from public.notifications. */
export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  href: string | null;
  type: NotificationType;
  read_at: string | null;
  created_at: string;
}

export const notificationInput = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  href: z.string().optional(),
  type: z.enum(["info", "success", "warning", "danger"]).optional(),
});
export type NotificationInput = z.infer<typeof notificationInput>;
