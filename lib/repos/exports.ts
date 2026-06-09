// lib/repos/exports.ts
//
// D74 — read-aggregation for the Pilot Response Export Center
// (/admin/exports). Long-format (1 row per response × answer), 18
// denormalized columns, PII decrypted for the owner.
//
// ACCESS POSTURE — OWNER-ONLY BY CONSTRUCTION. This repo deliberately
// queries the `invitations` BASE TABLE directly (not invitations_redacted),
// because the only call sites (app/admin/(protected)/exports/page.tsx +
// app/admin/(protected)/exports/download/route.ts) redirect/403 non-owners
// BEFORE this repo loads. A readonly admin reaching this code path is a
// programming error; the page-level owner gate is the contract.
//
// PII DECRYPT POSTURE — ALL-OR-NOTHING. Iterates invitations, calling
// decrypt_pii for recipient_name + recipient_email. The FIRST decrypt
// failure throws ExportDecryptFailedError; no partial export is ever
// returned. The route handler catches this, writes a warn-severity audit
// row with errorClass='config' (never error.message), and surfaces a safe
// banner to the user. error.message from the Vault RPC can echo recipient
// PII in unusual key-rotation states and is NEVER logged or persisted.
//
// EXCLUDED BY DESIGN:
//   - token_hash + token_plaintext_encrypted + access_code_encrypted —
//     one-time auth secrets, NOT research data (RUNBOOK-recovery
//     artifacts only).
//   - consent_records.signed_name_encrypted — col 12 is the timestamp
//     only (boolean-equivalent: signed_at non-null ⇒ consent given). The
//     participant's name in the invitation row (col 2) is the canonical
//     identity; the consent signature is a legal artifact, not analytical
//     data.
//
// FILTERS — submitted + ACTIVE responses only (matches D63 cross-cutting
// filter map for analytical surfaces). Withdrawn participants must not
// appear in the analytical dataset. is_locked is NOT a filter (lock = edit
// gating, not analytical exclusion).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
// D95 — canonical variant→label for the long-format `variant` column.
// Pure function; one source of truth with the D94 chips + analytics.
import { variantLabel } from "./questionnaires";

export type ExportRow = {
  refCode: string;
  // D95 — study/variant provenance so a bulk export can never silently
  // blend variants without a trace. `variant` is the canonical
  // variantLabel() form (e.g. "Pilot · Officials", "Main · Officials
  // (Jordanian)") — one source of truth with the D94 chips + analytics.
  // `questionnaireVersion` is the version_number. Both are NON-PII
  // operational metadata (no PII column added — see file header).
  variant: string;
  questionnaireVersion: number;
  recipientName: string;
  recipientEmail: string;
  category: string;
  nationality: string | null;
  preferredLanguage: string;
  collectionMode: string;
  sentAt: string | null;
  openedAt: string | null;
  startedAt: string;
  submittedAt: string;
  consentSignedAt: string | null;
  questionCode: string;
  questionOrderIndex: number;
  isFeedback: boolean;
  questionTextEn: string;
  questionTextAr: string;
  answerText: string;
};

/**
 * D85 — Optional bulk-scope filters. Empty array on any axis means
 * "no filter applied for this axis" (matches the wide-format posture
 * in AtlasExportFilters + the modal's "leave all unchecked" UX). The
 * route validates enum membership BEFORE the call reaches this layer;
 * by the time we filter, every value here is allowlist-safe.
 *
 * Single-scope ignores filters entirely (responseId is authoritative);
 * the type encodes this by attaching `filters?` only to the bulk arm.
 */
export type ExportFilters = {
  category?: string[];
  nationality?: string[];
  language?: string[];
  /**
   * D95 — pilot/main SCOPE filter: a SET of questionnaire_version_ids
   * (resolved by the caller from questionnaire_versions.type via
   * lib/repos/scope.ts, same mechanism as D93/D94). Applied in the
   * in-memory bulk filter pass alongside category/nationality/language
   * (AND-composition). Undefined → no version filter (the "All studies"
   * scope). An empty array matches zero rows — honest empty for a scope
   * with no versions yet. Single-scope ignores this (responseId is
   * authoritative).
   */
  versionIds?: string[];
};

