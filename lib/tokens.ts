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
