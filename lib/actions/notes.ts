"use server";

// lib/actions/notes.ts
//
// Owner-ONLY researcher-note action (3c-ii). Same contract as tags.ts /
// invitations.ts: owner gate (+ forbidden audit) → validate → upsert →
// audit. researcher_notes are the researcher's private working annotations
// — supervisors never see them (rn_owner_select, migration 16) and can't
// write them (rn_owner_insert/update). This action is the application-layer
// half of that boundary; RLS is the DB backstop.
//
// AUDIT PRIVACY (D54): the note BODY never enters audit_log — we log a char
// count only. audit_log is an operational surface; a free-text note is
// exactly the kind of content that must not leak there.

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { upsertResearcherNote } from "@/lib/repos/notes";
import { logAudit } from "@/lib/audit";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Generous cap — notes are working annotations, not documents. Empty is
// allowed (clearing the note).
const NOTE_MAX = 20000;

const schema = z.object({
  responseId: z.string().regex(UUID_RE, "Invalid response id"),
  noteText: z.string().max(NOTE_MAX, "Note is too long"),
});

export type SaveNoteInput = {
  responseId: string;
  noteText: string;
};

export type SaveNoteResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "validation" | "server";
      issues?: string[];
    };

export async function saveResearcherNoteAction(
  input: SaveNoteInput
): Promise<SaveNoteResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit for an authenticated non-owner).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "note.save.forbidden",
        resource: typeof input?.responseId === "string" ? input.responseId : "",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Validate.
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      issues: parsed.error.issues.map((i) => i.message),
    };
  }
  const v = parsed.data;

  // 3. Upsert (one note per response) + audit a CHARACTER COUNT only.
  try {
    await upsertResearcherNote(supabase, v.responseId, v.noteText, admin.id);
    await logAudit(supabase, {
      action: "note.save",
      resource: v.responseId,
      severity: "info",
      metadata: { chars: v.noteText.trim().length }, // NEVER the body
    });
    return { ok: true };
  } catch (err) {
    console.error("[notes] saveResearcherNote failed", err);
    return { ok: false, error: "server" };
  }
}