export type ExportScope =
  | { scope: "single"; responseId: string }
  | { scope: "bulk"; filters?: ExportFilters };

/**
 * Thrown when ANY decrypt_pii call returns an error or null. Carries the
 * ref_code that failed so the route handler can record forensic context
 * — never the underlying error.message (PII echo risk).
 */
export class ExportDecryptFailedError extends Error {
  constructor(public readonly refCode: string) {
    super(`PII decrypt failed for invitation ${refCode}`);
    this.name = "ExportDecryptFailedError";
  }
}

// ═══════════════════════════════════════════════════════════════════════
// D84 — ATLAS.ti wide-format export
// ═══════════════════════════════════════════════════════════════════════
//
// Sister pipeline to getResponsesForExport. Same access posture
// (OWNER-ONLY by construction — route gates before this loads), but a
// different INTERNAL SHAPE for wide-format pivot in the serializers:
//
//   - 1 row per RESPONSE (not per answer). Answers carried as a
//     Map<questionCode, answerText>; serializers fan out into columns.
//   - Single-variant scope ENFORCED (D84 Strategy 3): all rows in one
//     export share one questionnaire_version_id. The category filter is
//     the UI-side constraint; the BACKEND DEFENDS by computing the set
//     of distinct version_ids from the matched invitations and throwing
//     AtlasMultiVariantError if more than one is present.
//   - NO PII columns (D84 Q-J): wide-format excludes recipient_name +
//     recipient_email. The whole decrypt fan-out from D75 is SKIPPED.
//     ref_code is the document handle in ATLAS; PII isn't analytical.
//
// Filters (bulk scope only — single scope is authoritative via responseId):
//   - category: single category (Strategy 3 single-variant requirement)
//   - nationality: subset of {jordanian, syrian, not_applicable}; empty = all
//   - language: subset of {en, ar}; empty = all
//
// The serializers (lib/exports/atlasti-xlsx.ts, lib/exports/atlasti-csv.ts)
// consume the returned AtlasExportPayload, build their header row from
// payload.questions (in order_index ASC), and emit one row per
// payload.rows entry.

/** Thrown when a wide-format export's matched responses span more than
 *  one questionnaire_version_id. Strategy 3 single-variant invariant. */
export class AtlasMultiVariantError extends Error {
  constructor(public readonly variantCount: number) {
    super(
      `Wide-format export requires a single questionnaire variant; ${variantCount} variants matched`
    );
    this.name = "AtlasMultiVariantError";
  }
}

/** Question metadata for the column-header build pass. Mirrors the
 *  visible-question set of the scoped variant (ALL questions, regardless
 *  of visible_nationalities — for SYR-only questions, JOR respondents
 *  show empty cells, which is what ATLAS expects). */
export type AtlasQuestion = {
  code: string;        // "Q1", "F1", ...
  textEn: string;      // label after `::` in column header
  orderIndex: number;
  isFeedback: boolean;
};

/** One row of the wide-format pivot. Static metadata + answers map keyed
 *  by question_code + tags array. The serializers fan out `answers` into
 *  per-question columns from payload.questions; tags is joined by `,`
 *  for the `#tags` column (D84 Q-K — tags table empty today, literal
 *  comma is safe; backlog item for tag-name validation at apply time). */
export type AtlasResponseRow = {
  refCode: string;
  category: string;
  nationality: string | null;
  preferredLanguage: string;
  collectionMode: string;
  submittedAt: string;
  consentSignedAt: string | null;
  /** question_code → answer_text (empty/missing entries → blank cell). */
  answers: Map<string, string>;
  /** Tag names in apply-order (newest first to match the UI surface). */
  tags: string[];
};

export type AtlasExportPayload = {
  /** Variant of the scoped questionnaire (e.g. "pilot_officials"). One
   *  per export by Strategy 3 invariant. Surfaced for filename + audit. */
  variant: string;
  /** Questions in column order (order_index ASC). Q1-Qn first, then
   *  F1-Fn (is_feedback=true also sorted by order_index). The
   *  serializers emit one Q::label column per entry. */
  questions: AtlasQuestion[];
  /** One entry per matched submitted+active response. Empty array is
   *  valid (header-only output for bulk; route handler maps to 404 for
   *  single). */
  rows: AtlasResponseRow[];
};

