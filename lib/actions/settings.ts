"use server";

// lib/actions/settings.ts
//
// Self-service submission notification preferences for the current admin
// (Session — notification preferences). Read + save the two submission toggles
// (submission_inapp / submission_email) that gate the response-submitted
// fan-out in lib/notifications.ts.
//
// OWNER-GATED at the app layer; RLS np_self_select / np_self_insert /
// np_self_update are the DB backstop — every policy keys on
// admin_id = current_admin_id(), so an admin can only ever read / write their
// OWN row. The upsert's admin_id comes from getCurrentAdmin(), NEVER from
// client input.
//
// "No row = ON": notification_preferences has no row for an admin until one is
// written, and a missing row means the column DEFAULT never fires — so the read
// path treats null (and any error) as both-true rather than leaning on the DB
// default. Showing "on" when we couldn't read is consistent with no-row=ON and
// never implies an opt-out the user didn't make.
//
// NOT AUDITED (D54): a self-service preference toggle is a trivial self-action
// — like the mark-read actions — not a research-data mutation. We log nothing
// to audit_log here.
//
// Authenticated server client → RLS applies (current_admin_id() scopes both the
// read and the write to self). Returns small { ok }-style results so the client
// island can react.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";

export async function getMySubmissionPrefs(): Promise<{
  ok: boolean;
  submissionInapp: boolean;
  submissionEmail: boolean;
}> {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") {
    return { ok: false, submissionInapp: true, submissionEmail: true };
  }

  try {
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("submission_inapp, submission_email")
      .eq("admin_id", admin.id)
      .maybeSingle();
    if (error) throw error;

    // No row = ON: a missing preferences row means both channels are on.
    return {
      ok: true,
      submissionInapp: data ? data.submission_inapp : true,
      submissionEmail: data ? data.submission_email : true,
    };
  } catch (e) {
    console.error(
      "[settings] read submission prefs failed —",
      (e as Error).message
    );
    // Safe default: both true (consistent with no-row=ON; never a silent
    // opt-out the user didn't make).
    return { ok: false, submissionInapp: true, submissionEmail: true };
  }
}

export async function saveMySubmissionPrefs(input: {
  submissionInapp: boolean;
  submissionEmail: boolean;
}): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin || admin.role !== "owner") return { ok: false };

  try {
    // admin_id from the authenticated identity, NEVER from client input. Only
    // the two surfaced columns are written: on insert the other ten keep their
    // DB defaults, and on update (DO UPDATE SET over the payload only) they're
    // left untouched.
    const { error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          admin_id: admin.id,
          submission_inapp: input.submissionInapp,
          submission_email: input.submissionEmail,
        },
        { onConflict: "admin_id" }
      );
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.error(
      "[settings] save submission prefs failed —",
      (e as Error).message
    );
    return { ok: false };
  }
}
