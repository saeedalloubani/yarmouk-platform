// lib/email/preview.ts
//
// D79 Feature 4 — server-side render of an invitation's email body for
// inline preview on /admin/invitations. NEVER sends. Reuses the EXACT
// same render pipeline (renderEmailTemplate + resolveTemplate + getDefaults)
// that lib/email/reminder.ts uses on the send path, so the preview is
// byte-identical to what the recipient would see for the same kind.
//
// Owner-only — the caller must verify admin.role === 'owner' before
// calling. The function decrypts recipient_name (owner-only data) and
// composes the live token URL, which is owner-only forensic info; both
// are SAFE to display to Sura on her own owner-gated page.
//
// PII handling: decrypted values stay scoped to this function — the
// returned { subject, html } strings contain whatever the renderer
// produces (which escapes user input). Caller embeds the html via
// dangerouslySetInnerHTML in the disclosure body; same posture as the
// audit-log Details cell (D77) — known-trusted producer, sanitized
// values, render direct.
//
// Locked to "reminder1" kind for D79 — this matches what the
// SendReminderButton dispatches. If we later add a previewer for the
// invitation or reminderFinal templates, take a kind param here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTemplate } from "@/lib/repos/email-templates";
import { getDefaults } from "@/lib/email/templates/defaults";
import {
  renderEmailTemplate,
  resolveTemplate,
} from "@/lib/email/templates/render";
import { buildInvitationUrl } from "@/lib/tokens";

export type EmailPreview = {
  subject: string;
  html: string;
  /** The kind we rendered (locked to 'reminder1' in D79). */
  kind: "reminder1";
};

/**
 * Render the reminder1 preview HTML for an invitation. Returns null on
 * any decrypt / config / template failure — preview is best-effort; a
 * null result tells the page to skip the <details> for this row, not to
 * surface an error chrome.
 *
 * Pass the FULL invitation row (selected from the base table with
 * encrypted columns). The caller has already verified ownership; we
 * don't re-check here.
 */
export async function renderReminderPreview(
  supabase: SupabaseClient<Database>,
  inv: {
    id: string;
    refCode: string;
    preferredLanguage: "en" | "ar";
    expiresAt: string;
    recipientNameEncrypted: string | null;
    tokenPlaintextEncrypted: string | null;
    accessCodeEncrypted: string | null;
  }
): Promise<EmailPreview | null> {
  // ── 1. Required ciphertexts ───────────────────────────────────────
  // Reminder requires both token plaintext (for the URL) and access
  // code (for the {access_code} placeholder). Missing either → null.
  if (!inv.tokenPlaintextEncrypted || !inv.accessCodeEncrypted) {
    return null;
  }

  // ── 2. Decrypt — parallel for the three values ────────────────────
  // Name is non-fatal (D72 — degrades to empty). Token + code are hard
  // requirements; a decrypt failure for either returns null.
  const [nameRes, tokenRes, codeRes] = await Promise.all([
    inv.recipientNameEncrypted
      ? supabase.rpc("decrypt_pii", {
          p_ciphertext: inv.recipientNameEncrypted,
        })
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc("decrypt_pii", {
      p_ciphertext: inv.tokenPlaintextEncrypted,
    }),
    supabase.rpc("decrypt_pii", {
      p_ciphertext: inv.accessCodeEncrypted,
    }),
  ]);

  if (tokenRes.error || !tokenRes.data) {
    console.error(
      "[preview] decrypt(token) failed for",
      inv.refCode,
      "errorClass=config"
    );
    return null;
  }
  if (codeRes.error || !codeRes.data) {
    console.error(
      "[preview] decrypt(access_code) failed for",
      inv.refCode,
      "errorClass=config"
    );
    return null;
  }
  const namePlain: string =
    typeof nameRes.data === "string" ? nameRes.data : "";

  // ── 3. Build the token URL ────────────────────────────────────────
  let tokenUrl: string;
  try {
    tokenUrl = buildInvitationUrl(tokenRes.data);
  } catch {
    console.error(
      "[preview] buildInvitationUrl failed for",
      inv.refCode,
      "errorClass=config"
    );
    return null;
  }

  // ── 4. Load template customization (via admin client, mirroring the
  //      reminder wrapper's pattern). DB-load failure is non-aborting
  //      — defaults still produce a working preview.
  let storedSubject: string | null = null;
  let storedSections: Partial<Record<string, string>> | null = null;
  try {
    const adminClient = createSupabaseAdminClient();
    const row = await getTemplate(adminClient, "reminder1");
    if (row) {
      if (inv.preferredLanguage === "ar") {
        storedSubject = row.subjectAr;
        storedSections = row.sectionsAr ?? null;
      } else {
        storedSubject = row.subjectEn;
        storedSections = row.sectionsEn;
      }
    }
  } catch {
    console.error(
      "[preview] template load failed for",
      inv.refCode,
      "errorClass=config (non-aborting; falling back to defaults)"
    );
  }

  // ── 5. Resolve + render ───────────────────────────────────────────
  const defaults = getDefaults("reminder1");
  const localeDefaults =
    inv.preferredLanguage === "ar" ? defaults.ar : defaults.en;
  if (!localeDefaults) {
    console.error(
      "[preview] reminder1 defaults missing for lang",
      inv.preferredLanguage,
      "errorClass=config"
    );
    return null;
  }
  const template = resolveTemplate({
    templateId: "reminder1",
    lang: inv.preferredLanguage,
    defaultSubject: localeDefaults.subject,
    defaultSections: localeDefaults.sections,
    overlaySubject: storedSubject,
    overlaySections: storedSections ?? null,
  });

  const isAr = inv.preferredLanguage === "ar";
  const expiry_date = new Date(inv.expiresAt).toLocaleDateString(
    isAr ? "ar-JO" : "en-GB",
    { year: "numeric", month: "long", day: "numeric" }
  );

  const { subject, html } = renderEmailTemplate({
    template,
    values: {
      name: namePlain,
      expiry_date,
      ref_code: inv.refCode,
      access_code: codeRes.data,
      button_href: tokenUrl,
    },
  });

  return { subject, html, kind: "reminder1" };
}
