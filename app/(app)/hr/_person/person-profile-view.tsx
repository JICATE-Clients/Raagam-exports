"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  Cake,
  ChevronLeft,
  ChevronRight,
  Droplets,
  FileText,
  HeartHandshake,
  Mail,
  MapPin,
  Pencil,
  Phone,
  UserRound,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getPersonChildren } from "./person-children";
import { initials } from "./person-profile-aside";
import type { PersonKind } from "@/lib/hr/types";

/**
 * THE EMPLOYEE DETAILS PAGE — the TeamHub "Employee Details" screen the client
 * sent, built from the fields a Raagam staff / worker record actually holds
 * (client 2026-09-15: "i want it exactly like it but with the current content
 * we have now in this raagam").
 *
 * ## A VIEW, NOT THE EDITOR
 *
 * The template is a read screen: a profile column, tiles, charts, a calendar
 * and a payroll summary. A record with ~150 fields cannot be TYPED into a bento
 * of cards — the section rail, the required holds and the keyboard contract
 * all live in the editor. So a row now opens here first, and "Edit" opens the
 * editor exactly as before. A NEW record still goes straight to the editor:
 * there is nothing yet to look at.
 *
 * ## EVERY CARD MAPS A TEMPLATE CARD TO REAL DATA
 *
 *   template                    here
 *   ─────────────────────────   ─────────────────────────────────────────────
 *   profile card                photo, name, designation · department, ID, status
 *   personal info               gender, DOB, e-mail, phone, address, blood group
 *   four leave rings            four COMPLETENESS rings — how much of Detail,
 *                               Salary Registry, Bank and General is filled in
 *   performance overview        pay structure: actual vs statutory, per head
 *   hours logged                work experience: years at each past employer
 *   documents                   the ID and document numbers on file
 *   internal notes              family members and emergency contacts
 *   calendar                    the record's key dates, marked on a month
 *   payroll summary             salary summary: heads, statutory, bank, total
 *
 * Nothing is invented. Leave, attendance and performance have no data behind a
 * person record yet, and a ring over an empty table shows a zero that reads as
 * a real figure — so those tiles carry the one number this record CAN answer:
 * what is still missing, which is the same question the Salary Registry and
 * Bank Details worklists exist for.
 *
 * ## CHART CHOICES (dataviz method)
 *
 * - Pay structure is EMPHASIS, not two categorical hues: Actual in brand blue,
 *   Statutory in de-emphasis gray. Blue + teal as a categorical pair FAILS the
 *   normal-vision floor (ΔE 12.1 < 15, `validate_palette.js`), and the story is
 *   "what is actually paid" with statutory as context. The gray mark is below
 *   3:1 on the surface, which the method permits only with a table view — the
 *   Salary Summary card beside it lists every one of these figures.
 * - Experience is ONE series, so every bar is slot 1 (never a ramp by length).
 * - Rings are METERS: a same-ramp track (`--primary-soft`) under the fill.
 * - Figures use proportional digits; only the aligned amount column is tabular.
 *
 * ## DATES AND AMOUNTS
 *
 * `fmtDate` / `fmtMoney` only (AGENTS.md ▸ Dates). A zero amount shows "—", the
 * record editor's rule: a column default rendered as a figure reads as one
 * somebody entered.
 */

type Named = { id: string; name: string };
type Row = Record<string, unknown>;

type Children = Awaited<ReturnType<typeof getPersonChildren>>;

const str = (r: Row, k: string) => {
  const v = r[k];
  return typeof v === "string" && v.trim() ? v : null;
};
const num = (r: Row, k: string) => {
  const v = Number(r[k] ?? 0);
  return Number.isFinite(v) ? v : 0;
};
const nameOf = (list: Named[], id: string | null) =>
  id ? (list.find((o) => o.id === id)?.name ?? null) : null;

