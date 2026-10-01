import type { NotificationEventDef, NotificationEventKey } from "./events";

/** Client-safe shapes for Administration ▸ System ▸ Notifications. */

export type DispatchStatus =
  | "delivered"
  | "fell_back"
  | "no_recipients"
  | "disabled"
  | "push_failed"
  | "recalled"
  | "error";

export const DISPATCH_STATUS_LABEL: Record<DispatchStatus, string> = {
  delivered: "Delivered",
  fell_back: "Went to admins",
  no_recipients: "Reached nobody",
  disabled: "Switched off",
  push_failed: "Push failed",
  recalled: "Taken back",
  error: "Error",
};

/** The filter values the Log accepts (`push_failed` is a filter AND a status). */
export const DISPATCH_STATUS_FILTERS: DispatchStatus[] = [
  "delivered",
  "fell_back",
  "no_recipients",
  "disabled",
  "push_failed",
  "recalled",
];

export type DispatchFilters = {
  event?: NotificationEventKey;
  status?: DispatchStatus;
  from?: string;
  to?: string;
  page?: number;
};

export type DispatchRow = {
  id: string;
  event_key: string;
  title: string;
  body: string | null;
  href: string | null;
  type: "info" | "success" | "warning" | "danger";
  target: Record<string, unknown> | null;
  primary_count: number;
  cc_count: number;
  recipient_count: number;
  fallback_used: boolean;
  suppressed: "disabled" | "no_recipients" | null;
  push_attempted: number;
  push_sent: number;
  push_failed: number;
  push_pruned: number;
  error: string | null;
  source: "action" | "cron" | "admin";
  created_at: string;
  recalled_at: string | null;
  status: DispatchStatus;
};

export type DispatchPage = { rows: DispatchRow[]; page: number; hasMore: boolean };

export type ReachablePerson = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  roles: string | null;
  device_count: number;
  last_push_ok_at: string | null;
};

export type NotificationDevice = {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  user_agent: string | null;
  created_at: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  last_error: string | null;
};

export type EventOverview = {
  key: NotificationEventKey;
  module: NotificationEventDef["module"];
  label: string;
  audience: string;
  mandatory: boolean;
  enabled: boolean;
  push: boolean;
  fallbackToAdmins: boolean;
  /** A fixed role this event goes to, and how many ACTIVE people hold it today. */
  staticRole: string | null;
  roleHolders: number | null;
  sent30: number;
  recipients30: number;
  fellBack30: number;
  reachedNobody30: number;
  disabled30: number;
  pushFailed30: number;
  lastSentAt: string | null;
  /** The administrator's CC (0673) — ADDED to "Goes to", never replacing it. */
  ccRoleIds: string[];
  ccUserIds: string[];
  updatedAt: string | null;
};

export type NotificationOverview = {
  plumbing: { key: string; label: string; ok: boolean; missing: string }[];
  people: ReachablePerson[];
  activeLogins: number;
  withDevice: number;
  events: EventOverview[];
  roles: { id: string; name: string }[];
};

/** How long alerts and the logs are kept (0677 `notification_settings`). */
export type Retention = { readDays: number; unreadDays: number; logDays: number; jobRunDays: number };

/** "Chrome on Windows" from a user-agent string — enough to tell two devices apart. */
export function deviceName(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone/iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown system";
  return `${browser} on ${os}`;
}
