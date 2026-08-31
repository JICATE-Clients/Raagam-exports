import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAppUser, can } from "@/lib/auth/server";
import { addDays, daysBetween, today } from "@/lib/calendar";

/**
 * The T&A daily worklist — "what does MY department owe today, on which order".
 *
 * ## Why this file exists at all
 *
 * The client's own diagnosis of why legacy T&A died: four screens captured a
 * schedule (TA Activities, Department Assign, TA Styles, TA Plans) and **nothing
 * ever read it back**, so nobody maintained it. The tab in Order Entry is the
 * write half; this is the read half, and without it the tab is the fifth screen
 * nobody fills in.
 *
 * So the worklist is deliberately shaped like an instruction, not a report. The
 * client's own example line is *"Today you must receive 500 kgs of Yarn for Order
 * Ref 12"* — a quantity, a material and an order reference. An activity name and
 * a date is what the legacy screens already showed.
 *
 * ## AN EMPTY WORKLIST IS THE DANGEROUS FAILURE, AND MOST OF THIS FILE IS ABOUT IT
 *
 * AGENTS.md states it for reports generally ("an empty REPORT is the dangerous
 * one … the failure is indistinguishable from a legitimate result, so it gets
 * believed rather than reported") and it is sharper here than anywhere else in
 * the app: "nothing due today" is a **real, ordinary, welcome answer**. A staff
 * member who sees it goes and does something else. There is no visible
 * difference between a quiet Tuesday and a query that scoped itself into
 * nothing, so nobody would ever report the bug.
 *
 * The rule this file follows, therefore: **every narrowing step reports what it
 * removed.** Draft orders, rows older than the backlog floor, rows belonging to
 * other departments, completed rows — each is counted as it is dropped and each
 * appears in `notes`. "Nothing due today" and "43 activities are scheduled, none
 * of them yours" render as visibly different screens. That is the whole design,
 * and `counts.scanned` is the number that makes it checkable: it is the row
 * count BEFORE any of the narrowing, so a zero worklist over a non-zero
 * `scanned` is self-diagnosing.
 *
 * ## "TODAY" IS LOCAL
 *
 * `today()` from `lib/calendar.ts` — the Asia/Kolkata calendar date, as a plain
 * `YYYY-MM-DD` compared against Postgres `date` columns. NOT
 * `toISOString().slice(0,10)`, which is UTC and reads a day behind for the first
 * 5.5 hours of every Tirupur day; this repo has shipped that bug twice and
 * `lib/calendar.ts`'s own header records it. Nothing here reformats those
 * strings — they are query values, not display values (`fmtDate` at the edge).
 *
 * ## Everything here READS. Nothing here invents a table.
 *
 * The department mapping is `ta_department_assigns` / `_lines` (0267), which
 * already exists and is already maintained on its own screen. `ta_activities`
 * (0035) carries a legacy free-text `department` beside it, and both are read —
 * with a stated precedence — rather than a third one being introduced. See
 * `activityDepartments()`.
 */

/* ------------------------------------------------------------------ *
 * Tunables — both are stated once, and both are shown to the operator
 * ------------------------------------------------------------------ */

/**
 * How far forward "upcoming" looks. Short on purpose: this is a worklist, not a
 * plan. The plan is the T&A tab on the order.
 */
export const HORIZON_DAYS = 7;

/**
 * How far back the backlog is scanned. Anything older is COUNTED and reported
 * rather than silently dropped — an activity two years overdue on a shipped
 * order is noise, but "and 61 older than this" is information.
 */
export const BACKLOG_FLOOR_DAYS = 180;

/**
 * The escalation margin, in CALENDAR days.
 *
 * Calendar and not working days, deliberately, and the reason is the cost being
 * avoided: a missed shipment is recovered with air freight, and an airline does
 * not give back the Sunday. A working-day margin would hand every slip that
 * crosses a weekend an extra day of grace — grace in the one direction that
 * costs money. `lib/ta/schedule.ts` uses working days to BUILD the ladder, which
 * is the opposite question ("how long will this take on the floor").
 */
