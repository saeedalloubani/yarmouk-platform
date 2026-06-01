// lib/notifications.ts
//
// Notification fan-out orchestrator (Session — notifications). The single
// entry point the respondent submit path calls after finalizing a response.
//
// THE LOAD-BEARING PROPERTY: notifyOwnersOfSubmission CANNOT THROW under any
// path. The respondent's submit + redirect must be untouchable by a
// notification failure (in-app OR email). Every step is independently wrapped
// and only logs; the whole body is additionally wrapped so a failure resolving
// owners / building content can't escape either. The caller awaits it (a
// serverless function can't reliably detach background work) BEFORE redirect()
// — and deliberately NOT inside a try that wraps the redirect, since redirect
// throws NEXT_REDIRECT.
//
// Distinct logs (as specified): "[notify] in-app write failed" vs
// "[notify] email send failed" / "[notify] email threw".
//
// Takes the SERVICE-ROLE admin client (the respondent has no admin JWT):
// createNotification + getActiveOwnersToNotify run RLS-bypass; content is
// identity-free (ref_code, never the respondent's name). The fan-out honors
// each owner's submission_inapp / submission_email preference (no row = ON).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/database.types";
import { createNotification, getActiveOwnersToNotify } from "./repos/notifications";
import { sendSubmissionEmail } from "./email/submission";
import { logSystemEmailFailure } from "./audit";

/**
 * Notify all active owners that a response was submitted: an in-app row +
 * a best-effort email each. NEVER throws. Returns void; failures are logged.
 */
export async function notifyOwnersOfSubmission(
  admin: SupabaseClient<Database>,
  { invitationId, responseId }: { invitationId: string; responseId: string }
): Promise<void> {
  try {
    // 1. ref_code (non-PII, plaintext) for the body. Best-effort: a failure
    //    falls back to a generic body rather than aborting the fan-out.
    let refCode: string | null = null;
    try {
      const { data } = await admin
        .from("invitations")
        .select("ref_code")
        .eq("id", invitationId)
        .maybeSingle();
      refCode = data?.ref_code ?? null;
    } catch (e) {
      console.error("[notify] ref_code lookup failed —", (e as Error).message);
    }

    // 2. Resolve targets, each annotated with their submission preferences.
    const owners = await getActiveOwnersToNotify(admin);
    if (owners.length === 0) {
      console.error("[notify] no active owners to notify");
      return;
    }

    const title = "New response submitted";
    const body = refCode
      ? `Response ${refCode} was submitted.`
      : "A response was submitted.";
    const relHref = `/admin/responses/${responseId}`;

    // Absolute link for the email (in-app uses the relative href). Optional —
    // if NEXT_PUBLIC_SITE_URL is unset we simply omit the link (never throw).
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
    const emailHref = siteUrl ? `${siteUrl}${relHref}` : undefined;

    for (const owner of owners) {
      // 2a. In-app row — distinct failure log; one owner failing doesn't
      //     stop the others. Gated on the owner's preference: an opt-out is
      //     skipped silently (not a failure, so no log).
      if (owner.submissionInapp) {
        try {
          await createNotification(admin, {
            recipientAdminId: owner.id,
            type: "submission",
            title,
            body,
            href: relHref,
          });
        } catch (e) {
          console.error(
            "[notify] in-app write failed for owner",
            owner.id,
            "—",
            (e as Error).message
          );
        }
      }

      // 2b. Email — best-effort. sendSubmissionEmail self-catches and returns
      //     { ok }; the extra try guards the missing-API-key throw. Gated on
      //     the owner's preference: an opt-out is skipped silently.
      //
      //     D64 — audit-on-failure via logSystemEmailFailure (service-role
      //     direct insert, actor='system') because the respondent has no
      //     admin JWT in this path. errorClass buckets the failure
      //     WITHOUT carrying raw Resend error.message (which can echo
      //     recipient addresses). NO last_send_failed_at write —
      //     submission has no invitation reference at all.
      if (owner.submissionEmail) {
        try {
          const sent = await sendSubmissionEmail({
            to: owner.email,
            refCode: refCode ?? "—",
            href: emailHref,
          });
          if (!sent.ok) {
            console.error(
              "[notify] email send failed for owner",
              owner.id,
              "errorClass=" + sent.errorClass
            );
            await logSystemEmailFailure(
              "response.submission_email_failed",
              {
                resource: refCode ?? "—",
                metadata: {
                  responseId,
                  refCode: refCode ?? null,
                  ownerAdminId: owner.id,
                  errorClass: sent.errorClass,
                },
              }
            );
          }
        } catch {
          // D64 — wrapper-throw (RESEND_API_KEY missing). Drop the error
          // object from the log (its toString could echo recipient
          // under some SDK failure modes).
          console.error(
            "[notify] email threw for owner",
            owner.id,
            "errorClass=config"
          );
          await logSystemEmailFailure(
            "response.submission_email_failed",
            {
              resource: refCode ?? "—",
              metadata: {
                responseId,
                refCode: refCode ?? null,
                ownerAdminId: owner.id,
                errorClass: "config",
              },
            }
          );
        }
      }
    }
  } catch (e) {
    // Catch-all backstop: nothing in this function may escape to the caller.
    console.error("[notify] submission fan-out failed —", (e as Error).message);
  }
}
