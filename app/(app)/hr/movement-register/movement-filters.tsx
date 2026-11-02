"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/segmented";

export type Who = "all" | "staff" | "worker";

type Values = { from: string; to: string; who: Who; dept: string; q: string };

/**
 * The register's filters live in the URL, so a day and department can be
 * bookmarked or sent to someone. Every filter applies the moment it changes —
 * no Show button (user 2026-11-02: "there should be no show button, the filter
 * itself should work properly"); the search waits for a pause in typing so
 * each keystroke is not a server round trip.
 */
export function MovementFilters({
  from,
  to,
  who,
  dept,
  q,
  departments,
}: Values & { departments: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState<Values>({ from, to, who, dept, q });
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (next: Values) => {
    const p = new URLSearchParams();
    p.set("from", next.from);
    p.set("to", next.to < next.from ? next.from : next.to);
    if (next.who !== "all") p.set("who", next.who);
    if (next.dept) p.set("dept", next.dept);
    if (next.q.trim()) p.set("q", next.q.trim());
    startTransition(() => router.replace(`/hr/movement-register?${p}`, { scroll: false }));
  };

  // Typing a year into a date box passes through 0002, 0020, 0202 — each a
  // valid date. Only a whole year is worth a trip to the server.
  const whole = (d: string) => d >= "2000-01-01";

  const change = (patch: Partial<Values>, wait = 0) => {
    const next = { ...v, ...patch };
    // A From past To drags To along, so the range never reads backwards.
    if (patch.from && next.to < patch.from) next.to = patch.from;
    setV(next);
    if (typing.current) clearTimeout(typing.current);
    if (wait) typing.current = setTimeout(() => apply(next), wait);
    else apply(next);
  };

  return (
    <FieldRow className={pending ? "opacity-70" : undefined}>
      <Field label="From" w="range">
        <Input
          type="date"
          value={v.from}
          onChange={(e) => whole(e.target.value) && change({ from: e.target.value })}
        />
      </Field>
      <Field label="To" w="range">
        <Input
          type="date"
          value={v.to}
          min={v.from}
          onChange={(e) => whole(e.target.value) && change({ to: e.target.value })}
        />
      </Field>
      <Field label="Department" w="term">
        <Select value={v.dept} onChange={(e) => change({ dept: e.target.value })}>
          <option value="">All departments</option>
          {departments.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Search" w="term">
        <Input
          type="search"
          placeholder="Name, code or card no"
          value={v.q}
          onChange={(e) => change({ q: e.target.value }, 350)}
        />
      </Field>
      <ToggleGroup<Who>
        label="Group"
        value={v.who}
        onChange={(w) => change({ who: w })}
        options={[
          { value: "all", label: "All" },
          { value: "staff", label: "Staff" },
          { value: "worker", label: "Worker" },
        ]}
      />
    </FieldRow>
  );
}
