"use client";

import { ClipboardPen, UserCog } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { SelectionBar } from "@/components/ui/selection-bar";
import { useToast } from "@/components/ui/toast";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtDateTime } from "@/lib/format";
import {
  addPeopleToRound,
  loadReviewPanel,
  recallReview,
  removeReviews,
  saveSelfRating,
  saveSupervisorRating,
  sendBackReview,
  setReviewer,
} from "@/lib/hr/performance-actions";
import {
  AREAS,
  performanceLabel,
  performanceTone,
  scoreOf,
  type AreaKey,
  type Rating,
  type Review,
  type ReviewDraft,
  type ReviewStatus,
  type Round,
} from "@/lib/hr/performance-types";
import { personKey, splitPersonKey, type PersonOption } from "@/lib/hr/timeoff-types";
import { Fact, ReasonSheet } from "@/components/hr/timeoff/shared";
import { PersonCombobox } from "@/components/hr/lifecycle/shared";
import { RatingsBlock, ScoreBadge } from "./shared";

/**
 * HR ▸ Performance & Growth ▸ Appraisals (0773, MyJKKN §13.1 reviews).
 *
 * One appraisal per person per round: the person rates themself, their
 * supervisor rates them and sends it on, the approver signs it off. A worker
 * has no login, so their appraisal starts with the supervisor. HR can enter
 * either rating from the paper sheet.
 *
 * Three readers, one screen: HR sees the whole round; a supervisor sees the
 * people they rate; a person sees their own — and their supervisor's rating
 * only once it is approved.
 */

type Props = {
  rounds: Round[];
  rows: Review[];
  people: PersonOption[];
  myStaffId: string | null;
  canEdit: boolean;
};

type Scope = "all" | ReviewStatus | "to_rate" | "mine";

const blankDraft = (): ReviewDraft => ({
  quality: null,
  output: null,
  discipline: null,
  teamwork: null,
  comment: "",
  strengths: "",
  improvements: "",
});

