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

export type EditorQuestionView = {
  id: string;
  code: string;
  orderIndex: number;
  textEn: string;
  textAr: string;
  isFeedback: boolean;
  isRequired: boolean;
  visibleNationalities: Nat[] | null;
};

type FormState = {
  code: string;
  textEn: string;
  textAr: string;
  visibility: Visibility;
  isRequired: boolean;
  isFeedback: boolean;
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
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="mono text-[11px] font-semibold text-brand-700">{q.code}</span>
                      {q.isFeedback && <span className="chip-solid bg-brand-50 text-brand-700">feedback</span>}
                      {q.isRequired ? (
                        <span className="chip-solid bg-bgAlt text-muted">required</span>
                      ) : (
                        <span className="chip-solid bg-bgAlt text-muted">optional</span>
                      )}
                      <span className="chip-solid bg-bgAlt text-muted">{VIS_LABEL[arrayToVis(q.visibleNationalities)]}</span>
                    </div>
                    <p className="text-[13px] text-ink mb-1">{q.textEn}</p>
                    <p className="text-[13px] text-ink/80 font-arabic" dir="rtl">{q.textAr}</p>
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
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Question code</label>
          <input className="field mono text-[13px]" value={form.code} disabled={pending} onChange={(e) => set("code", e.target.value)} />
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
      <div className="flex items-center gap-5">
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
      </div>
    </div>
  );
}
