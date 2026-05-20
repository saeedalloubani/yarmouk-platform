// lib/tokens.ts
//
// Invitation token minting (D44). Server-only (node:crypto).
//
// 32 random bytes → base64url (43 chars, URL-safe, no padding). The hash
// is the SHA-256 hex digest. The plaintext exists ONLY at mint time — it
// goes into the email link (3b-ii) and is shown once on create (3b-i);
// only `hash` is ever persisted, in invitations.token_hash. There is no
// way back from hash to plaintext: re-issuing a link means minting a new
// token (resend = rotation, 3b-ii).

import { randomBytes, createHash } from "node:crypto";

export type MintedToken = { plaintext: string; hash: string };

export function mintInvitationToken(): MintedToken {
  const plaintext = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

/**
 * Build the respondent link from a freshly-minted plaintext token.
 * Throws if NEXT_PUBLIC_SITE_URL is unset/empty, so we never produce a
 * broken "undefined/r/..." link (caught in 3b-i smoke). Call this BEFORE
 * any DB write/rotation: in create, before the insert (no orphan record);
 * in resend, before token_hash is overwritten (a misconfig leaves the old
 * link alive).
 */
export function buildInvitationUrl(plaintext: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is not set — refusing to build an invitation " +
        "link. Set it before creating or sending invitations."
    );
  }
  return `${base.replace(/\/$/, "")}/r/${plaintext}`;
}
