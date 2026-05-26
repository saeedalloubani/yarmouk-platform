// lib/repos/email-templates.ts
//
// D22 — owner-side reads + writes on email_templates. RLS et_owner_*
// gates writes (an authenticated readonly admin's UPDATE/INSERT/DELETE
// returns zero rows / 23514). The calling actions ALSO owner-gate; this
// is the repo layer the actions call. SELECT is open to owner+readonly
// for the read path (readonly admins can see the customized copy too).
//
// Convention: "no row" = use defaults. The "reset to default" UX deletes
// the row. The renderer + resolveTemplate() in lib/email/templates/
// render.ts overlay any present field on top of defaults, so a partial
// row (e.g. only EN customized, AR blank) renders sensibly without
// editor-side gymnastics.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../supabase/database.types";
import type {
  SectionKey,
  StoredTemplate,
  TemplateFields,
  TemplateId,
} from "../email/templates/types";

const COLS =
  "id, name, description, subject_en, subject_ar, sections_en, sections_ar, updated_at, updated_by";

type Row = {
  id: string;
  name: string;
  description: string;
  subject_en: string;
  subject_ar: string | null;
  sections_en: Json;
  sections_ar: Json | null;
  updated_at: string;
  updated_by: string | null;
};

/** Narrow a JSONB blob to the editable-sections shape, dropping any
 *  unknown keys defensively. (RLS already gates who can write — this is
 *  belt-and-suspenders against a hand-edited row.) */
function asSections(
  raw: Json | null
): TemplateFields["sections"] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Partial<Record<SectionKey, string>> = {};
  const known: SectionKey[] = ["intro", "cta", "personal", "expiry", "contact"];
  for (const k of known) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function rowToStored(r: Row): StoredTemplate {
  return {
    id: r.id as TemplateId,
    name: r.name,
    description: r.description,
    subjectEn: r.subject_en,
    subjectAr: r.subject_ar,
    sectionsEn: asSections(r.sections_en) ?? {},
    sectionsAr: asSections(r.sections_ar),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

/** Read one template row, or null when no customization exists. */
export async function getTemplate(
  supabase: SupabaseClient<Database>,
  id: TemplateId
): Promise<StoredTemplate | null> {
  const { data, error } = await supabase
    .from("email_templates")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToStored(data as Row) : null;
}

/** Upsert one template row. Caller (action) MUST have already validated
 *  every field — RLS + the per-template id CHECK are the structural
 *  backstops, not duplicated here. */
export async function upsertTemplate(
  supabase: SupabaseClient<Database>,
  input: {
    id: TemplateId;
    name: string;
    description: string;
    subjectEn: string;
    subjectAr: string | null;
    sectionsEn: TemplateFields["sections"];
    sectionsAr: TemplateFields["sections"] | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from("email_templates")
    .upsert(
      {
        id: input.id,
        name: input.name,
        description: input.description,
        subject_en: input.subjectEn,
        subject_ar: input.subjectAr,
        sections_en: input.sectionsEn as Json,
        sections_ar: (input.sectionsAr as Json | null) ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
  if (error) throw error;
}

/** Reset = delete row. Renderer + resolveTemplate() then fall through to
 *  defaults for every field. */
export async function deleteTemplate(
  supabase: SupabaseClient<Database>,
  id: TemplateId
): Promise<void> {
  const { error } = await supabase
    .from("email_templates")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
