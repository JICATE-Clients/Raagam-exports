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
  /** 0673: which declared alert this is — gives the row its module. */
  event_key?: string | null;
  /** 0814: who raised it, copied at send time (null = a sweep or a job). */
  actor_id?: string | null;
  actor_name?: string | null;
  actor_photo?: string | null;
}

export const notificationInput = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  href: z.string().optional(),
  type: z.enum(["info", "success", "warning", "danger"]).optional(),
});
export type NotificationInput = z.infer<typeof notificationInput>;
