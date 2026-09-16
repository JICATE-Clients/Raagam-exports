"use client";

import { Cake, Droplets, Mail, MapPin, Phone, UserRound } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { PhotoUpload } from "@/components/ui/photo-upload";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate } from "@/lib/format";

/** "MIA TORRES" -> "MT"; one word -> its first letter; blank -> "". */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export type PersonProfileAsideProps = {
  entity: string;
  isEditing: boolean;
  code: string | null;
  name: string;
  isActive: boolean;
  photoUrl: string | null;
  onPhotoChange: (url: string | null) => void;
  photoFolder: string;
  designation: string | null;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  joinedDate: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  bloodGroup: string | null;
};

/**
 * THE PROFILE COLUMN — the TeamHub employee card, standing to the RIGHT of the
 * section rail and its pane (client 2026-09-15: "i want the left side rail
 * back ... what is left can go to the right side, so that remaining can be in
 * center").
 *
 * Three columns, then: the rail (which section), the pane (its fields), and
 * this (who the record is). It is LIVE — it reads the form as typed, so the
 * operator sees the record take shape — and it holds exactly one control, the
 * photo, because the template puts the picture in the profile and a second
 * photo control among the fields would be two ways to set one value.
 *
 * `data-focus-region="header"`: chrome, not fields. Without it `regionOf`
 * (lib/focus.ts) would sort the Upload button as a CONTENT field and Tab off a
 * section's last field could land on it instead of wrapping.
 */
export function PersonProfileAside(p: PersonProfileAsideProps) {
  const title = p.name.trim() || `New ${p.entity}`;
  const role = [p.designation, p.department].filter(Boolean).join(" · ");

  const personal: [typeof Mail, string, string | null][] = [
    [UserRound, "Gender", p.gender],
    [Cake, "Date of Birth", p.dateOfBirth ? fmtDate(p.dateOfBirth) : null],
    [Mail, "E-Mail", p.email],
    [Phone, "Phone", p.phone],
    [MapPin, "Address", p.address],
    [Droplets, "Blood Group", p.bloodGroup],
  ];
  const facts: [string, string | null][] = [
    ["Employment Type", p.employmentType],
    ["Location", p.location],
    ["Join Date", p.joinedDate ? fmtDate(p.joinedDate) : null],
  ];

  return (
    <aside
      data-focus-region="header"
      className="scrollbar-none w-72 shrink-0 space-y-4 overflow-y-auto"
    >
      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-col items-center gap-3 text-center">
            {p.photoUrl ? (
              <div className="h-28 w-28 overflow-hidden rounded-2xl border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL, same as PhotoUpload's own preview. */}
                <img
                  src={p.photoUrl}
                  alt={`Photo of ${title}`}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="grid h-28 w-28 place-items-center rounded-2xl border border-border bg-primary-soft text-3xl font-bold text-primary">
                {initials(p.name) ? (
                  <span aria-hidden>{initials(p.name)}</span>
                ) : (
                  <UserRound aria-hidden className="h-12 w-12" />
                )}
              </div>
            )}
            <div className="w-full min-w-0">
              <Truncated
                text={title}
                className="block text-lg font-bold text-foreground"
              />
              <Truncated
                text={role || p.entity}
                className="block text-xs text-muted-foreground"
              />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {p.code && (
                <span className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                  ID {p.code}
                </span>
              )}
              {p.isEditing ? (
                <StatusPill tone={p.isActive ? "success" : "neutral"}>
                  {p.isActive ? "Active" : "Inactive"}
                </StatusPill>
              ) : (
                <StatusPill tone="info">New</StatusPill>
              )}
            </div>
            <PhotoUpload
              value={p.photoUrl}
              onChange={p.onPhotoChange}
              folder={p.photoFolder}
            />
          </div>

          <dl className="divide-y divide-border rounded-lg border border-border">
            {facts.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <dt className="shrink-0 text-xs text-muted-foreground">
                  {label}
                </dt>
                <dd className="m-0 min-w-0 text-right">
                  <Truncated
                    text={value ?? "—"}
                    className="block text-xs font-semibold text-foreground"
                  />
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Personal Info
          </h2>
          <ul className="space-y-3">
            {personal.map(([Icon, label, value]) => (
              <li key={label} className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                  <Icon aria-hidden className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-muted-foreground">
                    {label}
                  </div>
                  <div className="break-words text-sm font-medium text-foreground">
                    {value ?? "—"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </aside>
  );
}