/** Whole years between two ISO dates (DOB -> today). */
function yearsBetween(from: string, to = new Date()): number {
  const d = new Date(from);
  let y = to.getFullYear() - d.getFullYear();
  const beforeBirthday =
    to.getMonth() < d.getMonth() ||
    (to.getMonth() === d.getMonth() && to.getDate() < d.getDate());
  if (beforeBirthday) y -= 1;
  return y;
}

/** Fractional years between two ISO dates, for experience bars. */
function spanYears(from: string, to: string | null): number {
  const a = new Date(from).getTime();
  const b = to ? new Date(to).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round(((b - a) / (365.25 * 24 * 3600 * 1000)) * 10) / 10;
}

const filled = (v: unknown) =>
  v !== null &&
  v !== undefined &&
  !(typeof v === "string" && !v.trim()) &&
  !(typeof v === "number" && v === 0);

export function PersonProfileView({
  kind,
  entity,
  row,
  designations,
  departments,
  locations,
  categories,
  divisions,
  banks,
  onBack,
  onEdit,
}: {
  kind: PersonKind;
  entity: string;
  row: Row & { id: string };
  designations: Named[];
  departments: Named[];
  locations: Named[];
  categories: Named[];
  divisions: Named[];
  banks: Named[];
  onBack: () => void;
  onEdit: () => void;
}) {
  /**
   * The child lists load when the page opens, as they do for the editor.
   * `children` starts null and is only ever SET from the promise, never
   * synchronously in the effect — the parent mounts this with `key={row.id}`,
   * so a different person is a fresh mount rather than a reset.
   */
  const [children, setChildren] = useState<Children | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getPersonChildren(kind, row.id)
      .then((c) => {
        if (live) setChildren(c);
      })
      .catch((e: unknown) => {
        if (live)
          setLoadError(
            e instanceof Error ? e.message : "Could not load details.",
          );
      });
    return () => {
      live = false;
    };
  }, [kind, row.id]);

  const name = str(row, "name") ?? "";
  const photo = str(row, "photo_url");
  const code = str(row, "code");
  const isActive = row.is_active !== false;
  const designation = nameOf(designations, str(row, "designation_id"));
  const department = nameOf(departments, str(row, "department_id"));
  const dob = str(row, "date_of_birth");
  const joined = str(row, "joined_date");

  const accounts = (children?.bankAccounts ?? []) as unknown as Row[];
  const account = accounts.find((a) => str(a, "ac_no")) ?? accounts[0] ?? null;

  /* ---- completeness rings ------------------------------------------------ */
  const rings = useMemo(() => {
    const count = (keys: string[], source: Row | null = row) => ({
      done: keys.filter((k) => filled(source?.[k])).length,
      total: keys.length,
    });
    return [
      {
        label: "Detail",
        ...count([
          "name",
          "designation_id",
          "category_id",
          "department_id",
          "location_id",
          "division_id",
          "guardian_name",
          "mother_name",
          "photo_url",
        ]),
      },
      {
        label: "Salary Registry",
        ...count([
          "stat_gross",
          "stat_basic",
          "stat_da",
          "stat_hra",
          "act_gross",
          "act_basic",
          "act_da",
          "act_hra",
          "esi_no",
          "pf_no",
        ]),
      },
      {
        label: "Bank Account",
        ...count(
          ["bank_id", "branch", "ac_type", "ac_no", "ifsc_code"],
          account,
        ),
      },
      {
        label: "General",
        ...count([
          "perm_address1",
          "perm_city",
          "perm_pin",
          "perm_phone",
          "email",
          "qualification",
          "blood_group",
          "gender",
          "marital_status",
          "aadhaar_no",
        ]),
      },
    ];
  }, [row, account]);

  /* ---- pay structure ----------------------------------------------------- */
  const pay = useMemo(() => {
    const heads = (p: "stat" | "act") => {
      const gross = num(row, `${p}_gross`);
      const basic = num(row, `${p}_basic`);
      const da = num(row, `${p}_da`);
      const hra = num(row, `${p}_hra`);
      return {
        gross,
        basic,
        da,
        hra,
        others: Math.max(0, gross - basic - da - hra),
      };
    };
    const stat = heads("stat");
    const act = heads("act");
    return {
      stat,
      act,
      data: (["basic", "da", "hra", "others"] as const).map((k) => ({
        head: { basic: "Basic", da: "DA", hra: "HRA", others: "Others" }[k],
        Actual: act[k],
        Statutory: stat[k],
      })),
      empty: stat.gross === 0 && act.gross === 0,
    };
  }, [row]);

  /* ---- experience -------------------------------------------------------- */
  const experience = useMemo(() => {
    const rows = ((children?.experience ?? []) as unknown as Row[])
      .map((e) => ({
        company: str(e, "company_name") ?? "—",
        designation: str(e, "designation"),
        from: str(e, "exp_from"),
        to: str(e, "exp_to"),
      }))
      .filter((e) => e.from)
      .map((e) => ({ ...e, years: spanYears(e.from!, e.to) }));
    return {
      rows,
      total: Math.round(rows.reduce((s, r) => s + r.years, 0) * 10) / 10,
    };
  }, [children]);

  /* ---- documents --------------------------------------------------------- */
  const documents: [string, string | null, string | null][] = [
    ["Aadhaar", str(row, "aadhaar_no"), null],
    ["PAN", str(row, "pan_no"), null],
    ["Driving Licence", str(row, "driving_licence_no"), null],
    [
      "Passport",
      str(row, "passport_no"),
      str(row, "passport_valid_upto")
        ? `Valid upto ${fmtDate(str(row, "passport_valid_upto"))}`
        : null,
    ],
    ["Ration Card", str(row, "ration_card_no"), null],
    ["Election Card", str(row, "election_card_no"), null],
    ["Passbook", str(row, "passbook_no"), null],
    ["Insurance Policy", str(row, "insurance_policy_no"), null],
    ["UAN", str(row, "uan_no"), null],
  ];
  const docsOnFile = documents.filter(([, v]) => v).length;

  /* ---- key dates --------------------------------------------------------- */
  const keyDates = [
    ["Joined", joined],
    ["Probation", str(row, "date_of_probation")],
    ["Confirmation", str(row, "date_of_confirmation")],
    ["ESI joining", str(row, "esi_date_of_joining")],
    ["PF joining", str(row, "pf_date_of_joining")],
    ["Interview", str(row, "interview_date")],
    ["Passport expiry", str(row, "passport_valid_upto")],
    ["Leaving", str(row, "date_of_leaving")],
  ]
    .filter((d): d is [string, string] => !!d[1])
    .sort((a, b) => a[1].localeCompare(b[1]));

  /* ---- family & contacts ------------------------------------------------- */
  const people = [
    ...((children?.family ?? []) as unknown as Row[]).map((f) => ({
      name: str(f, "name") ?? "—",
      line: [
        str(f, "relation"),
        str(f, "date_of_birth")
          ? `${yearsBetween(str(f, "date_of_birth")!)} yrs`
          : f.stated_age
            ? `${f.stated_age} yrs`
            : null,
        f.alive === false ? "Deceased" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      tag: "Family",
    })),
    ...((children?.emergencyContacts ?? []) as unknown as Row[]).map((c) => ({
      name: str(c, "name") ?? "—",
      line: [str(c, "relation"), str(c, "mobile") ?? str(c, "phone")]
        .filter(Boolean)
        .join(" · "),
      tag: "Emergency contact",
    })),
  ];

  const address = [
    str(row, "perm_address1"),
    str(row, "perm_address2"),
    str(row, "perm_address3"),
    [str(row, "perm_city"), str(row, "perm_pin")].filter(Boolean).join(" - "),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-4">
      {/* ── page header: back, title, breadcrumb, edit ─────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          aria-label="Back to list"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {entity} Details
          </h1>
          <p className="text-xs text-muted-foreground">
            HR &amp; Payroll / {entity === "Staff" ? "Staff" : "Workers"} /{" "}
            <span className="text-foreground">{entity} Details</span>
          </p>
        </div>
        <Button size="md" onClick={onEdit}>
          <Pencil className="mr-1.5 h-4 w-4" />
          Edit {entity.toLowerCase()}
        </Button>
      </div>

      {loadError && (
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-danger">
          {loadError}
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-12">
        {/* ═══ LEFT — profile + personal info ═══════════════════════════ */}
        <div className="space-y-4 xl:col-span-3">
          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-col items-center gap-3 pt-2 text-center">
                <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-2xl border border-border bg-primary-soft text-3xl font-bold text-primary">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL, same as PhotoUpload's own preview.
                    <img
                      src={photo}
                      alt={`Photo of ${name}`}
                      className="h-full w-full object-cover"
                    />
                  ) : initials(name) ? (
                    <span aria-hidden>{initials(name)}</span>
                  ) : (
                    <UserRound aria-hidden className="h-12 w-12" />
                  )}
                </div>
                <div className="w-full min-w-0">
                  <Truncated
                    text={name || "—"}
                    className="block text-lg font-bold text-foreground"
                  />
                  <Truncated
                    text={
                      [designation, department].filter(Boolean).join(" · ") ||
                      entity
                    }
                    className="block text-xs text-muted-foreground"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {code && (
                    <span className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                      ID {code}
                    </span>
                  )}
                  <StatusPill tone={isActive ? "success" : "neutral"}>
                    {isActive ? "Active" : "Inactive"}
                  </StatusPill>
                </div>
              </div>

              <dl className="divide-y divide-border rounded-lg border border-border">
                {(
                  [
                    ["Employment Type", str(row, "employment_type")],
                    ["Pay Frequency", str(row, "pay_frequency")],
                    ["Join Date", joined ? fmtDate(joined) : null],
                    ["Location", nameOf(locations, str(row, "location_id"))],
                    ["Category", nameOf(categories, str(row, "category_id"))],
                    ["Division", nameOf(divisions, str(row, "division_id"))],
                  ] as [string, string | null][]
                ).map(([label, value]) => (
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
                {(
                  [
                    [UserRound, "Gender", str(row, "gender")],
                    [
                      Cake,
                      "Date of Birth",
                      dob ? `${fmtDate(dob)} (${yearsBetween(dob)} yrs)` : null,
                    ],
                    [Mail, "E-Mail", str(row, "email")],
                    [Phone, "Phone", str(row, "perm_phone")],
                    [MapPin, "Address", address || null],
                    [Droplets, "Blood Group", str(row, "blood_group")],
                    [
                      HeartHandshake,
                      "Marital Status",
                      str(row, "marital_status"),
                    ],
                  ] as [typeof Mail, string, string | null][]
                ).map(([Icon, label, value]) => (
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
        </div>

        {/* ═══ MIDDLE — rings, pay, experience, documents, people ════════ */}
        <div className="space-y-4 xl:col-span-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {rings.map((r) => (
              <Card key={r.label}>
                <CardBody className="flex flex-col items-center gap-2 text-center">
                  <div className="text-xs font-semibold text-muted-foreground">
                    {r.label}
                  </div>
                  <Ring done={r.done} total={r.total} />
                  <div className="text-[11px] text-muted-foreground">
                    fields filled
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Pay Structure
                  </h2>
                  <div className="text-3xl font-bold text-foreground">
                    {pay.act.gross ? fmtMoney(pay.act.gross) : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Actual gross per month
                    {pay.stat.gross
                      ? ` · statutory ${fmtMoney(pay.stat.gross)}`
                      : ""}
                  </div>
                </div>
              </div>
              {pay.empty ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No pay heads entered yet.
                </p>
              ) : (
                <div
                  className="h-64"
                  role="img"
                  aria-label="Actual and statutory pay by head; the same figures are listed in Salary Summary."
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={pay.data}
                      barGap={2}
                      margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="head"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        stroke="var(--border)"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        stroke="var(--border)"
                        width={64}
                        tickFormatter={(v: number) =>
                          v >= 1000 ? `${Math.round(v / 1000)}K` : String(v)
                        }
                      />
                      <Tooltip
                        cursor={{ fill: "var(--surface-muted)" }}
                        formatter={(v) => fmtMoney(Number(v))}
                        contentStyle={{
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "var(--foreground)",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        dataKey="Actual"
                        fill="var(--primary)"
                        maxBarSize={24}
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="Statutory"
                        fill="var(--border-strong)"
                        maxBarSize={24}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Briefcase aria-hidden className="h-4 w-4 text-primary" />
                    Work Experience
                  </h2>
                  {experience.total > 0 && (
                    <span className="text-xs font-semibold text-foreground">
                      {experience.total} yrs total
                    </span>
                  )}
                </div>
                {!children ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Loading…
                  </p>
                ) : experience.rows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No previous employment with dates.
                  </p>
                ) : (
                  <div style={{ height: 32 * experience.rows.length + 40 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={experience.rows}
                        layout="vertical"
                        margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          horizontal={false}
                          stroke="var(--border)"
                        />
                        <XAxis
                          type="number"
                          tick={{
                            fontSize: 11,
                            fill: "var(--muted-foreground)",
                          }}
                          stroke="var(--border)"
                          unit=" y"
                        />
                        <YAxis
                          type="category"
                          dataKey="company"
                          width={96}
                          tick={{
                            fontSize: 11,
                            fill: "var(--muted-foreground)",
                          }}
                          stroke="var(--border)"
                        />
                        <Tooltip
                          cursor={{ fill: "var(--surface-muted)" }}
                          formatter={(v) => [`${v} yrs`, "Duration"]}
                          contentStyle={{
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            fontSize: 12,
                            color: "var(--foreground)",
                          }}
                        />
                        <Bar
                          dataKey="years"
                          fill="var(--primary)"
                          maxBarSize={16}
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    Documents
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {docsOnFile} of {documents.length} on file
                  </span>
                </div>
                <ul className="space-y-2">
                  {documents.map(([label, value, note]) => (
                    <li key={label} className="flex items-center gap-3">
                      <span
                        className={
                          value
                            ? "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"
                            : "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted-foreground"
                        }
                      >
                        <FileText aria-hidden className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-foreground">
                          {label}
                        </div>
                        <Truncated
                          text={
                            value
                              ? [value, note].filter(Boolean).join(" · ")
                              : "Not provided"
                          }
                          className="block text-[11px] text-muted-foreground"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardBody className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Users aria-hidden className="h-4 w-4 text-primary" />
                Family &amp; Emergency Contacts
              </h2>
              {!children ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Loading…
                </p>
              ) : people.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No family members or emergency contacts recorded.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {people.map((p, i) => (
                    <div
                      key={`${p.tag}-${i}`}
                      className="rounded-lg border border-border bg-primary-soft p-3"
                    >
                      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-primary">
                        {p.tag}
                      </div>
                      <Truncated
                        text={p.name}
                        className="block text-sm font-semibold text-foreground"
                      />
                      <Truncated
                        text={p.line || "—"}
                        className="block text-xs text-muted-foreground"
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ═══ RIGHT — key dates calendar + salary summary ═══════════════ */}
        <div className="space-y-4 xl:col-span-3">
          <Card>
            <CardBody>
              <KeyDatesCalendar dates={keyDates} />
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">
                Salary Summary
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Description</th>
                    <th className="pb-2 text-right font-medium">
                      Amount / Month
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_td]:py-1.5">
                  <SummaryGroup title="Pay — Actual" />
                  <SummaryRow label="Basic" value={pay.act.basic} />
                  <SummaryRow label="DA" value={pay.act.da} />
                  <SummaryRow label="HRA" value={pay.act.hra} />
                  <SummaryRow label="Others" value={pay.act.others} />
                  <SummaryGroup title="Pay — Statutory" />
                  <SummaryRow label="Gross" value={pay.stat.gross} />
                  <SummaryGroup title="Statutory" />
                  <SummaryText
                    label="ESI"
                    value={[str(row, "esi_status"), str(row, "esi_no")]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <SummaryText
                    label="PF"
                    value={[str(row, "pf_status"), str(row, "pf_no")]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <SummaryGroup title="Paid to" />
                  <SummaryText label="Pay Mode" value={str(row, "pay_mode")} />
                  <SummaryText
                    label="Bank"
                    value={
                      account ? nameOf(banks, str(account, "bank_id")) : null
                    }
                  />
                  <SummaryText
                    label="A/c No"
                    value={account ? str(account, "ac_no") : null}
                  />
                  <tr className="border-t border-border">
                    <td className="pt-2 font-semibold text-foreground">
                      Total Monthly Value
                    </td>
                    <td className="pt-2 text-right font-bold tabular-nums text-foreground">
                      {pay.act.gross ? fmtMoney(pay.act.gross) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** A completeness meter: same-ramp track, brand fill, fraction in the middle. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div className="relative h-20 w-20">
      <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" aria-hidden>
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--primary-soft)"
          strokeWidth="8"
        />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <div
        className="absolute inset-0 grid place-items-center"
        aria-label={`${done} of ${total} fields filled`}
      >
        <span className="text-base font-bold text-foreground">
          {done}
          <span className="text-xs font-medium text-muted-foreground">
            /{total}
          </span>
        </span>
      </div>
    </div>
  );
}

function SummaryGroup({ title }: { title: string }) {
  return (
    <tr>
      <td
        colSpan={2}
        className="pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {title}
      </td>
    </tr>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td className="text-foreground">{label}</td>
      <td className="text-right tabular-nums text-foreground">
        {value ? fmtMoney(value) : "—"}
      </td>
    </tr>
  );
}

function SummaryText({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <tr>
      <td className="text-foreground">{label}</td>
      <td className="max-w-[9rem] text-right">
        <Truncated text={value || "—"} className="block text-foreground" />
      </td>
    </tr>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * THE TEMPLATE'S CALENDAR, holding the record's own dates. Opens on the month
 * of the first key date (usually joining), since the current month rarely
 * holds one; the arrows walk months, and the list beneath names every date so
 * the calendar is never the only way to read one.
 */
function KeyDatesCalendar({ dates }: { dates: [string, string][] }) {
  const first = dates[0]?.[1];
  const start = first ? new Date(first) : new Date();
  const [cursor, setCursor] = useState({
    y: start.getFullYear(),
    m: start.getMonth(),
  });

  const marked = new Map<string, string[]>();
  for (const [label, iso] of dates) {
    const key = iso.slice(0, 10);
    marked.set(key, [...(marked.get(key) ?? []), label]);
  }

  const firstDay = new Date(cursor.y, cursor.m, 1);
  const lead = (firstDay.getDay() + 6) % 7; // Monday-first
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  const today = new Date();
  const iso = (d: number) =>
    `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const step = (delta: number) =>
    setCursor(({ y, m }) => {
      const n = new Date(y, m + delta, 1);
      return { y: n.getFullYear(), m: n.getMonth() };
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {MONTHS[cursor.m]} {cursor.y}
        </h2>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => step(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => step(1)}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="py-1 font-semibold text-muted-foreground">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />;
          const labels = marked.get(iso(d));
          const isToday =
            d === today.getDate() &&
            cursor.m === today.getMonth() &&
            cursor.y === today.getFullYear();
          return (
            <div
              key={i}
              title={labels?.join(", ")}
              className={
                labels
                  ? "grid h-7 place-items-center rounded-md bg-primary font-semibold text-white"
                  : isToday
                    ? "grid h-7 place-items-center rounded-md border border-primary text-foreground"
                    : "grid h-7 place-items-center rounded-md text-foreground"
              }
            >
              {d}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border pt-3">
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          Key dates
        </div>
        {dates.length === 0 ? (
          <p className="text-xs text-muted-foreground">No dates recorded.</p>
        ) : (
          <ul className="space-y-1.5">
            {dates.map(([label, value]) => (
              <li
                key={label}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex items-center gap-2 text-foreground">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full bg-primary"
                  />
                  {label}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {fmtDate(value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
