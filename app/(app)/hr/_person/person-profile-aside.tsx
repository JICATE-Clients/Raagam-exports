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
      {/*
        A PROFILE CARD THAT POPS, AND STAYS NEAT (client 2026-09-16: "top card
        still not popping up ... i want them pop up yet neat").

        A flat tint was not enough, and the reason is in the skin: `[data-skin]`
        sets every card's border transparent, so a soft fill had nothing to hold
        it. What reads as depth here is a BAND of real colour with the avatar
        crossing it — the shape a profile card has everywhere — rather than a
        louder fill behind the whole card.

        The band is a gradient between the two BRAND tokens, so it follows the
        theme instead of being a pair of hex values, and it carries no text: a
        gradient under type is where contrast goes wrong. The avatar sits in a
        4px ring of the card's own surface, which is what makes it read as
        raised rather than pasted on.
      */}
      <Card className="overflow-hidden">
        <div
          aria-hidden
          className="h-14"
          style={{
            backgroundImage:
              "linear-gradient(120deg, var(--primary), var(--accent))",
          }}
        />
        <CardBody className="space-y-3 pt-0">
          <div className="-mt-10 flex flex-col items-center gap-2 text-center">
            {/* 80px, down from 112. The column is fixed at 288px and holds
                two cards; at 112 plus its own preview the Personal Info heading
                sat below the fold on a laptop (client 2026-09-16: "bottom card
                heading only showing in fit screen"). */}
            {p.photoUrl ? (
              <div className="h-20 w-20 overflow-hidden rounded-2xl ring-4 ring-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL, same as PhotoUpload's own preview. */}
                <img
                  src={p.photoUrl}
                  alt={`Photo of ${title}`}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-2xl bg-primary-soft text-2xl font-bold text-primary ring-4 ring-surface">
                {initials(p.name) ? (
                  <span aria-hidden>{initials(p.name)}</span>
                ) : (
                  <UserRound aria-hidden className="h-9 w-9" />
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
            {/* `showPreview={false}`: the avatar above IS the preview, so the
                control contributes only its buttons and the size hint. */}
            <PhotoUpload
              value={p.photoUrl}
              onChange={p.onPhotoChange}
              folder={p.photoFolder}
              showPreview={false}
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
          {/* A COLOUR PER ROW, on the chip only. The eye finds "Phone" by its
              chip rather than by reading down the labels, and the text stays in
              ink — a coloured label would trade legibility for the same cue.
              Four brand tints cycle; `--danger` and `--warning` are deliberately
              not among them, because those mean a STATE elsewhere in this app
              and a red chip beside a blood group would read as a problem. */}
          <ul className="space-y-3">
            {personal.map(([Icon, label, value], i) => (
              <li key={label} className="flex items-start gap-3">
                <span
                  className={
                    [
                      "bg-primary-soft text-primary",
                      "bg-accent-soft text-accent",
                      "bg-info-soft text-info",
                      "bg-success-soft text-success",
                    ][i % 4] +
                    " grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                  }
                >
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
