"use client";

// components/QuestionEditor.tsx
//
// Draft questionnaire editor (Session 3 — question editor). OWNER-ONLY: the
// page only renders this on the owner branch for a DRAFT version. The list
// is rendered straight from the `questions` prop (not copied into state), so
// after each mutation we router.refresh() and the re-fetched server order is
// what shows — no fragile client-side ordering to drift out of sync.
//
// Every question is bilingual: EN + AR are edited together and both are
// required. Visibility maps All→NULL / Jordanian / Syrian / Both (NEVER an
// empty array — that would hide the question from everyone). is_feedback is
// only offered when the version has a feedback block.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createQuestionAction,
  updateQuestionAction,
  deleteQuestionAction,
  moveQuestionAction,
  type QuestionActionError,
} from "@/lib/actions/questions";

type Nat = "jordanian" | "syrian";
type Visibility = "all" | "jordanian" | "syrian" | "both";
type AnswerType = "free_text" | "single_choice" | "multi_choice";

// One option row in the editor: bilingual labels only. option_code +
// order_index are assigned server-side from array position (D102), so the
// client never tracks them.
type OptionRow = { labelEn: string; labelAr: string };

export type EditorQuestionView = {
  id: string;
  code: string;
  orderIndex: number;
  textEn: string;
  textAr: string;
  isFeedback: boolean;
  isRequired: boolean;
  visibleNationalities: Nat[] | null;
  answerType: AnswerType;
  allowComment: boolean;
  allowSkip: boolean;
  options: OptionRow[];
};

type FormState = {
  code: string;
  textEn: string;
  textAr: string;
  visibility: Visibility;
  isRequired: boolean;
  isFeedback: boolean;
  answerType: AnswerType;
  allowComment: boolean;
  allowSkip: boolean;
  options: OptionRow[];
};

const ANSWER_TYPE_LABEL: Record<AnswerType, string> = {
  free_text: "Free text",
  single_choice: "Single choice (radio)",
  multi_choice: "Multiple choice (checkboxes)",
};

function visToArray(v: Visibility): Nat[] | null {
  if (v === "jordanian") return ["jordanian"];
  if (v === "syrian") return ["syrian"];
  if (v === "both") return ["jordanian", "syrian"];
  return null; // "all"
}

function arrayToVis(a: Nat[] | null): Visibility {
  if (!a || a.length === 0) return "all";
  const j = a.includes("jordanian");
  const s = a.includes("syrian");
  if (j && s) return "both";
  if (s) return "syrian";
  if (j) return "jordanian";
  return "all";
}

const VIS_LABEL: Record<Visibility, string> = {
  all: "All respondents",
  jordanian: "Jordanian only",
  syrian: "Syrian only",
  both: "Jordanian + Syrian",
};

function suggestCode(questions: EditorQuestionView[], isFeedback: boolean): string {
  const prefix = isFeedback ? "F" : "Q";
  const n = questions.filter((q) => q.isFeedback === isFeedback).length + 1;
  return `${prefix}${n}`;
}

function errMsg(error: QuestionActionError, issues?: string[]): string {
  switch (error) {
    case "forbidden": return "Owner only.";
    case "frozen": return "This version is frozen (active/closed) — questions can't be edited.";
    case "code_taken": return "That question code is already used in this version.";
    case "validation": return issues?.[0] ?? "Please check the fields.";
    case "not_found": return "Question or version not found.";
    default: return "Something went wrong.";
  }
}