export function AppraisalsScreen({ rounds, rows, people, myStaffId, canEdit }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const isSelf = !!myStaffId && !canEdit;

  // ── round ──
  const [roundId, setRoundId] = useState<string>(
    () =>
      params.get("round") ??
      rounds.find((r) => r.status === "open")?.id ??
      rounds.find((r) => r.status === "locked")?.id ??
      rounds[0]?.id ??
      "",
  );
  const round = rounds.find((r) => r.id === roundId) ?? null;
  const inRound = useMemo(() => rows.filter((r) => r.round_id === roundId), [rows, roundId]);

  // ── scope ──
  const [scope, setScope] = useState<Scope>(isSelf ? "to_rate" : "all");
  const inScope = (r: Review, sc: Scope) =>
    sc === "all"
      ? true
      : sc === "to_rate"
        ? r.reviewer_id === myStaffId && r.staff_id !== myStaffId
        : sc === "mine"
          ? r.staff_id === myStaffId
          : r.status === sc;
  const visible = inRound.filter((r) => inScope(r, scope));
  const count = (sc: Scope) => inRound.filter((r) => inScope(r, sc)).length;

  // ── who may do what (the SQL says it again) ──
  const canSelf = (r: Review) =>
    r.status === "self" && r.round_status === "open" && ((!!myStaffId && r.staff_id === myStaffId) || canEdit);
  const canSup = (r: Review) =>
    r.status === "supervisor" &&
    (r.round_status === "open" || r.round_status === "locked") &&
    !(myStaffId && r.staff_id === myStaffId) &&
    ((!!myStaffId && r.reviewer_id === myStaffId) || canEdit);
  const seesSup = (r: Review) =>
    canEdit || (!!myStaffId && r.reviewer_id === myStaffId && r.staff_id !== myStaffId) || r.status === "approved";
  const canRecall = (r: Review) =>
    r.status === "pending_approval" && (canEdit || (!!myStaffId && r.reviewer_id === myStaffId));

  // ── bulk (HR) ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = visible.filter((r) => selected.has(r.id));

  // ── add people ──
  const [adding, setAdding] = useState(false);
  const [addKeys, setAddKeys] = useState<string[]>([]);
  const [addSelf, setAddSelf] = useState<"yes" | "no">("yes");
  const taken = useMemo(
    () => new Set(inRound.map((r) => (r.staff_id ? personKey("staff", r.staff_id) : personKey("worker", r.worker_id as string)))),
    [inRound],
  );
  const addable = people.filter((p) => !taken.has(p.key));
  useUnsavedGuard((adding && addKeys.length > 0) || isPending);
  function doAdd(keys: string[]) {
    if (!round) return;
    startTransition(async () => {
      const r = await addPeopleToRound(round.id, keys, addSelf === "yes");
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(`${r.count ?? 0} added`);
      setAdding(false);
      setAddKeys([]);
      router.refresh();
    });
  }

  // ── supervisor ──
  const staffPeople = people.filter((p) => p.kind === "staff");
  const [supFor, setSupFor] = useState<Review[] | null>(null);
  const [supKey, setSupKey] = useState("");
  function doSetSupervisor() {
    if (!supFor) return;
    const ids = supFor.map((r) => r.id);
    startTransition(async () => {
      const r = await setReviewer(ids, supKey ? splitPersonKey(supKey).staff_id : null);
      if (!r.ok) toastError(r.error);
      else {
        success("Supervisor changed");
        setSupFor(null);
        setSelected(new Set());
        router.refresh();
      }
    });
  }
  function doRemove(list: Review[]) {
    startTransition(async () => {
      const r = await removeReviews(list.map((x) => x.id));
      if (!r.ok) toastError(r.error);
      else {
        success(`${r.count ?? 0} removed from the round`);
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  // ── the appraisal sheet ──
  const [viewId, setViewId] = useState<string | null>(null);
  const live = viewId ? (rows.find((r) => r.id === viewId) ?? null) : null;
  const [selfD, setSelfD] = useState<ReviewDraft>(blankDraft);
  const [supD, setSupD] = useState<ReviewDraft>(blankDraft);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((!!live && dirty) || isPending);
  const [panel, setPanel] = useState<(Awaited<ReturnType<typeof loadReviewPanel>> & { id: string }) | null>(null);
  function openView(r: Review) {
    setViewId(r.id);
    setSelfD({ ...r.self, comment: r.self_comment ?? "", strengths: "", improvements: "" });
    // The supervisor starts from the self-rating when they have none of their own.
    const hasSup = AREAS.some((a) => r.sup[a.key]);
    setSupD({
      ...(hasSup ? r.sup : r.self),
      comment: r.sup_comment ?? "",
      strengths: r.strengths ?? "",
      improvements: r.improvements ?? "",
    });
    setDirty(false);
    setPanel(null);
    loadReviewPanel(r.id).then((p) => setPanel({ ...p, id: r.id }));
  }
  useOpenIntent((id) => {
    const r = rows.find((x) => x.id === id);
    if (r) {
      setRoundId(r.round_id);
      openView(r);
    }
  });
  const putSelf = (k: AreaKey, v: Rating) => {
    setSelfD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const putSup = (k: AreaKey, v: Rating) => {
    setSupD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };

  function save(step: "self" | "sup", submit: boolean) {
    if (!live) return;
    const id = live.id;
    startTransition(async () => {
      const r = step === "self" ? await saveSelfRating(id, selfD, submit) : await saveSupervisorRating(id, supD, submit);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      success(submit ? (step === "self" ? "Sent to the supervisor" : "Sent for approval") : "Saved");
      if (submit) setViewId(null);
      router.refresh();
    });
  }
  const [backFor, setBackFor] = useState<Review | null>(null);
  const [recallFor, setRecallFor] = useState<Review | null>(null);
  function doBack(note: string) {
    if (!backFor) return;
    const id = backFor.id;
    startTransition(async () => {
      const r = await sendBackReview(id, note);
      if (!r.ok) toastError(r.error);
      else {
        success("Sent back to the person");
        setBackFor(null);
        setViewId(null);
        router.refresh();
      }
    });
  }
  function doRecall(reason: string) {
    if (!recallFor) return;
    const id = recallFor.id;
    startTransition(async () => {
      const r = await recallReview(id, reason);
      if (!r.ok) toastError(r.error);
      else {
        success("Taken back from the approver");
        setRecallFor(null);
        setViewId(null);
        router.refresh();
      }
    });
  }

  // ── table ──
  const columns: Column<Review>[] = [
    {
      header: "Person",
      cell: (r) => (
        <span className="text-sm">
          <span className="font-medium">{r.person_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {r.person_code ?? ""}
            {r.person_kind === "worker" ? " · Worker" : ""}
          </span>
        </span>
      ),
    },
    { header: "Designation", cell: (r) => <span className="text-sm">{r.designation_name ?? "—"}</span> },
    {
      header: "Supervisor",
      cell: (r) => <span className={r.reviewer_name ? "text-sm" : "text-sm text-warning"}>{r.reviewer_name ?? "Not set"}</span>,
    },
    {
      header: "Self",
      cell: (r) => (r.self_rating ? <ScoreBadge score={scoreOf(r.self)} /> : <span className="text-xs text-muted-foreground">No self-rating</span>),
    },
    {
      header: "Final",
      cell: (r) => (seesSup(r) ? <ScoreBadge score={r.final_score ?? scoreOf(r.sup)} /> : <span className="text-sm text-muted-foreground">—</span>),
    },
  ];
  const statusColumn: Column<Review> = {
    header: "Status",
    cell: (r) => <StatusPill tone={performanceTone(r.status)}>{performanceLabel(r.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Review>((r) => (
    <RowActions
      label={r.person_name}
      onView={() => openView(r)}
      canEdit={false}
      canDelete={false}
      isPending={isPending}
      menu={[
        ...(canSelf(r) || canSup(r) ? [{ label: "Rate", icon: ClipboardPen, onClick: () => openView(r) }] : []),
        ...(canEdit && (r.status === "self" || r.status === "supervisor")
          ? [
              {
                label: "Change supervisor",
                icon: UserCog,
                onClick: () => {
                  setSupKey(r.reviewer_id ? personKey("staff", r.reviewer_id) : "");
                  setSupFor([r]);
                },
              },
            ]
          : []),
      ]}
    />
  ));

  const scopes: { value: Scope; label: string }[] = isSelf
    ? [
        { value: "to_rate", label: `To rate (${count("to_rate")})` },
        { value: "mine", label: `Mine (${count("mine")})` },
      ]
    : [
        { value: "all", label: `All (${count("all")})` },
        { value: "self", label: `Self-rating (${count("self")})` },
        { value: "supervisor", label: `With supervisor (${count("supervisor")})` },
        { value: "pending_approval", label: `Awaiting approval (${count("pending_approval")})` },
        { value: "approved", label: `Approved (${count("approved")})` },
      ];

  const editableBulk = chosen.filter((r) => r.status === "self" || r.status === "supervisor");

  // ── sheet footer ──
  function footer(r: Review) {
    const self = canSelf(r);
    const sup = canSup(r);
    if (!self && !sup && !canRecall(r)) return undefined;
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canRecall(r) && (
          <Button variant="outline" disabled={isPending} onClick={() => setRecallFor(r)}>
            Recall
          </Button>
        )}
        {sup && r.self_rating && r.round_status === "open" && (
          <Button variant="outline" disabled={isPending} onClick={() => setBackFor(r)}>
            Send back
          </Button>
        )}
        {(self || sup) && (
          <Button variant="outline" disabled={isPending} onClick={() => save(self ? "self" : "sup", false)}>
            Save draft
          </Button>
        )}
        {self && (
          <Button disabled={isPending || scoreOf(selfD) == null} onClick={() => save("self", true)}>
            Send to supervisor
          </Button>
        )}
        {sup && (
          <Button disabled={isPending || scoreOf(supD) == null} onClick={() => save("sup", true)}>
            Send for approval
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Round" w="name">
            <Select
              value={roundId}
              onChange={(e) => {
                setRoundId(e.target.value);
                setSelected(new Set());
              }}
            >
              {rounds.length === 0 && <option value="" />}
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {performanceLabel(r.status)}
                </option>
              ))}
            </Select>
          </Field>
          <ToggleGroup label="Show" value={scope} onChange={setScope} options={scopes} />
        </div>
        {canEdit && round && (round.status === "draft" || round.status === "open") && (
          <Button
            onClick={() => {
              setAddKeys([]);
              setAdding(true);
            }}
          >
            + Add People
          </Button>
        )}
      </div>

      {round && (
        <p className="text-xs text-muted-foreground">
          {fmtDate(round.period_from)} – {fmtDate(round.period_to)}
          {round.self_due ? ` · self-rating due ${fmtDate(round.self_due)}` : ""}
          {round.review_due ? ` · supervisor due ${fmtDate(round.review_due)}` : ""}
          {round.status === "draft" ? " · this round is a draft — open it on Appraisal Rounds so people can rate" : ""}
        </p>
      )}

      {canEdit && (
        <SelectionBar count={chosen.length} onClear={() => setSelected(new Set())}>
          {editableBulk.length > 0 && (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => {
                setSupKey("");
                setSupFor(editableBulk);
              }}
            >
              Set supervisor ({editableBulk.length})
            </Button>
          )}
          {editableBulk.length > 0 && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => doRemove(editableBulk)}>
              Remove from round ({editableBulk.length})
            </Button>
          )}
        </SelectionBar>
      )}

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(r) => r.id}
        selectable={canEdit && visible.length > 0}
        selectedKeys={selected}
        onToggle={(k) =>
          setSelected((x) => {
            const n = new Set(x);
            if (n.has(k)) n.delete(k);
            else n.add(k);
            return n;
          })
        }
        onToggleAll={() => setSelected((x) => (x.size === visible.length ? new Set() : new Set(visible.map((r) => r.id))))}
        empty={
          rounds.length === 0
            ? canEdit
              ? "No appraisal rounds yet. Add one on Appraisal Rounds."
              : "No appraisals for you yet."
            : inRound.length === 0
              ? canEdit
                ? "Nobody is in this round yet. Add people to it."
                : "Nothing for you in this round."
              : "Nothing here."
        }
      />

      {/* ── The appraisal ───────────────────────────────────────────────── */}
      <Sheet
        open={!!live}
        onClose={() => setViewId(null)}
        title={live ? `${live.person_name} — ${live.round_name}` : "Appraisal"}
        size="md"
        footer={live ? footer(live) : undefined}
      >
        {live && (
          <div className="max-w-[44rem] space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={performanceTone(live.status)}>{performanceLabel(live.status)}</StatusPill>
              <span className="text-muted-foreground">
                {live.person_code ?? ""}
                {live.designation_name ? ` · ${live.designation_name}` : ""}
                {live.person_kind === "worker" ? " · Worker" : " · Staff"}
              </span>
            </div>
            <dl className="space-y-1">
              <Fact label="Supervisor">{live.reviewer_name ?? "Not set — HR enters the rating"}</Fact>
              {live.returned_note && (live.status === "self" || live.status === "supervisor") && (
                <Fact label="Sent back" className="text-warning">
                  {live.returned_note}
                </Fact>
              )}
              {live.approved_at && <Fact label="Approved">{fmtDateTime(live.approved_at)}</Fact>}
              {live.decision_remark && live.status === "approved" && <Fact label="Approver said">{live.decision_remark}</Fact>}
            </dl>

            {live.self_rating && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Self-rating{live.self_at ? ` · sent ${fmtDateTime(live.self_at)}` : ""}
                </h3>
                {canSelf(live) ? (
                  <>
                    <RatingsBlock name="self" value={selfD} onChange={putSelf} />
                    <Field label="Comments">
                      <Textarea
                        rows={2}
                        value={selfD.comment}
                        onChange={(e) => {
                          setSelfD((x) => ({ ...x, comment: e.target.value }));
                          setDirty(true);
                        }}
                      />
                    </Field>
                  </>
                ) : live.status === "self" ? (
                  <p className="text-muted-foreground">
                    Waiting for {live.person_name} to rate themself
                    {live.round_status !== "open" ? " — self-rating is closed for this round, so HR can move it on" : ""}.
                  </p>
                ) : (
                  <>
                    <RatingsBlock name="self-ro" value={live.self} />
                    {live.self_comment && <p className="whitespace-pre-wrap">{live.self_comment}</p>}
                  </>
                )}
              </section>
            )}

            {seesSup(live) && live.status !== "self" && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Supervisor{live.sup_at ? ` · sent ${fmtDateTime(live.sup_at)}` : ""}
                </h3>
                {canSup(live) ? (
                  <>
                    <RatingsBlock name="sup" value={supD} onChange={putSup} />
                    {(["comment", "strengths", "improvements"] as const).map((k) => (
                      <Field key={k} label={k === "comment" ? "Comments" : k === "strengths" ? "Strengths" : "To improve"}>
                        <Textarea
                          rows={2}
                          value={supD[k]}
                          onChange={(e) => {
                            setSupD((x) => ({ ...x, [k]: e.target.value }));
                            setDirty(true);
                          }}
                        />
                      </Field>
                    ))}
                  </>
                ) : live.status === "supervisor" ? (
                  <p className="text-muted-foreground">Waiting for {live.reviewer_name ?? "the supervisor"} to rate.</p>
                ) : (
                  <>
                    <RatingsBlock name="sup-ro" value={live.sup} />
                    <dl className="space-y-1">
                      {live.sup_comment && <Fact label="Comments">{live.sup_comment}</Fact>}
                      {live.strengths && <Fact label="Strengths">{live.strengths}</Fact>}
                      {live.improvements && <Fact label="To improve">{live.improvements}</Fact>}
                    </dl>
                  </>
                )}
              </section>
            )}

            {panel?.id === live.id && panel.run && (seesSup(live) || live.status === "approved") && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline rows={panel.timeline} resolveUserName={(id) => panel.names[id]} />
                {panel.verdict && live.status === "pending_approval" && (
                  <ApprovalActionBar
                    run={panel.run}
                    verdict={panel.verdict}
                    subjectPath="/hr/performance/appraisals"
                    onDone={() => setViewId(null)}
                  />
                )}
              </section>
            )}
          </div>
        )}
      </Sheet>

      {/* ── Add people ───────────────────────────────────────────────────── */}
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title={`Add people — ${round?.name ?? ""}`}
        size="sm"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={isPending || addable.length === 0} onClick={() => doAdd(addable.map((p) => p.key))}>
              Add everyone ({addable.length})
            </Button>
            <Button disabled={isPending || addKeys.length === 0} onClick={() => doAdd(addKeys)}>
              Add {addKeys.length || ""}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            Everyone active in this unit who is not in the round yet. Each person&apos;s supervisor starts as their manager on
            People ▸ Staff / Workers; change it here afterwards if needed.
          </p>
          <MultiSelect
            label="People"
            options={addable.map((p) => ({ id: p.key, label: `${p.name}${p.code ? ` (${p.code})` : ""}${p.kind === "worker" ? " · Worker" : ""}` }))}
            values={addKeys}
            onChange={setAddKeys}
            emptyLabel="Everyone is already in this round"
          />
          <Field label="Staff rate themselves first" hint="Workers have no login, so their supervisor always rates them directly.">
            <Segmented
              name="pf-add-self"
              value={addSelf}
              onChange={setAddSelf}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No — supervisor rates directly" },
              ]}
            />
          </Field>
        </div>
      </Sheet>

      {/* ── Supervisor ───────────────────────────────────────────────────── */}
      <Sheet
        open={!!supFor}
        onClose={() => setSupFor(null)}
        title={supFor?.length === 1 ? `Supervisor — ${supFor[0].person_name}` : `Supervisor for ${supFor?.length ?? 0} people`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSupFor(null)}>
              Cancel
            </Button>
            <Button disabled={isPending} onClick={doSetSupervisor}>
              Save
            </Button>
          </div>
        }
      >
        <Field label="Supervisor" hint="Leave blank and HR enters the rating.">
          <PersonCombobox people={staffPeople} value={supKey} onChange={setSupKey} />
        </Field>
      </Sheet>

      <ReasonSheet
        open={!!backFor}
        busy={isPending}
        onClose={() => setBackFor(null)}
        onConfirm={doBack}
        title={`Send back — ${backFor?.person_name ?? ""}`}
        confirmLabel="Send back"
        intro="It goes back to the person to rate themself again. Say what to look at."
      />
      <ReasonSheet
        open={!!recallFor}
        busy={isPending}
        onClose={() => setRecallFor(null)}
        onConfirm={doRecall}
        title={`Recall — ${recallFor?.person_name ?? ""}`}
        confirmLabel="Recall"
        intro="The approval is cancelled and the appraisal comes back to the supervisor."
      />
    </div>
  );
}