export type AtlasExportFilters =
  | {
      scope: "single";
      responseId: string;
    }
  | {
      scope: "bulk";
      category: string;             // single value (Strategy 3); enum: officials|researchers|donors|ngos
      nationality?: string[];       // empty/undefined = all
      language?: string[];          // empty/undefined = all (en|ar)
    };

/**
 * D84 — Wide-format response export aggregator.
 *
 * Reads:
 *   1. responses — submitted + active (matches D63 cascade).
 *   2. invitations (NON-PII columns ONLY via invitations_redacted view —
 *      wide-format excludes recipient name/email per Q-J, so we don't
 *      need base-table access). Defense-in-depth: even if the route's
 *      owner gate slipped, no PII column is selected.
 *   3. questionnaire_versions — for variant label + single-variant guard.
 *   4. questions — full question set for the scoped variant, used as the
 *      column header source (every Q-code becomes a column; respondents
 *      who didn't see that question have a blank cell).
 *   5. answers — flat (response_id, question_code, answer_text) joined to
 *      questions for code resolution.
 *   6. consent_records — signed_at timestamp only.
 *   7. response_tags + tags — name list per response.
 *
 * Returns AtlasExportPayload. Empty payload (zero rows) is a legitimate
 * return — the route handler treats it the same way as long-format
 * empty (404 for single, header-only for bulk).
 *
 * Throws AtlasMultiVariantError if the matched invitations span more
 * than one questionnaire_version_id. This is a Strategy 3 invariant
 * violation; the UI single-category enforcement is the primary
 * protection.
 */
