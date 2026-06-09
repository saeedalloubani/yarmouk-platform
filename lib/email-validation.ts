// lib/email-validation.ts
//
// Single source of truth for INPUT email validation across the platform
// (task_76dd2a4f). Previously four call sites each defined the same loose
// regex `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`, which only excluded whitespace and
// `@` — so it accepted malformed addresses like "ali@mah,oud.com" (comma in
// the domain). This module replaces all four with one tightened pattern.
//
// The pattern matches the (already stricter) detection regex used by the email
// RENDERER's address-redaction pass (lib/email/templates/render.ts) — keeping
// "what we accept" and "what we recognize in output" consistent — but anchored
// (^…$) for whole-string validation:
//   - local:  [A-Za-z0-9._%+-]+
//   - domain: [A-Za-z0-9.-]+   (NO comma/space/@ → "mah,oud" is rejected)
//   - TLD:    \.[A-Za-z]{2,}
//
// Pragmatic, NOT full RFC 5322 (no quoted local parts, no IP-literal domains) —
// correct for this study's invitee/admin addresses. CLIENT-SAFE: a pure const,
// imported by both server actions and the client-safe bulk-invite fields module.

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Convenience predicate. Callers using Zod pass EMAIL_RE to `.regex(...)`. */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
