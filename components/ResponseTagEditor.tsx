"use client";

// components/ResponseTagEditor.tsx
//
// Tags island on the response detail page (3c-ii). BOTH roles see the
// applied-tag chips (RLS admits readonly SELECT on tags/response_tags); only
// the OWNER gets the add form + per-chip remove (canEdit). The server action
// owner-gates regardless, and RLS is the DB backstop — canEdit only governs
// what's rendered.
//
// The applied list is local state (instant add/remove); persistence is via
// the actions. A hard reload re-reads from the DB, so the optimistic list
// always reconciles with the source of truth.

import { useState, useTransition } from "react";
import {
  addTagToResponseAction,
  removeTagFromResponseAction,
} from "@/lib/actions/tags";

type Category = "theme" | "stance" | "perspective";

export type EditorTag = {
  id: string;
  name: string;
  category: Category;
};

const CATEGORIES: Category[] = ["theme", "stance", "perspective"];

export default function ResponseTagEditor({
  responseId,
  initialTags,
  allTagNames,
  canEdit,
}: {
  responseId: string;
  initialTags: EditorTag[];
  allTagNames: string[];
  canEdit: boolean;
}) {
  const [tags, setTags] = useState<EditorTag[]>(initialTags);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("theme");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await addTagToResponseAction({
        responseId,
        name: trimmed,
        category,
      });
      if (res.ok) {
        // De-dupe: applying an already-present tag is a server no-op.
        setTags((prev) =>
          prev.some((t) => t.id === res.tag.id)
            ? prev
            : [
                {
                  id: res.tag.id,
                  name: res.tag.name,
                  category: res.tag.category as Category,
                },
                ...prev,
              ]
        );
        setName("");
      } else {
        setError(
          res.error === "forbidden"
            ? "Owner only."
            : res.error === "validation"
              ? (res.issues?.[0] ?? "Invalid tag.")
              : "Something went wrong."
        );
      }
    });
  }

  function onRemove(tagId: string) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await removeTagFromResponseAction({ responseId, tagId });
      if (res.ok) {
        setTags((prev) => prev.filter((t) => t.id !== tagId));
      } else {
        setError(res.error === "forbidden" ? "Owner only." : "Something went wrong.");
      }
    });
  }

  return (
    <div>
      {tags.length === 0 ? (
        <p className="text-[13px] text-muted mb-3">No tags applied.</p>
      ) : (
        <ul className="flex flex-wrap gap-2 mb-3">
          {tags.map((t) => (
            <li
              key={t.id}
              className="chip-solid bg-brand-50 text-brand-700 inline-flex items-center gap-1.5"
            >
              <span>{t.name}</span>
              <span className="text-[10px] text-muted lowercase">{t.category}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onRemove(t.id)}
                  disabled={pending}
                  aria-label={`Remove tag ${t.name}`}
                  className="ms-0.5 text-muted hover:text-danger disabled:opacity-40"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">Tag</label>
            <input
              className="field text-[13px]"
              list="tag-name-options"
              placeholder="e.g. water-scarcity"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <datalist id="tag-name-options">
              {allTagNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label">Category</label>
            <select
              className="field text-[13px]"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={pending || name.trim().length === 0}
            className="btn-secondary text-[13px] disabled:opacity-40"
          >
            {pending ? "Saving…" : "Add tag"}
          </button>
        </form>
      )}

      {error && <p className="text-[12px] text-danger mt-2">{error}</p>}
    </div>
  );
}