export async function getResponsesForAtlasExport(
  supabase: SupabaseClient<Database>,
  filters: AtlasExportFilters
): Promise<AtlasExportPayload> {
  // ── 1. Responses — submitted + active ─────────────────────────────
  let rq = supabase
    .from("responses")
    .select("id, invitation_id, language, submitted_at, status")
    .not("submitted_at", "is", null)
    .eq("status", "active")
    .order("submitted_at", { ascending: true });
  if (filters.scope === "single") rq = rq.eq("id", filters.responseId);
  const { data: respRows, error: rErr } = await rq;
  if (rErr) throw rErr;
  let responses = respRows ?? [];
  if (responses.length === 0) {
    // Empty payload — caller decides 404 vs header-only-file. We still
    // need a `variant` label for filename + audit even on empty; for
    // single-scope this means there was no row at all (404), for
    // bulk-scope the filter matched zero responses (header-only). We
    // can't resolve a variant without at least one matched row, so
    // we return a synthetic "no_variant" sentinel. The route handler
    // for bulk-empty doesn't surface the variant to the user.
    return { variant: "no_variant", questions: [], rows: [] };
  }

  // ── 2. Invitations (NON-PII columns only via invitations_redacted) ─
  // The redacted view exposes ref_code + category + nationality +
  // preferred_language + collection_mode + questionnaire_version_id —
  // exactly what we need. recipient_*_encrypted is NULLed in the view.
  // D74 base-table access pattern intentionally NOT mirrored here:
  // wide-format excludes PII (Q-J), so the view is the right read.
  const invitationIds = Array.from(
    new Set(responses.map((r) => r.invitation_id))
  );
  const { data: invRows, error: iErr } = await supabase
    .from("invitations_redacted")
    .select(
      "id, ref_code, category, nationality, preferred_language, collection_mode, questionnaire_version_id"
    )
    .in("id", invitationIds);
  if (iErr) throw iErr;
  const invitations = invRows ?? [];

  // ── 2b. Apply bulk-scope filters in-memory ────────────────────────
  // PostgREST IN-list filters would also work, but applying in-memory
  // keeps the SQL simpler and the response set is small (pilot scale).
  // Single-scope filters are IGNORED — the responseId is authoritative.
  let filteredInvIds: Set<string>;
  if (filters.scope === "bulk") {
    const natSet = filters.nationality?.length
      ? new Set(filters.nationality)
      : null;
    const langSet = filters.language?.length
      ? new Set(filters.language)
      : null;
    filteredInvIds = new Set(
      invitations
        .filter((i) => i.category === filters.category)
        .filter((i) =>
          natSet ? i.nationality !== null && natSet.has(i.nationality) : true
        )
        .filter((i) =>
          langSet ? langSet.has(i.preferred_language ?? "") : true
        )
        .map((i) => i.id!)
        .filter((id): id is string => id !== null)
    );
  } else {
    filteredInvIds = new Set(
      invitations
        .map((i) => i.id)
        .filter((id): id is string => id !== null && id !== undefined)
    );
  }

  responses = responses.filter((r) => filteredInvIds.has(r.invitation_id));
  if (responses.length === 0) {
    return { variant: "no_variant", questions: [], rows: [] };
  }

  // ── 3. Single-variant guard (Strategy 3) ──────────────────────────
  // After filter, surviving invitations must share one
  // questionnaire_version_id. If more than one, the UI single-category
  // enforcement was bypassed — error loudly.
  const filteredInvs = invitations.filter((i) =>
    i.id !== null && i.id !== undefined ? filteredInvIds.has(i.id) : false
  );
  const versionIds = Array.from(
    new Set(
      filteredInvs
        .map((i) => i.questionnaire_version_id)
        .filter((v): v is string => v !== null && v !== undefined)
    )
  );
  if (versionIds.length !== 1) {
    throw new AtlasMultiVariantError(versionIds.length);
  }
  const versionId = versionIds[0];

  // ── 4. Variant label + question set for the scoped variant ────────
  // Pull `variant` for filename/audit; pull ALL questions for header
  // build (including SYR-only ones — JOR respondents have empty cells
  // for those columns, which ATLAS reads as no-answer).
  const { data: versionRow, error: vErr } = await supabase
    .from("questionnaire_versions")
    .select("variant")
    .eq("id", versionId)
    .single();
  if (vErr) throw vErr;
  const variant = versionRow.variant as string;

  const { data: qRows, error: qErr } = await supabase
    .from("questions")
    .select("id, question_code, order_index, is_feedback, text_en")
    .eq("version_id", versionId)
    .order("order_index", { ascending: true });
  if (qErr) throw qErr;
  const questionRows = qRows ?? [];
  const questions: AtlasQuestion[] = questionRows.map((q) => ({
    code: q.question_code,
    textEn: q.text_en,
    orderIndex: q.order_index,
    isFeedback: q.is_feedback,
  }));
  const questionCodeById = new Map(
    questionRows.map((q) => [q.id, q.question_code] as const)
  );

  // ── 5. Answers — keyed by (response_id, question_code) ────────────
  const responseIds = responses.map((r) => r.id);
  const { data: ansRows, error: aErr } = await supabase
    .from("answers")
    .select("response_id, question_id, answer_text")
    .in("response_id", responseIds);
  if (aErr) throw aErr;
  const answersByResponse = new Map<string, Map<string, string>>();
  for (const a of ansRows ?? []) {
    const qCode = questionCodeById.get(a.question_id);
    if (!qCode) continue; // defensive — version_id mismatch shouldn't happen
    let bucket = answersByResponse.get(a.response_id);
    if (!bucket) {
      bucket = new Map<string, string>();
      answersByResponse.set(a.response_id, bucket);
    }
    bucket.set(qCode, a.answer_text ?? "");
  }

  // ── 6. Consent timestamps ─────────────────────────────────────────
  const { data: consentRows, error: cErr } = await supabase
    .from("consent_records")
    .select("response_id, signed_at")
    .in("response_id", responseIds);
  if (cErr) throw cErr;
  const consentByResponse = new Map(
    (consentRows ?? []).map((c) => [c.response_id, c.signed_at] as const)
  );

  // ── 7. Tags per response — embed tags.name through response_tags ──
  // Same embed pattern as listTagsForResponse (lib/repos/tags.ts), batched
  // across the matched response set. Tags table is empty today (D84
  // pre-flight verification) so this returns no rows; reserved for when
  // Sura applies tags pre-export.
  const { data: tagRows, error: tErr } = await supabase
    .from("response_tags")
    .select("response_id, applied_at, tags(name)")
    .in("response_id", responseIds)
    .order("applied_at", { ascending: false });
  if (tErr) throw tErr;
  const tagsByResponse = new Map<string, string[]>();
  for (const row of tagRows ?? []) {
    const name = row.tags?.name;
    if (!name) continue;
    let bucket = tagsByResponse.get(row.response_id);
    if (!bucket) {
      bucket = [];
      tagsByResponse.set(row.response_id, bucket);
    }
    bucket.push(name);
  }

  // ── 8. Build payload rows ─────────────────────────────────────────
  const invById = new Map(filteredInvs.map((i) => [i.id, i] as const));
  const rows: AtlasResponseRow[] = [];
  for (const resp of responses) {
    const inv = invById.get(resp.invitation_id);
    if (!inv) continue; // defensive — filtered out above
    rows.push({
      refCode: inv.ref_code ?? "",
      category: inv.category ?? "",
      nationality: inv.nationality ?? null,
      preferredLanguage: inv.preferred_language ?? "",
      collectionMode: inv.collection_mode ?? "",
      // submitted_at filter at step 1 narrows to non-null at runtime.
      submittedAt: resp.submitted_at as string,
      consentSignedAt: consentByResponse.get(resp.id) ?? null,
      answers: answersByResponse.get(resp.id) ?? new Map<string, string>(),
      tags: tagsByResponse.get(resp.id) ?? [],
    });
  }

  return { variant, questions, rows };
}