export const ESCALATE_AFTER_DAYS = 3;

/** How many material lines a row shows before it says "+N more". */
const MATERIALS_SHOWN = 4;

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export type WorklistBucket = "backlog" | "today" | "upcoming";

/** One material the order needs, in its purchase UOM. See `materialsByOrder`. */
export interface WorklistMaterial {
  name: string;
  qty: number;
  uom: string | null;
}

export interface WorklistRow {
  id: string;
  rowUid: string | null;
  amendmentId: string;
  amendmentCode: string | null;
  /** `sales_orders.order_number` — the RE No the floor calls "Order Ref". */
  orderRef: string | null;
  buyer: string | null;
  styleRefs: string[];
  /** Total pieces ordered across the amendment's styles. */
  orderQty: number;
  orderUom: string | null;
  activityId: string | null;
  activity: string;
  departmentName: string | null;
  /** Which of the two existing mappings answered. Shown in the row's tooltip. */
  departmentSource: "assign" | "activity" | null;
  targetDate: string;
  status: string;
  /** Positive = overdue by this many calendar days. 0 = due today. */
  daysLate: number;
  bucket: WorklistBucket;
  escalated: boolean;
  materials: WorklistMaterial[];
  /** Materials beyond `MATERIALS_SHOWN`, so the row can say "+N more". */
  materialsOmitted: number;
  notes: string | null;
}

export type NoteLevel = "info" | "warn" | "danger";

/**
 * A sentence explaining something the operator cannot see. Every one of these
 * exists because a number went missing somewhere and the screen looked fine.
 */
export interface WorklistNote {
  level: NoteLevel;
  text: string;
  /** Where to go and fix it, when there is such a place. */
  href?: string;
  hrefLabel?: string;
}

export interface Worklist {
  /** The local (Asia/Kolkata) calendar date this was built for. */
  today: string;
  horizonDays: number;
  backlogFloorDays: number;
  escalateAfterDays: number;
  scope: {
    kind: "own_department" | "all_departments";
    departmentId: string | null;
    departmentName: string | null;
  };
  rows: WorklistRow[];
  counts: {
    /** Rows the query returned, BEFORE any narrowing. The anti-empty number. */
    scanned: number;
    backlog: number;
    today: number;
    upcoming: number;
    escalated: number;
    /** Dropped, and each one has a note beside it. */
    droppedDraft: number;
    droppedDone: number;
    droppedOtherDepartment: number;
    droppedTooOld: number;
    droppedSuperseded: number;
  };
  notes: WorklistNote[];
  /** False when the T&A table is not in this database — the screen says so. */
  available: boolean;
  /** `orders:edit` — whether the Done button does anything. */
  canComplete: boolean;
}

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

/** A PostgREST embed arrives as an object or a one-element array. */
function one(row: Row, key: string): Row | null {
  const v = row[key];
  if (Array.isArray(v)) return (v[0] as Row) ?? null;
  return (v as Row) ?? null;
}

/**
 * "The table is not in this database" as opposed to "the query was wrong".
 *
 * This matters more than usual right now: the T&A tab's table is being added by
 * another lane, so the screen has to render a sentence rather than an empty
 * worklist while it is missing. Both spellings are checked because PostgREST
 * changed which one it returns — older builds pass Postgres's own `42P01`
 * through, newer ones answer `PGRST205` from the schema cache without ever
 * reaching Postgres.
 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /schema cache|does not exist|could not find the table/i.test(error.message ?? "");
}

/* ------------------------------------------------------------------ *
 * WHO AM I, AND WHICH DEPARTMENT IS THAT
 * ------------------------------------------------------------------ */

/**
 * The signed-in user's department.
 *
 * There is no `profiles.department_id` — the app's RBAC is role-based and a role
 * is not a department. The only link that exists is `profiles.employee_code`
 * (unique, 0001) → `employees.code` → `employees.department_id` (0243), and that
 * is what is read here.
 *
 * Returns null freely — an unlinked account is normal (the two profiles in this
 * database have no `employee_code` at all today), and an unlinked account gets
 * the WHOLE worklist with a note saying so. It must never get an empty one:
 * "your department has nothing due" from a user who has no department is the
 * exact silent-empty failure this file is built around.
 */
