"use server";

// lib/actions/questionnaires.ts
//
// Owner-only version-lifecycle actions (self-service Stage 1+2 unblock).
//
// activateVersionAction (draft → active):
//   Pre-check status='draft' for a friendly stale-state error; the
//   partial-unique `one_active_version_per_variant` index is the real
//   enforcer (a second active per variant returns 23505, which we map to
//   "variant_already_active" — not a 500). Sets published_at=NOW to mirror
//   the historical seed convention (20260519170011) and to keep the
//   timestamp populated for any future retention/timeline consumer.
//
// closeVersionAction (active → closed):
//   Pre-check status='active'. No DB guard blocks closing — once closed,
//   `tg_questions_draft_only` keeps questions frozen (it treats closed as
//   non-draft), so the analytical dataset is durable. Sets closed_at=NOW.
//
// DELIBERATELY NOT BUILT:
//   - no revert-to-draft path. The only un-freeze remains DB-direct and is
//     guarded by `tg_versions_no_unfreeze_with_responses` when any response
//     exists. Surfacing it in UI is exactly the kind of operation that
//     should stay administrator-direct.
//   - no atomic "publish V2" (close prior + activate next). When a variant
//     already has an active version, the action returns a clean typed error
//     telling the owner to close it first.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  getVersion,
  countQuestionsForVersion,
  updateVersionStatus,
  variantLabel,
} from "@/lib/repos/questionnaires";
import { logAudit } from "@/lib/audit";

export type ActivateResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not_found"
        | "not_draft"
        | "no_questions"
        | "variant_already_active"
        | "server";
    };

export type CloseResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "not_found" | "not_active" | "server";
    };

export async function activateVersionAction(
  versionId: string
): Promise<ActivateResult> {
  const supabase = await createSupabaseServerClient();

  // 1. Owner gate (with forbidden audit for a non-owner *session* — the
  //    unauthenticated case is the route guard's job, not ours). Mirrors
  //    lib/actions/invitations.ts.
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "version.activate.forbidden",
        resource: versionId,
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  // 2. Load + status pre-check. Friendly UX; the DB is the real enforcer.
  const version = await getVersion(supabase, versionId);
  if (!version) return { ok: false, error: "not_found" };
  if (version.status !== "draft") return { ok: false, error: "not_draft" };

  // 2b. D96 — refuse to activate an empty questionnaire. A 0-question draft
  //     sits one click from going live in front of a real respondent. This
  //     is a UX safety rail, not a data-integrity invariant, so there's no
  //     DB guard — the check lives here (the only activation path). No
  //     legitimate caller activates empty: every pilot was activated WITH
  //     seeded questions; the only zero-question drafts are the unactivated
  //     main_* drafts.
  const questionCount = await countQuestionsForVersion(supabase, versionId);
  if (questionCount === 0) return { ok: false, error: "no_questions" };

  // 3. Flip. The one_active_version_per_variant partial unique index
  //    rejects a second active per variant — surface as a typed error.
  try {
    await updateVersionStatus(supabase, versionId, {
      status: "active",
      publishedAt: new Date().toISOString(),
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return { ok: false, error: "variant_already_active" };
    }
    console.error("[questionnaires] activate failed", err);
    return { ok: false, error: "server" };
  }

  // 4. Audit AFTER the write succeeds (matches invitations.ts ordering —
  //    a failed audit must not roll back a completed mutation).
  await logAudit(supabase, {
    action: "version.activate",
    resource: `${variantLabel(version.variant)} v${version.versionNumber}`,
    severity: "info",
    metadata: {
      versionId,
      variant: version.variant,
      versionNumber: version.versionNumber,
    },
  });

  return { ok: true };
}

export async function closeVersionAction(
  versionId: string
): Promise<CloseResult> {
  const supabase = await createSupabaseServerClient();

  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    if (admin) {
      await logAudit(supabase, {
        action: "version.close.forbidden",
        resource: versionId,
        severity: "warn",
        metadata: { attemptedBy: admin.id, role: admin.role },
      });
    }
    return { ok: false, error: "forbidden" };
  }

  const version = await getVersion(supabase, versionId);
  if (!version) return { ok: false, error: "not_found" };
  if (version.status !== "active") return { ok: false, error: "not_active" };

  try {
    await updateVersionStatus(supabase, versionId, {
      status: "closed",
      closedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[questionnaires] close failed", err);
    return { ok: false, error: "server" };
  }

  await logAudit(supabase, {
    action: "version.close",
    resource: `${variantLabel(version.variant)} v${version.versionNumber}`,
    severity: "info",
    metadata: {
      versionId,
      variant: version.variant,
      versionNumber: version.versionNumber,
    },
  });

  return { ok: true };
}