/**
 * Long-format response export. Returns [] when no submitted+active
 * responses match (the route handler treats single-empty as 404 and
 * bulk-empty as a header-only file).
 *
 * D85 — bulk scope accepts optional `filters` (category, nationality,
 * language). Empty arrays / undefined / missing filters = "no filter
 * applied for that axis" (matches the wide-format posture in
 * getResponsesForAtlasExport + the modal's "leave all unchecked" UX).
 * Single scope ignores filters entirely (responseId is authoritative).
 * Filter values are allowlist-validated at the route layer BEFORE
 * reaching this function; the in-memory filter pass here just narrows
 * the invitation set — no enum-validation defense duplicated.
 *
 * ALL-OR-NOTHING decrypt: if any of the SURVIVING (post-filter)
 * invitations' name or email fails to decrypt, throws
 * ExportDecryptFailedError before any row is returned. No partial
 * output is possible. D75 parallel decrypt fan-out preserved — only the
 * surviving set is decrypted, which means filters are also a perf win
 * (skipped invitations skip their decrypt pair).
 */
export async function getResponsesForExport(
  supabase: SupabaseClient<Database>,
  scope: ExportScope
): Promise<ExportRow[]> {
  // 1. Responses — submitted + active only.
  let rq = supabase
    .from("responses")
    .select("id, invitation_id, language, started_at, submitted_at, status")
    .not("submitted_at", "is", null)
    .eq("status", "active")
    .order("submitted_at", { ascending: true });
  if (scope.scope === "single") rq = rq.eq("id", scope.responseId);
  const { data: respRows, error: rErr } = await rq;
  if (rErr) throw rErr;
  let responses = respRows ?? [];
  if (responses.length === 0) return [];

  const invitationIds = Array.from(
    new Set(responses.map((r) => r.invitation_id))
  );

  // 2. Invitations — BASE TABLE (owner-only call site). Pulls the two
  //    PII ciphertexts plus the operational columns we need for the
  //    export grid + the filter axes (category, nationality,
  //    preferred_language).
  // D95 — `questionnaire_version_id` added: it's both the scope-filter
  // axis (versionIds) AND the join key for the variant/version columns
  // resolved below. Non-PII operational column; the decrypt fan-out is
  // unchanged (still name + email only).
  const { data: invRows, error: iErr } = await supabase
    .from("invitations")
    .select(
      "id, ref_code, recipient_name_encrypted, recipient_email_encrypted, category, nationality, preferred_language, collection_mode, sent_at, opened_at, questionnaire_version_id"
    )
    .in("id", invitationIds);
  if (iErr) throw iErr;
  let invitations = invRows ?? [];

  // 2b. D85 — apply bulk-scope filters in-memory BEFORE the decrypt
  //     fan-out. Mirrors the getResponsesForAtlasExport filter posture:
  //     empty/undefined array → null Set → predicate returns true →
  //     filter skipped for that axis. PostgREST IN-list could also do
  //     this in SQL, but the response set is small at pilot scale and
  //     keeping the filter logic adjacent to the wide-format pattern
  //     makes future drift easier to catch. Single scope ignores
  //     filters entirely (responseId is authoritative).
  if (scope.scope === "bulk") {
    const f = scope.filters;
    const catSet = f?.category?.length ? new Set(f.category) : null;
    const natSet = f?.nationality?.length ? new Set(f.nationality) : null;
    const langSet = f?.language?.length ? new Set(f.language) : null;
    // D95 — pilot/main scope set. `undefined` (All) → no filter; an array
    // (incl. empty) restricts. Empty array → empty Set → predicate always
    // false → zero rows (honest empty for a scope with no versions).
    const versionSet = f?.versionIds !== undefined ? new Set(f.versionIds) : null;
    if (catSet || natSet || langSet || versionSet) {
      const survivingInvIds = new Set(
        invitations
          .filter((i) => (catSet ? catSet.has(i.category) : true))
          .filter((i) =>
            natSet ? i.nationality !== null && natSet.has(i.nationality) : true
          )
          .filter((i) =>
            langSet ? langSet.has(i.preferred_language) : true
          )
          // D95 — version-scope predicate.
          .filter((i) =>
            versionSet ? versionSet.has(i.questionnaire_version_id) : true
          )
          .map((i) => i.id)
      );
      invitations = invitations.filter((i) => survivingInvIds.has(i.id));
      responses = responses.filter((r) =>
        survivingInvIds.has(r.invitation_id)
      );
      if (responses.length === 0) return [];
    }
  }

  const responseIds = responses.map((r) => r.id);

  // D95 — resolve the variant + version_number for the surviving
  // invitations' versions, for the new provenance columns. One read of
  // questionnaire_versions (NON-PII: id / variant / version_number) over
  // the distinct version ids in the result. Decrypts nothing — the PII
  // posture (name + email only, below) is untouched. variantLabel()
  // formats the slug at emit time for one-source-of-truth labels.
  const versionIdSet = Array.from(
    new Set(
      invitations
        .map((i) => i.questionnaire_version_id)
        .filter((v): v is string => v != null)
    )
  );
  const versionMetaById = new Map<
    string,
    { variant: string; versionNumber: number }
  >();
  if (versionIdSet.length > 0) {
    const { data: verRows, error: verErr } = await supabase
      .from("questionnaire_versions")
      .select("id, variant, version_number")
      .in("id", versionIdSet);
    if (verErr) throw verErr;
    for (const v of verRows ?? []) {
      versionMetaById.set(v.id, {
        variant: v.variant,
        versionNumber: v.version_number,
      });
    }
  }

  // 3. Decrypt PII per invitation — ALL OR NOTHING. The first failure
  //    aborts the entire export. We log only the ref_code + errorClass
  //    bucket; the underlying RPC error.message is never persisted or
  //    surfaced.
  //
  // D75 — decrypt fan-out is parallel (Promise.all). Each invitation
  // fires name + email decrypts simultaneously; across invitations,
  // all run concurrently. Total RPC depth reduced from O(N×2)
  // sequential to O(1) batch. ExportDecryptFailedError semantics
  // unchanged: first observed rejection aborts the whole export.
  type InvDecrypted = {
    refCode: string;
    // D95 — non-PII provenance, resolved from versionMetaById above.
    variant: string; // variantLabel() form
    questionnaireVersion: number; // version_number
    name: string;
    email: string;
    category: string;
    nationality: string | null;
    preferredLanguage: string;
    collectionMode: string;
    sentAt: string | null;
    openedAt: string | null;
  };
  const results = await Promise.all(
    invitations.map(async (inv) => {
      const [{ data: name, error: nErr }, { data: email, error: eErr }] =
        await Promise.all([
          supabase.rpc("decrypt_pii", {
            p_ciphertext: inv.recipient_name_encrypted,
          }),
          supabase.rpc("decrypt_pii", {
            p_ciphertext: inv.recipient_email_encrypted,
          }),
        ]);
      if (nErr || name == null) {
        console.error(
          "[exports] decrypt_pii(name) failed for",
          inv.ref_code,
          "errorClass=config"
        );
        throw new ExportDecryptFailedError(inv.ref_code);
      }
      if (eErr || email == null) {
        console.error(
          "[exports] decrypt_pii(email) failed for",
          inv.ref_code,
          "errorClass=config"
        );
        throw new ExportDecryptFailedError(inv.ref_code);
      }
      // D95 — variant/version provenance (non-PII). variantLabel() maps
      // the slug to the canonical label; a version row that's somehow
      // missing degrades to a raw/empty label rather than throwing (the
      // FK guarantees it exists, but we stay defensive).
      const vm = versionMetaById.get(inv.questionnaire_version_id);
      return {
        id: inv.id,
        decrypted: {
          refCode: inv.ref_code,
          variant: vm ? variantLabel(vm.variant) : "",
          questionnaireVersion: vm ? vm.versionNumber : 0,
          name,
          email,
          category: inv.category,
          nationality: inv.nationality,
          preferredLanguage: inv.preferred_language,
          collectionMode: inv.collection_mode,
          sentAt: inv.sent_at,
          openedAt: inv.opened_at,
        },
      };
    })
  );
  const invById = new Map<string, InvDecrypted>(
    results.map((r) => [r.id, r.decrypted] as const)
  );

  // 4. Consent timestamps — boolean-equivalent (col 12). signed_name_encrypted
  //    is deliberately NOT read (D74 design call).
  const { data: consentRows, error: cErr } = await supabase
    .from("consent_records")
    .select("response_id, signed_at")
    .in("response_id", responseIds);
  if (cErr) throw cErr;
  const consentByResponse = new Map(
    (consentRows ?? []).map((c) => [c.response_id, c.signed_at] as const)
  );

  // 5. Answers — join target.
  const { data: ansRows, error: aErr } = await supabase
    .from("answers")
    .select("response_id, question_id, answer_text")
    .in("response_id", responseIds);
  if (aErr) throw aErr;
  const answers = ansRows ?? [];
  if (answers.length === 0) return [];

  // 6. Questions — denormalized join. Pull metadata for every distinct
  //    question_id referenced by the answers above.
  const questionIds = Array.from(new Set(answers.map((a) => a.question_id)));
  const { data: qRows, error: qErr } = await supabase
    .from("questions")
    .select("id, question_code, order_index, is_feedback, text_en, text_ar")
    .in("id", questionIds);
  if (qErr) throw qErr;
  const questionById = new Map((qRows ?? []).map((q) => [q.id, q] as const));

  // 7. Flatten to long-format. Outer sort: responses are already in
  //    submitted_at ASC order (step 1). Inner sort: question.order_index
  //    ASC. Defensive guards drop any answer whose question metadata
  //    isn't in questionById (impossible given the IN clause, but cheap).
  const out: ExportRow[] = [];
  for (const resp of responses) {
    const inv = invById.get(resp.invitation_id);
    if (!inv) continue;
    const consentSignedAt = consentByResponse.get(resp.id) ?? null;
    const respAnswers = answers
      .filter((a) => a.response_id === resp.id)
      .map((a) => {
        const q = questionById.get(a.question_id);
        return q ? { a, q } : null;
      })
      .filter((x): x is { a: (typeof answers)[number]; q: NonNullable<ReturnType<typeof questionById.get>> } => x !== null)
      .sort((x, y) => x.q.order_index - y.q.order_index);
    for (const { a, q } of respAnswers) {
      out.push({
        refCode: inv.refCode,
        variant: inv.variant, // D95
        questionnaireVersion: inv.questionnaireVersion, // D95
        recipientName: inv.name,
        recipientEmail: inv.email,
        category: inv.category,
        nationality: inv.nationality,
        preferredLanguage: inv.preferredLanguage,
        collectionMode: inv.collectionMode,
        sentAt: inv.sentAt,
        openedAt: inv.openedAt,
        startedAt: resp.started_at,
        // The query filter (.not('submitted_at', 'is', null)) narrows
        // this to non-null at runtime; the TS type widens because the
        // generated column type is `string | null`.
        submittedAt: resp.submitted_at as string,
        consentSignedAt,
        questionCode: q.question_code,
        questionOrderIndex: q.order_index,
        isFeedback: q.is_feedback,
        questionTextEn: q.text_en,
        questionTextAr: q.text_ar,
        answerText: a.answer_text,
      });
    }
  }
  return out;
}