async function myDepartment(
  sb: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ id: string; name: string | null } | null> {
  const { data: profile } = await sb
    .from("profiles")
    .select("employee_code")
    .eq("id", userId)
    .maybeSingle();

  const code = str((profile as Row | null)?.employee_code);
  if (!code) return null;

  const { data: emp } = await sb
    .from("employees")
    .select("department_id")
    .eq("code", code)
    .limit(1)
    .maybeSingle();

  const deptId = str((emp as Row | null)?.department_id);
  if (!deptId) return null;

  const { data: dept } = await sb
    .from("config_lookups")
    .select("id, name")
    .eq("id", deptId)
    .maybeSingle();

  return { id: deptId, name: str((dept as Row | null)?.name) };
}

/**
 * activity id → the departments that own it, from BOTH existing mappings.
 *
 * The repo carries two and inventing a third is what the contract forbids, so
 * both are read with a stated precedence:
 *
 *  1. **`ta_department_assign_lines`** (0267) — the real mapping, maintained on
 *     Orders ▸ Time & Action (TA) ▸ TA Department Assign. An activity can be
 *     assigned to more than one department (two departments legitimately share
 *     "Fabric Inspection"), so the value is a SET, never a single id. Matching
 *     against a single id would have silently hidden every shared activity from
 *     one of its two owners.
 *  2. **`ta_activities.department`** (0035, free TEXT) — the legacy column, used
 *     ONLY for an activity that appears in no assign line, matched
 *     case-insensitively against the department name. A row that matched this
 *     way is tagged `departmentSource: "activity"` so the screen can say the
 *     mapping came from the loose column rather than the maintained screen.
 *
 * Never the other way round: the assign screen is where an operator can change
 * the answer, so the assign screen wins.
 */
async function activityDepartments(
  sb: Awaited<ReturnType<typeof createClient>>,
): Promise<{ byAssign: Map<string, Set<string>>; assignLines: number }> {
  const byAssign = new Map<string, Set<string>>();

  const { data: lines } = await sb
    .from("ta_department_assign_lines")
    .select("activity_id, assign:ta_department_assigns(department_id)");

  const rows = arr(lines);
  for (const l of rows) {
    const actId = str(l.activity_id);
    const deptId = str(one(l, "assign")?.department_id);
    if (!actId || !deptId) continue;
    const set = byAssign.get(actId) ?? new Set<string>();
    set.add(deptId);
    byAssign.set(actId, set);
  }

  return { byAssign, assignLines: rows.length };
}

/* ------------------------------------------------------------------ *
 * THE MATERIAL HALF — "500 kgs of Yarn"
 * ------------------------------------------------------------------ */

