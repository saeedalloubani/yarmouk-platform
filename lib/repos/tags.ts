// lib/repos/tags.ts
//
// Admin-side read + write helpers for the `tags` + `response_tags` tables
// (the qualitative coding layer, 3c-ii).
//
// NON-PII helper. Like responses.ts, this does NOT branch on
// current_admin_role() and has no redacted view — tags / response_tags are
// on the non-PII allow-list (repos/README.md). RLS does the gating:
//   - SELECT: both roles (t_admins_select / rt_admins_select) → supervisors
//     SEE applied tags.
//   - INSERT/DELETE: owner only (t_owner_insert, rt_owner_insert/delete) →
//     only the owner creates/applies/removes. The server action also
//     owner-gates first; RLS is the backstop.
//
// EMBED NOTE: listTagsForResponse embeds `tags` from `response_tags`. That
// is SAFE here and is NOT the "embed trap" (watch-out #12): the trap is
// about embedding a PII *base* table (invitations/recordings/consent),
// which bypasses the redacted view and leaks ciphertext to readonly. `tags`
// carries no PII and has no redacted view, so embedding it is fine for both
// roles.
//
// Takes the AUTHENTICATED server client (carries the admin JWT) so RLS
// applies — never the service-role client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

// tags.category is a TEXT CHECK ('theme','stance','perspective') — the DB
// enforces it but Supabase gen types widen it to string, so we narrow.
export type TagCategory = "theme" | "stance" | "perspective";

export type TagRow = {
  id: string;
  name: string;
  category: TagCategory;
};

export type AppliedTag = TagRow & { appliedAt: string };

/** Whole tag vocabulary, ordered by name. Powers the add-form datalist. */
export async function listAllTags(
  supabase: SupabaseClient<Database>
): Promise<TagRow[]> {
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, category")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category as TagCategory,
  }));
}

/** Tags applied to one response (both roles see these). Newest first. */
export async function listTagsForResponse(
  supabase: SupabaseClient<Database>,
  responseId: string
): Promise<AppliedTag[]> {
  const { data, error } = await supabase
    .from("response_tags")
    .select("applied_at, tags(id, name, category)")
    .eq("response_id", responseId)
    .order("applied_at", { ascending: false });
  if (error) throw error;
  const out: AppliedTag[] = [];
  for (const row of data ?? []) {
    const t = row.tags;
    if (!t) continue; // defensive; FK guarantees a row
    out.push({
      id: t.id,
      name: t.name,
      category: t.category as TagCategory,
      appliedAt: row.applied_at,
    });
  }
  return out;
}

/** Find a tag by case-insensitive name, or null. Scans the small tag
 *  vocabulary in memory — PostgREST can't express `lower(name) = lower($1)`
 *  directly, and the coding scheme is dozens of tags, not thousands. */
async function findTagByLowerName(
  supabase: SupabaseClient<Database>,
  lowerName: string
): Promise<TagRow | null> {
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, category");
  if (error) throw error;
  const hit = (data ?? []).find((t) => t.name.toLowerCase() === lowerName);
  return hit
    ? { id: hit.id, name: hit.name, category: hit.category as TagCategory }
    : null;
}

/**
 * Create-or-pick a tag by case-insensitive name (3c-ii). If a tag with the
 * same name (any case) exists, REUSE it (its category stands; the submitted
 * category is ignored on pick). Otherwise CREATE it with the submitted
 * category. Returns the resolved tag so the caller can audit the actual
 * persisted name/category.
 *
 * Race handling: with the `tags_name_lower_key` unique index (migration 16),
 * a concurrent create loses with 23505 — we converge by re-reading the
 * winner. Near-impossible with a single owner, but correct regardless.
 */
export async function findOrCreateTag(
  supabase: SupabaseClient<Database>,
  input: { name: string; category: TagCategory; adminId: string }
): Promise<TagRow> {
  const norm = input.name.trim();
  const target = norm.toLowerCase();

  const existing = await findTagByLowerName(supabase, target);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("tags")
    .insert({ name: norm, category: input.category, created_by: input.adminId })
    .select("id, name, category")
    .single();
  if (!error && data) {
    return { id: data.id, name: data.name, category: data.category as TagCategory };
  }
  if (error?.code === "23505") {
    const raced = await findTagByLowerName(supabase, target);
    if (raced) return raced;
  }
  throw error;
}

/**
 * Apply a tag to a response. Idempotent: the (response_id, tag_id) PK means
 * re-applying is a 23505 we treat as a no-op success, not an error.
 */
export async function applyTag(
  supabase: SupabaseClient<Database>,
  responseId: string,
  tagId: string,
  adminId: string
): Promise<void> {
  const { error } = await supabase
    .from("response_tags")
    .insert({ response_id: responseId, tag_id: tagId, applied_by: adminId });
  if (error && error.code !== "23505") throw error;
}

/**
 * Remove a tag from a response. No-op if it wasn't applied. Returns the
 * tag's name (server-authoritative, for the audit label) or null if the tag
 * no longer exists.
 */
export async function removeTag(
  supabase: SupabaseClient<Database>,
  responseId: string,
  tagId: string
): Promise<string | null> {
  const { data: tag } = await supabase
    .from("tags")
    .select("name")
    .eq("id", tagId)
    .maybeSingle();
  const { error } = await supabase
    .from("response_tags")
    .delete()
    .eq("response_id", responseId)
    .eq("tag_id", tagId);
  if (error) throw error;
  return tag?.name ?? null;
}
