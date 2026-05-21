"use server";

// lib/actions/tags.ts
//
// Owner-only tagging actions for the response detail page (3c-ii). First
// admin mutations on the responses side. Each action mirrors the
// invitations.ts contract:
//   owner gate (+ forbidden audit for an authenticated non-owner)
//   → validate (zod)
//   → mutate (via lib/repos/tags.ts)
//   → logAudit AFTER the mutation succeeds (D54).
//
// Defense in depth: the UI hides these controls from readonly, the owner
// gate below refuses a readonly caller, and RLS (t_owner_*, rt_owner_*) is
// the DB backstop. A readonly admin reaching here is the security event the
// audit log exists for — record it (warn) before refusing.
//
// AUDIT METADATA is non-PII: a tag NAME is a research code (e.g.
// "water-scarcity"), not respondent identity — safe to log. Resource is the
// responseId (no extra invitation fetch needed).

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { findOrCreateTag, applyTag, removeTag } from "@/lib/repos/tags";
import { logAudit } from "@/lib/audit";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// addTagToResponseAction — create-or-pick a tag + apply it (owner-only)
// ---------------------------------------------------------------------------

const addSchema = z.object({
  responseId: z.string().regex(UUID_RE, "Invalid response id"),
  name: z.string().trim().min(1, "Tag name is required").max(80, "Tag name too long"),
  category: z.enum(["theme", "stance", "perspective"]),
});

export type AddTagInput = {
  responseId: string;
  name: string;
  category: string;
};

export type AddTagResult =
  | { ok: true; tag: { id: string; name: string; category: string } }
  | {
      ok: false;
      error: "forbidden" | "validation" | "server";
      issues?: string[];
    };

export async function addTagToResponseAction(
  input: AddTagInput
): Promise<AddTagResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit for an authenticated non-owner).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "tag.apply.forbidden",
        resource: typeof input?.responseId === "string" ? input.responseId : "",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Validate.
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      issues: parsed.error.issues.map((i) => i.message),
    };
  }
  const v = parsed.data;

  // 3. Create-or-pick the tag, apply it, then audit the resolved tag.
  try {
    const tag = await findOrCreateTag(supabase, {
      name: v.name,
      category: v.category,
      adminId: admin.id,
    });
    await applyTag(supabase, v.responseId, tag.id, admin.id);
    await logAudit(supabase, {
      action: "tag.apply",
      resource: v.responseId,
      severity: "info",
      metadata: { tagId: tag.id, tagName: tag.name, category: tag.category },
    });
    return { ok: true, tag };
  } catch (err) {
    console.error("[tags] addTagToResponse failed", err);
    return { ok: false, error: "server" };
  }
}

// ---------------------------------------------------------------------------
// removeTagFromResponseAction — unapply a tag (owner-only)
// ---------------------------------------------------------------------------

const removeSchema = z.object({
  responseId: z.string().regex(UUID_RE, "Invalid response id"),
  tagId: z.string().regex(UUID_RE, "Invalid tag id"),
});

export type RemoveTagInput = {
  responseId: string;
  tagId: string;
};

export type RemoveTagResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "validation" | "server" };

export async function removeTagFromResponseAction(
  input: RemoveTagInput
): Promise<RemoveTagResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (+ forbidden audit).
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "tag.remove.forbidden",
        resource: typeof input?.responseId === "string" ? input.responseId : "",
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Validate.
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const v = parsed.data;

  // 3. Remove (the tag itself stays in the vocabulary) + audit.
  try {
    const tagName = await removeTag(supabase, v.responseId, v.tagId);
    await logAudit(supabase, {
      action: "tag.remove",
      resource: v.responseId,
      severity: "info",
      metadata: { tagId: v.tagId, tagName },
    });
    return { ok: true };
  } catch (err) {
    console.error("[tags] removeTagFromResponse failed", err);
    return { ok: false, error: "server" };
  }
}