/**
 * The order's material requirement, per sales order — READ, never recomputed.
 *
 * ## Where the number comes from, and why not from anywhere else
 *
 * `material_bom_amendment_requirements` is the Material BOM engine's own STORED
 * output: one row per requirement slice with `required_qty` in the consumption
 * UOM and `purchase_qty` in the purchase UOM, written by the same code path that
 * draws the MBA screen's grid. Reading it is how this screen shows the same
 * figure the buyer's screen shows.
 *
 * The obvious alternative — `material_bom_amendment_items.per_pieces × the
 * order's pieces — is wrong and was written that way first. `requirement.ts` is
 * ~1,900 lines of basis selection, colour splits, wastage, MOQ rollup, UOM
 * conversion and ceilings, all of which sit between `per_pieces` and a number
 * you can say out loud; multiplying two columns reproduces none of it and
 * produces a figure that disagrees with the MBA screen while looking exactly as
 * confident. A second answer to a question that already has one is the worst
 * outcome available.
 *
 * `purchase_qty` leads because it is what actually gets received — "500 kgs of
 * Yarn" is a purchase quantity, not a consumption total — and falls back to
 * `required_qty` on a line that names no pack.
 *
 * ## A REFUSED LINE IS COUNTED, NEVER ZEROED
 *
 * `refusal_reason` is set where the engine could not answer (an unstated basis,
 * a missing conversion). Those rows carry no honest quantity, so they are
 * excluded from the totals and counted instead — silently summing them as zero
 * would understate a material requirement, which is the direction that leaves a
 * line short on the floor.
 *
 * ## THE SCHEMA CARRIES NO ACTIVITY → MATERIAL LINK, AND THIS DOES NOT INVENT ONE
 *
 * A T&A row names an activity and a date; the requirement hangs off the ORDER.
 * So what a row shows is *the order's* requirement, labelled as such — not "this
 * activity needs 500 kg", which nothing in the database supports. Matching an
 * activity to a material by name ("Yarn Purchase" → items containing "yarn") was
 * considered and rejected: it compiles, runs, and quietly matches the wrong
 * thing, which is the failure mode this whole file is written against. Closing
 * that gap properly is a column on the T&A row, not a guess here.
 *
 * Ids are resolved with plain `.in("id", …)` lookups rather than PostgREST
 * embeds: this table references `uoms` twice (consumption / purchase), and an
 * ambiguous embed fails the WHOLE query — taking the worklist with it — to add a
 * decoration.
 */
