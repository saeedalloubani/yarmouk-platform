// lib/email/templates/render.ts
//
// D22 — pure email template renderer. NO I/O, NO env reads, NO side
// effects. Given a ResolvedTemplate (defaults already merged-in by the
// caller) and runtime values, returns { subject, text, html } ready for
// resend.emails.send.
//
// THE LOAD-BEARING DESIGN — "Sura can't accidentally ship an email
// without a working sign-in link":
//
//   The magic link is NEVER a placeholder Sura can put in (or take out
//   of) her body text. The renderer ALWAYS emits a <a href="…"> button
//   in the email HTML. The button's `href` is the system-owned
//   values.button_href — passed by the caller; the editor surface
//   never sees it. The button's LABEL is the editable 'cta' section.
//   Removing the link from the email is structurally impossible from
//   the editor; the worst Sura can do is replace the label with an
//   empty string, which fails validation (every section is min-length 1).
//
// VALIDATION pipeline (called by save AND test-send — same rules):
//   1. Each section must be a non-empty string.
//   2. Any {token} appearing in a section must be in the per-section
//      `allowedPlaceholders` allowlist for the template spec. A typo or
//      stray `{magic_link}` is rejected with the offending token in the
//      error message.
//   3. Each section's `requiredPlaceholders` list must all be present.
//      (For invitation: 'expiry' MUST contain {expiry_date}.) Removing
//      a load-bearing placeholder is rejected.
//
// ESCAPE-AND-INTERPOLATE order (HTML safety):
//   1. HTML-escape the editable text (which contains {placeholder} tokens
//      — {} aren't HTML-special, so they survive untouched).
//   2. HTML-escape each placeholder VALUE separately.
//   3. Substitute escaped values into the escaped section text.
//   4. For the contact section only: post-pass linkifies any email or
//      international phone number (per the current invitation.ts behavior).
//      AR locale gets dir="ltr" + unicode-bidi:isolate spans on the
//      linkified atoms so Latin/digit runs don't reorder inside the RTL
//      paragraph (matches the existing implementation).
//
// PLAIN TEXT: no escape, no linkification, no HTML — just interpolate.
//
// The HTML shell + colors + line-heights are IDENTICAL to today's hard-
// coded invitation.ts so the byte-for-byte equivalence claim holds:
// shipping D22 with no DB row makes no visible change.

import type {
  PlaceholderToken,
  ResolvedTemplate,
  RuntimeValues,
  SectionKey,
  TemplateSpec,
} from "./types";
import type { Lang } from "@/lib/i18n";

// ============================================================================
// Validation
// ============================================================================