export default function QuestionEditor({
  versionId,
  includesFeedbackBlock,
  questions,
}: {
  versionId: string;
  includesFeedbackBlock: boolean;
  questions: EditorQuestionView[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    code: "",
    textEn: "",
    textAr: "",
    visibility: "all",
    isRequired: true,
    isFeedback: false,
    answerType: "free_text",
    allowComment: false,
    allowSkip: false,
    options: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openAdd() {
    setEditingId(null);
    setError(null);
    setForm({
      code: suggestCode(questions, false),
      textEn: "",
      textAr: "",
      visibility: "all",
      isRequired: true,
      isFeedback: false,
      answerType: "free_text",
      allowComment: false,
      allowSkip: false,
      options: [],
    });
    setAddOpen(true);
  }

  function openEdit(q: EditorQuestionView) {
    setAddOpen(false);
    setError(null);
    setForm({
      code: q.code,
      textEn: q.textEn,
      textAr: q.textAr,
      visibility: arrayToVis(q.visibleNationalities),
      isRequired: q.isRequired,
      isFeedback: q.isFeedback,
      answerType: q.answerType,
      allowComment: q.allowComment,
      allowSkip: q.allowSkip,
      // Copy so edits don't mutate the prop-derived array in place.
      options: q.options.map((o) => ({ ...o })),
    });
    setEditingId(q.id);
  }

  function cancel() {
    setAddOpen(false);
    setEditingId(null);
    setError(null);
  }

  function submitAdd() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createQuestionAction({
        versionId,
        code: form.code,
        textEn: form.textEn,
        textAr: form.textAr,
        isRequired: form.isRequired,
        isFeedback: form.isFeedback,
        visibleNationalities: visToArray(form.visibility),
        answerType: form.answerType,
        allowComment: form.allowComment,
        allowSkip: form.allowSkip,
        options: form.answerType === "free_text" ? [] : form.options,
      });
      if (res.ok) {
        setAddOpen(false);
        router.refresh();
      } else {
        setError(errMsg(res.error, res.issues));
      }
    });
  }

  function submitEdit(questionId: string) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await updateQuestionAction({
        questionId,
        code: form.code,
        textEn: form.textEn,
        textAr: form.textAr,
        isRequired: form.isRequired,
        isFeedback: form.isFeedback,
        visibleNationalities: visToArray(form.visibility),
        answerType: form.answerType,
        allowComment: form.allowComment,
        allowSkip: form.allowSkip,
        options: form.answerType === "free_text" ? [] : form.options,
      });
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      } else {
        setError(errMsg(res.error, res.issues));
      }
    });
  }

  function onDelete(q: EditorQuestionView) {
    if (pending) return;
    if (!window.confirm(`Delete ${q.code}? Remaining questions are re-numbered.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteQuestionAction({ questionId: q.id });
      if (res.ok) router.refresh();
      else setError(errMsg(res.error));
    });
  }

  function onMove(q: EditorQuestionView, direction: "up" | "down") {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await moveQuestionAction({ questionId: q.id, direction });
      if (res.ok) router.refresh();
      else setError(errMsg(res.error));
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] text-muted">
          {questions.length} question{questions.length === 1 ? "" : "s"}
        </p>
        {!addOpen && (
          <button type="button" onClick={openAdd} disabled={pending} className="btn-secondary text-[13px]">
            + Add question
          </button>
        )}
      </div>

      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {addOpen && (
        <div className="card p-5 mb-5 border-brand-200">
          <h3 className="text-[14px] font-semibold text-ink mb-3">New question</h3>
          <QuestionFields
            form={form}
            setForm={setForm}
            includesFeedbackBlock={includesFeedbackBlock}
            pending={pending}
          />
          <div className="flex items-center gap-2 mt-4">
            <button type="button" onClick={submitAdd} disabled={pending} className="btn-primary text-[13px] disabled:opacity-40">
              {pending ? "Saving…" : "Add question"}
            </button>
            <button type="button" onClick={cancel} disabled={pending} className="btn-ghost text-[13px]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {questions.length === 0 ? (
        <p className="text-[13px] text-muted">No questions yet. Add the first one.</p>
      ) : (
        <ol className="space-y-3">
          {questions.map((q, i) => (
            <li key={q.id} className="card p-5">
              {editingId === q.id ? (
                <>
                  <h3 className="text-[14px] font-semibold text-ink mb-3">
                    Edit <span className="mono text-brand-700">{q.code}</span>
                  </h3>
                  <QuestionFields
                    form={form}
                    setForm={setForm}
                    includesFeedbackBlock={includesFeedbackBlock}
                    pending={pending}
                  />
                  <div className="flex items-center gap-2 mt-4">
                    <button type="button" onClick={() => submitEdit(q.id)} disabled={pending} className="btn-primary text-[13px] disabled:opacity-40">
                      {pending ? "Saving…" : "Save"}
                    </button>
                    <button type="button" onClick={cancel} disabled={pending} className="btn-ghost text-[13px]">
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex gap-3">
                  <div className="flex flex-col items-center gap-1 pt-0.5">
                    <button type="button" onClick={() => onMove(q, "up")} disabled={pending || i === 0} aria-label="Move up" className="text-muted hover:text-ink disabled:opacity-25 text-[14px] leading-none">▲</button>
                    <span className="mono text-[11px] text-muted-faint">{q.orderIndex}</span>
                    <button type="button" onClick={() => onMove(q, "down")} disabled={pending || i === questions.length - 1} aria-label="Move down" className="text-muted hover:text-ink disabled:opacity-25 text-[14px] leading-none">▼</button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="mono text-[11px] font-semibold text-brand-700">{q.code}</span>
                      {q.isFeedback && <span className="chip-solid bg-brand-50 text-brand-700">feedback</span>}
                      {q.isRequired ? (
                        <span className="chip-solid bg-bgAlt text-muted">required</span>
                      ) : (
                        <span className="chip-solid bg-bgAlt text-muted">optional</span>
                      )}
                      <span className="chip-solid bg-bgAlt text-muted">{VIS_LABEL[arrayToVis(q.visibleNationalities)]}</span>
                      {q.answerType !== "free_text" && (
                        <span className="chip-solid bg-bgAlt text-muted">{ANSWER_TYPE_LABEL[q.answerType]}</span>
                      )}
                    </div>
                    <p className="text-[13px] text-ink mb-1">{q.textEn}</p>
                    <p className="text-[13px] text-ink/80 font-arabic" dir="rtl">{q.textAr}</p>
                    {q.answerType !== "free_text" && q.options.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {q.options.map((o, oi) => (
                          <li key={oi} className="text-[12px] text-muted flex flex-wrap gap-x-2">
                            <span>{oi + 1}. {o.labelEn}</span>
                            <span className="font-arabic" dir="rtl">{o.labelAr}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(q.allowComment || q.allowSkip) && (
                      <p className="text-[11px] text-muted-faint mt-1.5">
                        {[q.allowComment ? "comment allowed" : null, q.allowSkip ? "skippable" : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button type="button" onClick={() => openEdit(q)} disabled={pending} className="btn-ghost text-[12px]">Edit</button>
                    <button type="button" onClick={() => onDelete(q)} disabled={pending} className="btn-ghost text-[12px] text-danger">Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function QuestionFields({
  form,
  setForm,
  includesFeedbackBlock,
  pending,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  includesFeedbackBlock: boolean;
  pending: boolean;
}) {
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isChoice = form.answerType !== "free_text";

  // Switching to a choice type with no options yet seeds 2 blank rows (the
  // authoring minimum). Switching to free_text keeps any rows in state — they
  // simply aren't submitted — so toggling back doesn't lose work.
  function setAnswerType(next: AnswerType) {
    setForm((f) => {
      const becomingChoice = next !== "free_text";
      const options =
        becomingChoice && f.options.length === 0
          ? [
              { labelEn: "", labelAr: "" },
              { labelEn: "", labelAr: "" },
            ]
          : f.options;
      return { ...f, answerType: next, options };
    });
  }

  function addOption() {
    setForm((f) => ({ ...f, options: [...f.options, { labelEn: "", labelAr: "" }] }));
  }
  function removeOption(i: number) {
    setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }));
  }
  function setOption(i: number, key: keyof OptionRow, value: string) {
    setForm((f) => ({
      ...f,
      options: f.options.map((o, j) => (j === i ? { ...o, [key]: value } : o)),
    }));
  }
  function moveOption(i: number, dir: "up" | "down") {
    setForm((f) => {
      const j = dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= f.options.length) return f;
      const next = f.options.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, options: next };
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Question code</label>
          <input className="field mono text-[13px]" value={form.code} disabled={pending} onChange={(e) => set("code", e.target.value)} />
        </div>
        <div>
          <label className="label">Answer type</label>
          <select className="field text-[13px]" value={form.answerType} disabled={pending} onChange={(e) => setAnswerType(e.target.value as AnswerType)}>
            <option value="free_text">{ANSWER_TYPE_LABEL.free_text}</option>
            <option value="single_choice">{ANSWER_TYPE_LABEL.single_choice}</option>
            <option value="multi_choice">{ANSWER_TYPE_LABEL.multi_choice}</option>
          </select>
        </div>
        <div>
          <label className="label">Visible to</label>
          <select className="field text-[13px]" value={form.visibility} disabled={pending} onChange={(e) => set("visibility", e.target.value as Visibility)}>
            <option value="all">All respondents</option>
            <option value="jordanian">Jordanian only</option>
            <option value="syrian">Syrian only</option>
            <option value="both">Jordanian + Syrian</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">English text</label>
        <textarea className="field text-[13px] min-h-[80px]" value={form.textEn} disabled={pending} onChange={(e) => set("textEn", e.target.value)} />
      </div>
      <div>
        <label className="label">Arabic text</label>
        <textarea className="field text-[13px] min-h-[80px] font-arabic" dir="rtl" value={form.textAr} disabled={pending} onChange={(e) => set("textAr", e.target.value)} />
      </div>

      {isChoice && (
        <div className="rounded-md border border-line p-3 space-y-2 bg-bgAlt/40">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Options</label>
            <span className="text-[11px] text-muted">
              At least 2 · each needs English + Arabic
            </span>
          </div>
          {form.options.length === 0 ? (
            <p className="text-[12px] text-muted">No options yet.</p>
          ) : (
            <ol className="space-y-2">
              {form.options.map((o, i) => (
                <li key={i} className="flex items-start gap-2">
                  <div className="flex flex-col items-center gap-0.5 pt-1.5">
                    <button type="button" onClick={() => moveOption(i, "up")} disabled={pending || i === 0} aria-label="Move option up" className="text-muted hover:text-ink disabled:opacity-25 text-[12px] leading-none">▲</button>
                    <span className="mono text-[10px] text-muted-faint">{i + 1}</span>
                    <button type="button" onClick={() => moveOption(i, "down")} disabled={pending || i === form.options.length - 1} aria-label="Move option down" className="text-muted hover:text-ink disabled:opacity-25 text-[12px] leading-none">▼</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 min-w-0">
                    <input className="field text-[13px]" placeholder="English label" value={o.labelEn} disabled={pending} onChange={(e) => setOption(i, "labelEn", e.target.value)} />
                    <input className="field text-[13px] font-arabic" dir="rtl" placeholder="Arabic label" value={o.labelAr} disabled={pending} onChange={(e) => setOption(i, "labelAr", e.target.value)} />
                  </div>
                  <button type="button" onClick={() => removeOption(i)} disabled={pending} aria-label="Remove option" className="btn-ghost text-[12px] text-danger pt-1.5">✕</button>
                </li>
              ))}
            </ol>
          )}
          <button type="button" onClick={addOption} disabled={pending} className="btn-ghost text-[12px]">
            + Add option
          </button>
        </div>
      )}

      <div className="flex items-center gap-5 flex-wrap">
        <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
          <input type="checkbox" checked={form.isRequired} disabled={pending} onChange={(e) => set("isRequired", e.target.checked)} />
          Required
        </label>
        {includesFeedbackBlock && (
          <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
            <input type="checkbox" checked={form.isFeedback} disabled={pending} onChange={(e) => set("isFeedback", e.target.checked)} />
            Feedback question
          </label>
        )}
        {isChoice && (
          <>
            <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
              <input type="checkbox" checked={form.allowComment} disabled={pending} onChange={(e) => set("allowComment", e.target.checked)} />
              Allow comment
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
              <input type="checkbox" checked={form.allowSkip} disabled={pending} onChange={(e) => set("allowSkip", e.target.checked)} />
              Allow skip
            </label>
          </>
        )}
      </div>
    </div>
  );
}