async function materialsByOrder(
  sb: Awaited<ReturnType<typeof createClient>>,
  orderIds: string[],
): Promise<{ byOrder: Map<string, WorklistMaterial[]>; refused: number }> {
  const byOrder = new Map<string, WorklistMaterial[]>();
  if (!orderIds.length) return { byOrder, refused: 0 };

  const { data: mbas } = await sb
    .from("material_bom_amendments")
    .select("id, sales_order_id, amendment_no, amend_date, created_at")
    .in("sales_order_id", orderIds)
    .eq("is_draft", false);

  // Latest recorded MBA per order — a superseded amendment's requirement is a
  // requirement that was replaced, and showing both would double every figure.
  const latest = new Map<string, Row>();
  for (const m of arr(mbas)) {
    const so = str(m.sales_order_id);
    if (!so) continue;
    const prev = latest.get(so);
    if (!prev || num(m.amendment_no) > num(prev.amendment_no)) latest.set(so, m);
  }
  const mbaToOrder = new Map<string, string>();
  for (const [so, m] of latest) mbaToOrder.set(String(m.id), so);
  if (!mbaToOrder.size) return { byOrder, refused: 0 };

  const { data: reqs, error } = await sb
    .from("material_bom_amendment_requirements")
    .select(
      "amendment_id, item_id, required_qty, purchase_qty, " +
        "consumption_uom_id, purchase_uom_id, refusal_reason",
    )
    .in("amendment_id", [...mbaToOrder.keys()]);

  // A material line is a detail on a worklist row; a failure to read one must
  // never take the worklist with it.
  if (error) return { byOrder, refused: 0 };

  const reqRows = arr(reqs);
  if (!reqRows.length) return { byOrder, refused: 0 };

  const itemIds = [...new Set(reqRows.map((i) => str(i.item_id)).filter(Boolean))] as string[];
  const uomIds = [
    ...new Set(
      reqRows.flatMap((i) => [str(i.purchase_uom_id), str(i.consumption_uom_id)]).filter(Boolean),
    ),
  ] as string[];

  const [{ data: itemMaster }, { data: uomMaster }] = await Promise.all([
    itemIds.length
      ? sb.from("items").select("id, name").in("id", itemIds)
      : Promise.resolve({ data: [] as Row[] }),
    uomIds.length
      ? sb.from("uoms").select("id, code").in("id", uomIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const itemName = new Map(arr(itemMaster).map((i) => [String(i.id), str(i.name) ?? ""]));
  const uomCode = new Map(arr(uomMaster).map((u) => [String(u.id), str(u.code)]));

  let refused = 0;
  // Sum per (order, item, unit) — the engine explodes one material into slices
  // (colour, size, country), and a worklist wants the material, not the slices.
  const acc = new Map<string, Map<string, WorklistMaterial>>();
  for (const q of reqRows) {
    const orderId = mbaToOrder.get(String(q.amendment_id));
    const itemId = str(q.item_id);
    if (!orderId || !itemId) continue;
    if (str(q.refusal_reason)) {
      refused++;
      continue;
    }

    const purchase = num(q.purchase_qty);
    const qty = purchase || num(q.required_qty);
    if (!qty) continue;
    const uom = purchase
      ? uomCode.get(str(q.purchase_uom_id) ?? "") ?? null
      : uomCode.get(str(q.consumption_uom_id) ?? "") ?? null;

    const bucket = acc.get(orderId) ?? new Map<string, WorklistMaterial>();
    const key = `${itemId}|${uom ?? ""}`;
    const prev = bucket.get(key);
    if (prev) prev.qty += qty;
    else bucket.set(key, { name: itemName.get(itemId) ?? "—", qty, uom });
    acc.set(orderId, bucket);
  }

  for (const [orderId, bucket] of acc) {
    byOrder.set(orderId, [...bucket.values()].sort((a, b) => b.qty - a.qty));
  }
  return { byOrder, refused };
}

/* ------------------------------------------------------------------ *
 * THE WORKLIST
 * ------------------------------------------------------------------ */

/**
 * Build the signed-in user's worklist.
 *
 * `now` is injectable so a check can pin a date instead of depending on the day
 * it runs — the same reason `orderTaLadder` takes one.
 */
export async function getWorklist(now: Date = new Date()): Promise<Worklist> {
  const t = today(now);
  const horizonTo = addDays(t, HORIZON_DAYS);
  const backlogFrom = addDays(t, -BACKLOG_FLOOR_DAYS);

  const notes: WorklistNote[] = [];
  const counts: Worklist["counts"] = {
    scanned: 0,
    backlog: 0,
    today: 0,
    upcoming: 0,
    escalated: 0,
    droppedDraft: 0,
    droppedDone: 0,
    droppedOtherDepartment: 0,
    droppedTooOld: 0,
    droppedSuperseded: 0,
  };

  const [sb, user, canEdit] = await Promise.all([
    createClient(),
    getAppUser(),
    can("orders", "edit"),
  ]);

  const empty = (available: boolean): Worklist => ({
    today: t,
    horizonDays: HORIZON_DAYS,
    backlogFloorDays: BACKLOG_FLOOR_DAYS,
    escalateAfterDays: ESCALATE_AFTER_DAYS,
    scope: { kind: "all_departments", departmentId: null, departmentName: null },
    rows: [],
    counts,
    notes,
    available,
    canComplete: canEdit,
  });

  if (!user) return empty(true);

  /* ---- 1. The rows. `!inner` on the amendment so an orphan cannot slip in. -- */
  const { data, error } = await sb
    .from("garment_order_amendment_ta_activities")
    .select(
      "id, row_uid, amendment_id, activity_id, target_date, actual_date, status, notes, " +
        "activity:ta_activities(id, short_name, name, department, sequence), " +
        "amendment:garment_order_amendments!inner(" +
        "id, code, is_draft, amend_date, created_at, sales_order_id, " +
        // `customer_id` → `customers`, NOT `buyer_id` → `buyers`. 0126 declared
        // the column as `buyer_id` and it was repointed at the real party master
        // later (`raagam-two-party-tables`: "customers is the real master,
        // buyers the scaffold spine"). Written against the migration this read
        // `buyer:buyers(...)`, which PostgREST rejects outright — the whole
        // worklist would have failed, not just the name.
        "customer:customers(id, name), sales_order:sales_orders(id, order_number, status))",
    )
    .gte("target_date", backlogFrom)
    .lte("target_date", horizonTo)
    .order("target_date", { ascending: true });

  if (error) {
    if (isMissingTable(error)) {
      // The one state where "no rows" is neither a bug nor a quiet day.
      notes.push({
        level: "warn",
        text:
          "The T&A schedule table is not in this database yet, so no order can " +
          "have a T&A path. This screen will fill in as soon as it is applied and " +
          "orders are scheduled on the T&A tab.",
      });
      return empty(false);
    }
    notes.push({
      level: "danger",
      text: `The worklist could not be read: ${error.message}. This is an error, not an empty day.`,
    });
    return empty(true);
  }

  const raw = arr(data);
  counts.scanned = raw.length;

  /* ---- 2. Also count what sits OUTSIDE the backlog floor. ------------------ */
  const { count: older } = await sb
    .from("garment_order_amendment_ta_activities")
    .select("id", { count: "exact", head: true })
    .lt("target_date", backlogFrom)
    .is("actual_date", null);
  counts.droppedTooOld = older ?? 0;

  /* ---- 3. Department scope. ------------------------------------------------ */
  const [dept, { byAssign, assignLines }] = await Promise.all([
    myDepartment(sb, user.id),
    activityDepartments(sb),
  ]);

  const deptNameLower = (dept?.name ?? "").trim().toLowerCase();
  const scopeToDept = Boolean(dept && assignLines > 0);

  if (!dept) {
    // NO `href` HERE, DELIBERATELY. The link would be to the Employee master,
    // and `components/masters/employee-master-screen.tsx` is mounted at no
    // route — it is the only screen that could set `profiles.employee_code`,
    // and there is currently no way to reach it. A note pointing at a 404 is
    // worse than a note that just states the fact; the fix is a route, not a
    // link. Until then this branch is the NORMAL one and the worklist stays
    // unscoped rather than empty.
    notes.push({
      level: "info",
      text:
        "Your login is not linked to an employee record with a department, so this is " +
        "EVERY department's work rather than just yours. The link is " +
        "profiles.employee_code → employees.code; until it is set, nothing here is hidden " +
        "from you.",
    });
  } else if (assignLines === 0) {
    notes.push({
      level: "warn",
      text:
        `No department owns any T&A activity yet, so this is every department's ` +
        `work rather than ${dept.name ?? "yours"}. Assign activities to departments ` +
        `to narrow it.`,
      href: "/orders/ta-department-assign",
      hrefLabel: "TA Department Assign",
    });
  }

  /* ---- 4. Latest amendment per order. -------------------------------------- */
  // An order can carry several amendments; a superseded one's schedule is a
  // schedule that was replaced. Today every order in this database has exactly
  // one, so this drops nothing — which is precisely why it has to be written
  // now rather than discovered later as double rows on the floor's screen.
  const currentByOrder = new Map<string, string>();
  for (const r of raw) {
    const a = one(r, "amendment");
    if (!a) continue;
    const orderId = str(a.sales_order_id);
    if (!orderId) continue;
    const prev = currentByOrder.get(orderId);
    if (!prev) {
      currentByOrder.set(orderId, String(a.id));
      continue;
    }
    const prevRow = raw.map((x) => one(x, "amendment")).find((x) => x && String(x.id) === prev);
    const key = (x: Row | null | undefined) =>
      `${str(x?.amend_date) ?? ""}|${str(x?.created_at) ?? ""}`;
    if (key(a) > key(prevRow)) currentByOrder.set(orderId, String(a.id));
  }

  /* ---- 5. Narrow, counting every drop. ------------------------------------- */
  type Kept = { r: Row; a: Row; act: Row | null; deptName: string | null; src: "assign" | "activity" | null };
  const kept: Kept[] = [];
  let matchedByLegacyColumn = 0;

  for (const r of raw) {
    const a = one(r, "amendment");
    if (!a) continue;

    if (a.is_draft === true) {
      counts.droppedDraft++;
      continue;
    }

    const orderId = str(a.sales_order_id);
    if (orderId && currentByOrder.get(orderId) !== String(a.id)) {
      counts.droppedSuperseded++;
      continue;
    }

    const done = str(r.actual_date) != null || str(r.status) === "done";
    if (done) {
      counts.droppedDone++;
      continue;
    }

    const act = one(r, "activity");
    const actId = str(r.activity_id);
    const owners = actId ? byAssign.get(actId) : undefined;

    // Which department owns this activity, and by which of the two mappings.
    let deptName: string | null = null;
    let src: "assign" | "activity" | null = null;
    let mine = true;

    if (scopeToDept && dept) {
      if (owners && owners.size) {
        mine = owners.has(dept.id);
        src = "assign";
        deptName = mine ? dept.name : null;
      } else {
        const legacy = (str(act?.department) ?? "").trim().toLowerCase();
        mine = legacy.length > 0 && legacy === deptNameLower;
        src = mine ? "activity" : null;
        deptName = mine ? dept.name : null;
        if (mine) matchedByLegacyColumn++;
      }
      if (!mine) {
        counts.droppedOtherDepartment++;
        continue;
      }
    } else {
      // Unscoped: still SAY which department owns each row, so the operator can
      // see whose work they are looking at.
      if (owners && owners.size) src = "assign";
      else if (str(act?.department)) {
        src = "activity";
        deptName = str(act?.department);
      }
    }

    kept.push({ r, a, act, deptName, src });
  }

  if (matchedByLegacyColumn > 0) {
    notes.push({
      level: "info",
      text:
        `${matchedByLegacyColumn} ${matchedByLegacyColumn === 1 ? "activity is" : "activities are"} ` +
        `matched to your department by the legacy free-text Department on the TA Activity ` +
        `master rather than by TA Department Assign. Assign them properly and the match ` +
        `stops depending on the spelling.`,
      href: "/orders/ta-department-assign",
      hrefLabel: "TA Department Assign",
    });
  }

  /* ---- 6. The style / quantity half. --------------------------------------- */
  const amendmentIds = [...new Set(kept.map((k) => String(k.a.id)))];
  const stylesByAmendment = new Map<string, { refs: string[]; pieces: number; uom: string | null }>();

  if (amendmentIds.length) {
    const { data: styles } = await sb
      .from("garment_order_amendment_styles")
      .select("amendment_id, style_ref_no, po_qty, order_unit_id")
      .in("amendment_id", amendmentIds);

    const styleRows = arr(styles);
    const unitIds = [
      ...new Set(styleRows.map((s) => str(s.order_unit_id)).filter(Boolean)),
    ] as string[];
    const { data: units } = unitIds.length
      ? await sb.from("uoms").select("id, code").in("id", unitIds)
      : { data: [] };
    const unitCode = new Map(arr(units).map((u) => [String(u.id), str(u.code)]));

    for (const s of styleRows) {
      const id = str(s.amendment_id);
      if (!id) continue;
      const acc = stylesByAmendment.get(id) ?? { refs: [], pieces: 0, uom: null };
      const ref = str(s.style_ref_no);
      if (ref) acc.refs.push(ref);
      acc.pieces += num(s.po_qty);
      acc.uom ??= unitCode.get(str(s.order_unit_id) ?? "") ?? null;
      stylesByAmendment.set(id, acc);
    }
  }

  /* ---- 7. The material half. ----------------------------------------------- */
  const orderIds = [
    ...new Set(kept.map((k) => str(k.a.sales_order_id)).filter(Boolean)),
  ] as string[];
  const { byOrder: materials, refused: refusedLines } = await materialsByOrder(sb, orderIds);

  if (refusedLines > 0) {
    notes.push({
      level: "warn",
      text:
        `${refusedLines} Material BOM ${refusedLines === 1 ? "line has" : "lines have"} no ` +
        `quantity the BOM engine could compute, so ${refusedLines === 1 ? "it is" : "they are"} ` +
        `left out of the material figures below rather than counted as zero. Open the order's ` +
        `Material BOM to see why.`,
      href: "/orders/material-bom",
      hrefLabel: "Material BOM",
    });
  }

  /* ---- 8. Build the rows. --------------------------------------------------- */
  const rows: WorklistRow[] = kept.map(({ r, a, act, deptName, src }) => {
    const targetDate = String(r.target_date);
    // daysBetween(target, today) — positive when today is AFTER the target, i.e.
    // overdue. `today()` is the local calendar date, so this cannot slip a day.
    const daysLate = daysBetween(targetDate, t);
    const bucket: WorklistBucket = daysLate > 0 ? "backlog" : daysLate === 0 ? "today" : "upcoming";

    const orderId = str(a.sales_order_id);
    const st = stylesByAmendment.get(String(a.id));
    const all = (orderId && materials.get(orderId)) || [];

    return {
      id: String(r.id),
      rowUid: str(r.row_uid),
      amendmentId: String(a.id),
      amendmentCode: str(a.code),
      orderRef: str(one(a, "sales_order")?.order_number),
      buyer: str(one(a, "customer")?.name),
      styleRefs: st?.refs ?? [],
      orderQty: st?.pieces ?? 0,
      orderUom: st?.uom ?? null,
      activityId: str(r.activity_id),
      activity: str(act?.name) ?? str(act?.short_name) ?? "—",
      departmentName: deptName,
      departmentSource: src,
      targetDate,
      status: str(r.status) ?? "pending",
      daysLate,
      bucket,
      escalated: daysLate >= ESCALATE_AFTER_DAYS,
      materials: all.slice(0, MATERIALS_SHOWN),
      materialsOmitted: Math.max(0, all.length - MATERIALS_SHOWN),
      notes: str(r.notes),
    };
  });

  // Overdue first, then by date; within a date, the older slip leads.
  rows.sort((x, y) => y.daysLate - x.daysLate || x.activity.localeCompare(y.activity));

  for (const row of rows) {
    counts[row.bucket]++;
    if (row.escalated) counts.escalated++;
  }

  /* ---- 9. The notes that turn an empty list into a diagnosis. ---------------- */
  if (counts.droppedTooOld > 0) {
    notes.push({
      level: "warn",
      text:
        `${counts.droppedTooOld} activities are more than ${BACKLOG_FLOOR_DAYS} days ` +
        `overdue and are not listed. They are outstanding, not closed.`,
    });
  }
  if (counts.droppedDraft > 0) {
    notes.push({
      level: "info",
      text: `${counts.droppedDraft} activities belong to draft orders and are not listed.`,
    });
  }
  if (counts.droppedSuperseded > 0) {
    notes.push({
      level: "info",
      text:
        `${counts.droppedSuperseded} activities belong to superseded amendments — only the ` +
        `latest amendment of each order is listed.`,
    });
  }
  if (rows.length === 0 && counts.scanned > 0) {
    // THE important one. "Nothing due today" and "43 scheduled, none yours"
    // must not render as the same screen.
    const why: string[] = [];
    if (counts.droppedOtherDepartment)
      why.push(`${counts.droppedOtherDepartment} belong to another department`);
    if (counts.droppedDone) why.push(`${counts.droppedDone} are already completed`);
    if (counts.droppedDraft) why.push(`${counts.droppedDraft} are on draft orders`);
    if (counts.droppedSuperseded)
      why.push(`${counts.droppedSuperseded} are on superseded amendments`);
    notes.push({
      level: "info",
      text:
        `${counts.scanned} T&A activities fall in this window and none of them reached ` +
        `your list` + (why.length ? ` — ${why.join(", ")}.` : ".") +
        ` This is a scoping result, not an idle day.`,
    });
  } else if (rows.length === 0 && counts.scanned === 0 && counts.droppedTooOld === 0) {
    notes.push({
      level: "info",
      text:
        `No order carries a T&A schedule in this window. A schedule is entered on the ` +
        `T&A tab of the order.`,
      href: "/orders/amendments",
      hrefLabel: "Order Amendment",
    });
  }

  return {
    today: t,
    horizonDays: HORIZON_DAYS,
    backlogFloorDays: BACKLOG_FLOOR_DAYS,
    escalateAfterDays: ESCALATE_AFTER_DAYS,
    scope: {
      kind: scopeToDept ? "own_department" : "all_departments",
      departmentId: dept?.id ?? null,
      departmentName: dept?.name ?? null,
    },
    rows,
    counts,
    notes,
    available: true,
    canComplete: canEdit,
  };
}