export type ValidationIssue = {
  section: SectionKey;
  message: string;
  /** The offending token (without braces), if the issue is placeholder-shaped. */
  token?: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Validate one locale's sections against the template spec. */
export function validateSections(
  spec: TemplateSpec,
  sections: Partial<Record<SectionKey, string>>
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Template-wide "known" set — the union of every section's allowed
  // placeholders. Used to distinguish two distinct error cases:
  //   - token NOT in this set        → truly unknown ("{foo}" — typo)
  //   - token IN this set but not in
  //     allowed[key]                  → wrong section (real placeholder,
  //                                     placed somewhere that doesn't accept it)
  // Without this distinction, a misplaced {expiry_date} surfaces as
  // "unknown placeholder {expiry_date}", which is misleading.
  const knownTokens = new Set<string>();
  for (const k of spec.sections) {
    for (const p of spec.allowedPlaceholders[k]) knownTokens.add(p);
  }

  for (const key of spec.sections) {
    const raw = sections[key];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      issues.push({
        section: key,
        message: `The "${key}" section is required and cannot be empty.`,
      });
      continue;
    }

    // 1. Allowlist check — every {token} must be in allowedPlaceholders[key].
    const allowed = new Set<string>(spec.allowedPlaceholders[key]);
    const allowedHere = spec.allowedPlaceholders[key];
    const allowedHereSuffix =
      allowedHere.length === 0
        ? "This section does not accept placeholders."
        : `Allowed here: ${allowedHere.map((t) => `{${t}}`).join(", ")}.`;

    const found = new Set<string>();
    for (const match of raw.matchAll(PLACEHOLDER_RE)) {
      const token = match[1];
      found.add(token);
      if (!allowed.has(token)) {
        const knownButWrongSection = knownTokens.has(token);
        issues.push({
          section: key,
          token,
          message: knownButWrongSection
            ? `"{${token}}" is a real placeholder, but it is not allowed in the "${key}" section. ${allowedHereSuffix}`
            : `"${key}" contains unknown placeholder "{${token}}". ${allowedHereSuffix}`,
        });
      }
    }

    // 2. Required-placeholder check.
    for (const required of spec.requiredPlaceholders[key]) {
      if (!found.has(required)) {
        issues.push({
          section: key,
          token: required,
          message: `"${key}" must contain "{${required}}".`,
        });
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// ============================================================================
// HTML escape + interpolate
// ============================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Substitute {token} → value in text. If a token is in the allowlist but
 *  the caller didn't supply a value (e.g. {name} when name is undefined),
 *  the token is left intact rather than rendering "{name}" or empty — the
 *  spec's required-placeholder rule is what guards against missing
 *  load-bearing values at save time, so this is just defensive. */
function interpolate(
  text: string,
  values: Record<string, string | undefined>
): string {
  return text.replace(PLACEHOLDER_RE, (whole, token: string) => {
    const v = values[token];
    return typeof v === "string" ? v : whole;
  });
}

/** Build the per-token value map from RuntimeValues. Only the whitelisted
 *  tokens are exposed (button_href is NEVER a placeholder). */
function valuesFor(
  values: RuntimeValues
): Record<PlaceholderToken, string | undefined> {
  return {
    name: values.name,
    expiry_date: values.expiry_date,
    ref_code: values.ref_code,
  };
}

// ============================================================================
// Contact-line linkification (HTML)
// ============================================================================

// Match an email address (LATIN local-part + domain — covers the contact
// addresses Sura will use). The contact section is the only place
// linkification runs.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Match an international phone number: + followed by digits and
// optional spaces/dashes. Anchored to start with +Digit so plain dates
// or numbers in the contact line aren't accidentally linkified.
const PHONE_RE = /\+\d[\d\s-]{6,}\d/g;

/** Linkify the (already-escaped) contact HTML. In AR (`isAr`), the
 *  anchor gets dir="ltr" + unicode-bidi:isolate so the Latin/digit run
 *  doesn't reorder inside the RTL paragraph — mirrors today's
 *  invitation.ts behavior. */
function linkifyContact(escapedHtml: string, isAr: boolean): string {
  const ltrAttrs = isAr ? ` dir="ltr" style="unicode-bidi:isolate;color:#185FA5;text-decoration:none"` : ` style="color:#185FA5;text-decoration:none"`;

  return escapedHtml
    .replace(EMAIL_RE, (addr) => {
      // The matched address contains no HTML-special chars (regex by
      // construction), so it's already escape-safe; use it verbatim in
      // href + text.
      return `<a href="mailto:${addr}"${ltrAttrs}>${addr}</a>`;
    })
    .replace(PHONE_RE, (raw) => {
      // tel: needs digits only — strip spaces + dashes, keep the +.
      const tel = raw.replace(/[\s-]/g, "");
      return `<a href="${tel}"${ltrAttrs}>${raw}</a>`;
    });
}

// ============================================================================
// Renderer
// ============================================================================

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

/** Render an invitation-shaped template (sections: intro / cta /
 *  personal / expiry / contact) into subject+text+html. The HTML shell
 *  is fixed; the button's href is values.button_href, the button's label
 *  is the 'cta' section. */
export function renderInvitationEmail(args: {
  template: ResolvedTemplate;
  values: RuntimeValues;
}): RenderedEmail {
  const { template, values } = args;
  const { sections, subject, lang } = template;
  const isAr = lang === "ar";
  const dir: "rtl" | "ltr" = isAr ? "rtl" : "ltr";
  const introLh = isAr ? "1.85" : "1.7";
  const fineLh = isAr ? "1.7" : "1.6";

  const tokenValues = valuesFor(values);
  // HTML-escape each placeholder VALUE once; reuse the escaped map for HTML.
  const tokenValuesEscaped: Record<string, string | undefined> = {};
  for (const k of Object.keys(tokenValues) as PlaceholderToken[]) {
    const v = tokenValues[k];
    tokenValuesEscaped[k] = typeof v === "string" ? escapeHtml(v) : undefined;
  }

  // ---- text body ----------------------------------------------------------
  // No escape, no linkification — recipients' mail clients render this as
  // plain text. The button is represented by its label + the URL on the
  // next line (mirrors the current invitation.ts plain-text shape).
  const introText = interpolate(sections.intro, tokenValues);
  const ctaText = interpolate(sections.cta, tokenValues);
  const personalText = interpolate(sections.personal, tokenValues);
  const expiryText = interpolate(sections.expiry, tokenValues);
  const contactText = interpolate(sections.contact, tokenValues);
  const text = [
    introText,
    "",
    `${ctaText}:`,
    values.button_href,
    "",
    personalText,
    expiryText,
    "",
    contactText,
  ].join("\n");

  // ---- html body ----------------------------------------------------------
  // Escape text, then interpolate (already-escaped) values into it. The
  // button's href is values.button_href — system-owned, NEVER an editable
  // placeholder. The contact line gets the email/phone linkification post-
  // pass (with bidi isolation in AR).
  const introHtml = interpolate(escapeHtml(sections.intro), tokenValuesEscaped);
  const ctaHtml = interpolate(escapeHtml(sections.cta), tokenValuesEscaped);
  const personalHtml = interpolate(
    escapeHtml(sections.personal),
    tokenValuesEscaped
  );
  const expiryHtml = interpolate(
    escapeHtml(sections.expiry),
    tokenValuesEscaped
  );
  const contactHtmlEscaped = interpolate(
    escapeHtml(sections.contact),
    tokenValuesEscaped
  );
  const contactHtml = linkifyContact(contactHtmlEscaped, isAr);

  const html = `<div dir="${dir}" style="margin:0 auto;max-width:520px;background:#ffffff;border:0.5px solid #e6e4de;border-radius:12px;padding:32px 34px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#33322f">
    <p style="margin:0 0 26px;font-size:16px;line-height:${introLh};color:#33322f">${introHtml}</p>
    <p style="margin:0 0 28px">
      <a href="${escapeHtml(values.button_href)}" style="display:inline-block;background:#185FA5;color:#ffffff;font-size:15px;font-weight:500;text-decoration:none;padding:13px 30px;border-radius:8px">${ctaHtml}</a>
    </p>
    <div style="border-top:0.5px solid #ececea;padding-top:18px">
      <p style="margin:0;font-size:13px;line-height:${fineLh};color:#8a8982">${personalHtml}</p>
      <p style="margin:4px 0 0;font-size:13px;line-height:${fineLh};color:#8a8982">${expiryHtml}</p>
      <p style="margin:12px 0 0;font-size:14px;line-height:${fineLh};color:#5f5e59">${contactHtml}</p>
    </div>
  </div>`;

  return { subject, text, html };
}

// ============================================================================
// Defaults overlay helper
// ============================================================================

/** Apply a (possibly-partial) DB overlay on top of full defaults to produce
 *  a complete, render-ready ResolvedTemplate. A field-by-field overlay:
 *  any blank/missing piece falls back to the default. This is what makes
 *  "reset to default" = delete the row — if a section is missing, defaults
 *  fill it. */
export function resolveTemplate(args: {
  templateId: "invitation";
  lang: Lang;
  defaultSubject: string;
  defaultSections: Record<SectionKey, string>;
  overlaySubject?: string | null;
  overlaySections?: Partial<Record<SectionKey, string>> | null;
}): ResolvedTemplate {
  const { templateId, lang, defaultSections, defaultSubject } = args;
  const subject =
    typeof args.overlaySubject === "string" && args.overlaySubject.trim().length > 0
      ? args.overlaySubject
      : defaultSubject;

  const sections: Record<SectionKey, string> = { ...defaultSections };
  if (args.overlaySections) {
    for (const k of Object.keys(args.overlaySections) as SectionKey[]) {
      const v = args.overlaySections[k];
      if (typeof v === "string" && v.trim().length > 0) {
        sections[k] = v;
      }
    }
  }
  return { id: templateId, lang, subject, sections };
}
